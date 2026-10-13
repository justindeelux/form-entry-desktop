import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openState, type Checkpoint } from '../src/main/persistence';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function paths() { const root = mkdtempSync(join(tmpdir(), 'sheet-state-')); directories.push(root); return { path: join(root, 'state.json'), legacy: join(root, 'phase0.sqlite') }; }
const checkpoint: Checkpoint = {
  batch: 'a'.repeat(64), row: 2, state: 'unknown', sourceUrl: 'source', formUrl: 'form', id: 'b'.repeat(64), columns: 'schema',
  sheetColumns: { result: 'column-1', sentAt: 'column-2' }, baseline: { 'column-1': '', 'column-2': '' }, updates: { 'column-1': 'Đã gửi', 'column-2': '2026-10-13T14:30:42' },
};

describe('local configuration and crash recovery only', () => {
  it('persists intent before submit, blocks after restart and never reopens a confirmed send for resubmission', () => {
    const { path } = paths();
    let store = openState(path);
    store.begin(checkpoint);
    store.close(); store = openState(path);
    expect(store.uncertain()).toBe(true);
    expect(() => store.begin(checkpoint)).toThrow('SUBMISSION_UNKNOWN_REVIEW');
    store.submitted(checkpoint.batch, checkpoint.row);
    store.close(); store = openState(path);
    expect(store.pending()[0].state).toBe('submitted');
    expect(() => store.confirmNotSent(checkpoint.batch, checkpoint.row)).toThrow('REVIEW_STATE_CHANGED');
    store.resetPreferences();
    expect(store.uncertain()).toBe(true);
    store.clear(checkpoint.batch, checkpoint.row);
    expect(openState(path).uncertain()).toBe(false);
    expect(JSON.parse(readFileSync(path, 'utf8')).pending).toEqual([]);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it('can release an uncertain submission only after explicit review, and refuses corrupt state', () => {
    const { path } = paths(); const store = openState(path);
    store.begin(checkpoint); store.confirmNotSent(checkpoint.batch, checkpoint.row);
    expect(store.uncertain()).toBe(false);
    expect(() => store.confirmNotSent(checkpoint.batch, checkpoint.row)).toThrow('REVIEW_STATE_CHANGED');
    writeFileSync(path, '{bad');
    expect(() => openState(path)).toThrow();
  });
  it('reads legacy preferences/history and unresolved intents without changing the old SQLite database', () => {
    const { path, legacy } = paths();
    const db = new DatabaseSync(legacy);
    db.exec(`CREATE TABLE preferences(id INTEGER,send_delay_seconds INTEGER,field_delay_ms INTEGER,minimize_chrome INTEGER);
      INSERT INTO preferences VALUES(1,2,100,1);
      CREATE TABLE sent_rows(batch TEXT,row INTEGER,state TEXT,history_managed INTEGER);
      CREATE TABLE sent_history(scope TEXT,id TEXT,row_number INTEGER,columns_json TEXT,values_json TEXT,sent_at INTEGER);`);
    db.prepare('INSERT INTO sent_rows VALUES(?,?,?,?)').run(checkpoint.batch, 2, 'submit_intent', 1);
    db.prepare('INSERT INTO sent_history VALUES(?,?,?,?,?,?)').run('scope', 'old', 2, '["Name"]', '["Ánh"]', 1000);
    db.close(); const before = readFileSync(legacy);
    const store = openState(path, legacy);
    expect(store.preferences()).toEqual({ sendDelaySeconds: 2, fieldDelayMs: 100, minimizeChrome: true });
    expect(store.uncertain()).toBe(true);
    store.confirmNotSent(checkpoint.batch, 2);
    expect(store.uncertain()).toBe(false);
    expect(store.legacyHistory('scope')).toHaveLength(1);
    store.migrated('scope:old');
    expect(store.legacyHistory('scope')).toEqual([]);
    store.close(); expect(readFileSync(legacy)).toEqual(before);
  });
  it('lets a reviewed old spike without source metadata be acknowledged as already sent', () => {
    const { path, legacy } = paths(); const db = new DatabaseSync(legacy);
    db.exec("CREATE TABLE spike_attempts(id INTEGER PRIMARY KEY,state TEXT); INSERT INTO spike_attempts VALUES(7,'submit_intent')"); db.close();
    const store = openState(path, legacy), pending = store.pending()[0];
    expect(pending.batch).toMatch(/^[a-f0-9]{64}$/);
    expect(pending.row).toBe(7); expect(store.uncertain()).toBe(true);
    store.confirmLegacySent(pending.batch, pending.row);
    expect(store.uncertain()).toBe(false);
    expect(() => store.confirmLegacySent(pending.batch, pending.row)).toThrow('REVIEW_STATE_CHANGED');
    store.close();
  });
});
