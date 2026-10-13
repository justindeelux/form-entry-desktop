import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { preferencesSchema, reviewSchema, sheetColumnsSchema, type Preferences } from '../shared/contracts';

const checkpointSchema = reviewSchema.extend({
  state: z.enum(['unknown', 'submitted']), sourceUrl: z.string(), formUrl: z.string(),
  id: z.string(), columns: z.string(), sheetColumns: sheetColumnsSchema,
  baseline: z.record(z.string(), z.string()), updates: z.record(z.string(), z.string()),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
const stateSchema = z.object({ preferences: preferencesSchema, pending: z.array(checkpointSchema), migrated: z.array(z.string()) });
type LegacyRecord = { id: string; row_number: number; columns_json: string; values_json: string; sent_at: number };

export function openState(path: string, legacyPath?: string) {
  const state = stateSchema.parse(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { preferences: {}, pending: [], migrated: [] });
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(stateSchema.parse(state)), { mode: 0o600 });
    const file = openSync(`${path}.tmp`, 'r');
    try { fsyncSync(file); } finally { closeSync(file); }
    renameSync(`${path}.tmp`, path);
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  };
  // Old SQLite files are read only for migration; new records live in Sheets.
  let legacy = legacyPath && existsSync(legacyPath) ? new DatabaseSync(legacyPath, { readOnly: true }) : undefined;
  const legacyTable = (name: string) => !!legacy?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!existsSync(path) && legacyTable('preferences')) {
    const row = legacy!.prepare('SELECT * FROM preferences WHERE id=1').get();
    if (row) state.preferences = preferencesSchema.parse({ sendDelaySeconds: row.send_delay_seconds ?? 0, fieldDelayMs: row.field_delay_ms ?? 0, minimizeChrome: !!row.minimize_chrome });
    save();
  }
  function find(batch: string, row: number) {
    const checkpoint = state.pending.find(item => item.batch === batch && item.row === row);
    if (!checkpoint) throw new Error('REVIEW_STATE_CHANGED');
    return checkpoint;
  }
  const legacyPending = () => {
    const result: { batch: string; row: number; state: 'unknown'; sourceUrl: string }[] = [];
    for (const table of ['sent_rows', 'spike_attempts']) {
      if (!legacyTable(table)) continue;
      const columns = legacy!.prepare(`PRAGMA table_info(${table})`).all();
      const legacySubmitted = table === 'spike_attempts' ? '' : columns.some(column => column.name === 'history_managed') ? " OR (state='submitted' AND history_managed=0)" : " OR state='submitted'";
      const numbered = columns.some(column => column.name === 'batch') && columns.some(column => column.name === 'row');
      for (const item of legacy!.prepare(`SELECT ${numbered ? 'batch,row' : 'rowid AS legacy_id'} FROM ${table} WHERE state IN ('submit_intent','unknown')${legacySubmitted}`).all()) {
        const batch = numbered ? String(item.batch) : createHash('sha256').update(`${table}:${item.legacy_id}`).digest('hex');
        const row = Number(numbered ? item.row : item.legacy_id);
        if (!state.migrated.includes(`review:${batch}:${row}`)) result.push({ batch, row, state: 'unknown', sourceUrl: '' });
      }
    }
    return result;
  };
  return {
    preferences: () => state.preferences,
    savePreferences(value: Preferences) { state.preferences = preferencesSchema.parse(value); save(); return state.preferences; },
    resetAll() {
      legacy?.close(); legacy = undefined;
      state.preferences = preferencesSchema.parse({}); state.pending = []; state.migrated = [];
      for (const file of [path, `${path}.tmp`, ...(legacyPath ? [legacyPath, `${legacyPath}-wal`, `${legacyPath}-shm`, `${legacyPath}-journal`] : [])]) rmSync(file, { force: true });
    },
    uncertain: () => state.pending.length > 0 || legacyPending().length > 0,
    begin(checkpoint: Checkpoint) {
      if (state.pending.length || legacyPending().length) throw new Error('SUBMISSION_UNKNOWN_REVIEW');
      state.pending.push(checkpointSchema.parse(checkpoint)); save();
    },
    submitted(batch: string, row: number, updates?: Record<string, string>) {
      const checkpoint = find(batch, row);
      checkpoint.state = 'submitted';
      if (updates) checkpoint.updates = updates;
      save(); return checkpoint;
    },
    checkpoint: find,
    checkpoints: () => state.pending.map(item => structuredClone(item)),
    clear(batch: string, row: number) { find(batch, row); state.pending = state.pending.filter(item => item.batch !== batch || item.row !== row); save(); },
    pending: () => [...state.pending.map(({ batch, row, state, sourceUrl }) => ({ batch, row, state, sourceUrl })), ...legacyPending()],
    confirmLegacySent(batch: string, row: number) {
      if (!legacyPending().some(item => item.batch === batch && item.row === row)) throw new Error('REVIEW_STATE_CHANGED');
      state.migrated.push(`review:${batch}:${row}`); save();
    },
    confirmNotSent(batch: string, row: number) {
      const checkpoint = state.pending.find(item => item.batch === batch && item.row === row);
      if (checkpoint?.state === 'submitted') throw new Error('REVIEW_STATE_CHANGED');
      if (checkpoint) { state.pending = state.pending.filter(item => item !== checkpoint); save(); return; }
      if (!legacyPending().some(item => item.batch === batch && item.row === row)) throw new Error('REVIEW_STATE_CHANGED');
      state.migrated.push(`review:${batch}:${row}`); save();
    },
    legacyHistory(scope: string): LegacyRecord[] {
      if (!legacyTable('sent_history')) return [];
      return (legacy!.prepare('SELECT id,row_number,columns_json,values_json,sent_at FROM sent_history WHERE scope=?').all(scope) as unknown as LegacyRecord[])
        .filter(record => !state.migrated.includes(`${scope}:${record.id}`));
    },
    migrated(scope: string) { if (!state.migrated.includes(scope)) { state.migrated.push(scope); save(); } },
    close() { legacy?.close(); },
  };
}
