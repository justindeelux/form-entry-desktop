import Database from 'better-sqlite3';
import { matchesRow } from '../shared/row-filter';
import { preferencesSchema, formSnapshotSchema, type FormSnapshot, type HistoryCursor, type HistoryRow, type Preferences } from '../shared/contracts';
export type SentRecord = { scope: string; id: string; number: number; columns: string[]; values: string[]; form?: FormSnapshot };


export function openDatabase(path: string) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.exec(`CREATE TABLE IF NOT EXISTS sent_rows (
    batch TEXT NOT NULL, row INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('submit_intent', 'submitted', 'failed', 'unknown')),
    PRIMARY KEY(batch, row)
  )`);
  db.pragma('secure_delete = ON');
  const columns = db.pragma('table_info(sent_rows)') as { name: string }[];
  if (!columns.some(column => column.name === 'history_managed')) db.exec('ALTER TABLE sent_rows ADD COLUMN history_managed INTEGER NOT NULL DEFAULT 0');
  if (!columns.some(column => column.name === 'scope')) db.exec('ALTER TABLE sent_rows ADD COLUMN scope TEXT');
  if (!columns.some(column => column.name === 'row_id')) db.exec('ALTER TABLE sent_rows ADD COLUMN row_id TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id = 1), retention_hours INTEGER NOT NULL);
    INSERT OR IGNORE INTO preferences (id,retention_hours) VALUES (1, 24);
    CREATE TABLE IF NOT EXISTS sent_history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, id TEXT NOT NULL,
      row_number INTEGER NOT NULL, columns_json TEXT NOT NULL, values_json TEXT NOT NULL, sent_at INTEGER NOT NULL,
      UNIQUE(scope, id));
    CREATE INDEX IF NOT EXISTS sent_history_scope_order ON sent_history(scope, seq DESC);`);
  const historyColumns = db.pragma('table_info(sent_history)') as { name: string }[];
  if (!historyColumns.some(column => column.name === 'form_json')) db.exec('ALTER TABLE sent_history ADD COLUMN form_json TEXT');
  const preferenceColumns = db.pragma('table_info(preferences)') as { name: string }[];
  if (!preferenceColumns.some(column => column.name === 'send_delay_seconds')) db.exec('ALTER TABLE preferences ADD COLUMN send_delay_seconds INTEGER NOT NULL DEFAULT 0');
  for (const column of ['field_delay_ms', 'delete_expired', 'minimize_chrome']) {
    if (!preferenceColumns.some(item => item.name === column)) db.exec(`ALTER TABLE preferences ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  }
  db.function('matches_row', (values, search, column) => matchesRow(JSON.parse(String(values)), String(search), Number(column) < 0 ? undefined : Number(column)) ? 1 : 0);
  const preferences = (): Preferences => {
    const row = db.prepare('SELECT retention_hours,send_delay_seconds,field_delay_ms,delete_expired,minimize_chrome FROM preferences WHERE id = 1').get() as { retention_hours: number; send_delay_seconds: number; field_delay_ms: number; delete_expired: number; minimize_chrome: number };
    return { retentionHours: row.retention_hours, sendDelaySeconds: row.send_delay_seconds, fieldDelayMs: row.field_delay_ms, deleteExpired: !!row.delete_expired, minimizeChrome: !!row.minimize_chrome };
  };
  function prune(now = Date.now()) {
    if (!preferences().deleteExpired) return;
    const removed = db.prepare('DELETE FROM sent_history WHERE sent_at <= ?').run(now - preferences().retentionHours * 3600000).changes;
    if (removed) db.pragma('wal_checkpoint(TRUNCATE)');
  }
  function saveRecord(record: SentRecord, now: number) {
    db.prepare('INSERT OR IGNORE INTO sent_history (scope,id,row_number,columns_json,values_json,sent_at,form_json) VALUES (?,?,?,?,?,?,?)')
      .run(record.scope, record.id, record.number, JSON.stringify(record.columns), JSON.stringify(record.values), now, record.form ? JSON.stringify(formSnapshotSchema.parse(record.form)) : null);
  }
  prune();
  // An interrupted click may have reached Google; never silently retry it.
  db.prepare("UPDATE sent_rows SET state = 'unknown' WHERE state = 'submit_intent'").run();
  // Legacy checkpoints lack a source snapshot; require review instead of inventing sent history.
  db.prepare("UPDATE sent_rows SET state = 'unknown' WHERE state = 'submitted' AND history_managed = 0").run();
  const legacy = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'spike_attempts'").get();
  if (legacy) db.prepare("UPDATE spike_attempts SET state = 'unknown' WHERE state = 'submit_intent'").run();
  return {
    uncertain() { return !!db.prepare("SELECT 1 FROM sent_rows WHERE state IN ('unknown', 'submit_intent') LIMIT 1").get() || (legacy && !!db.prepare("SELECT 1 FROM spike_attempts WHERE state = 'unknown' LIMIT 1").get()); },
    state(batch: string, row: number) { return (db.prepare('SELECT state FROM sent_rows WHERE batch = ? AND row = ?').get(batch, row) as { state: string } | undefined)?.state; },
    begin(batch: string, row: number, record?: SentRecord) {
      const result = db.prepare(`INSERT INTO sent_rows (batch,row,state,history_managed,scope,row_id) VALUES (?,?,'submit_intent',?,?,?)
        ON CONFLICT(batch,row) DO UPDATE SET state='submit_intent',history_managed=excluded.history_managed,scope=excluded.scope,row_id=excluded.row_id
        WHERE state='failed' OR (state='submitted' AND history_managed=1 AND excluded.history_managed=1)`)
        .run(batch, row, record ? 1 : 0, record?.scope ?? null, record?.id ?? null);
      if (result.changes !== 1) throw new Error('SUBMISSION_UNKNOWN_REVIEW');
    },
    finish(batch: string, row: number, state: 'submitted' | 'failed' | 'unknown', record?: SentRecord, now = Date.now()) {
      db.transaction(() => {
        const result = db.prepare("UPDATE sent_rows SET state = ? WHERE batch = ? AND row = ? AND state = 'submit_intent'").run(state, batch, row);
        if (result.changes === 1 && state === 'submitted' && record) saveRecord(record, now);
      })();
    },
    preferences,
    reset() {
      db.transaction(() => {
        db.exec('DELETE FROM sent_history; DELETE FROM sent_rows; DELETE FROM sqlite_sequence; DELETE FROM preferences; INSERT INTO preferences (id,retention_hours) VALUES (1,24)');
        if (legacy) db.exec('DELETE FROM spike_attempts');
      })();
      db.pragma('wal_checkpoint(TRUNCATE)');
    },
    savePreferences(value: Preferences) {
      value = preferencesSchema.parse(value);
      db.prepare('UPDATE preferences SET retention_hours = ?,send_delay_seconds = ?,field_delay_ms = ?,delete_expired = ?,minimize_chrome = ? WHERE id = 1').run(value.retentionHours, value.sendDelaySeconds, value.fieldDelayMs, Number(value.deleteExpired), Number(value.minimizeChrome));
      prune(); return preferences();
    },
    prune,
    sentIds(scope: string, now = Date.now()) {
      prune(now);
      return new Set((db.prepare('SELECT id FROM sent_history WHERE scope = ?').all(scope) as { id: string }[]).map(row => row.id));
    },
    unresolvedIds(scope: string) {
      return new Set((db.prepare("SELECT row_id AS id FROM sent_rows WHERE scope = ? AND state IN ('unknown','submit_intent')").all(scope) as { id: string }[]).map(row => row.id));
    },
    history(scope: string, cursor?: HistoryCursor, search = '', column?: number) {
      prune();
      const rows = db.prepare(`SELECT * FROM sent_history WHERE scope=? AND matches_row(values_json,?,?) ${cursor ? 'AND seq < ?' : ''} ORDER BY seq DESC LIMIT 21`).all(...(cursor ? [scope, search, column ?? -1, cursor.order] : [scope, search, column ?? -1])) as { seq: number; id: string; row_number: number; columns_json: string; values_json: string; sent_at: number }[];
      const visible: HistoryRow[] = rows.slice(0, 20).map(row => ({ id: row.id, order: row.seq, number: row.row_number, columns: JSON.parse(row.columns_json), values: JSON.parse(row.values_json), sentAt: row.sent_at, state: 'sent' }));
      return { rows: visible, nextCursor: rows.length > 20 ? { order: visible[19].order, id: visible[19].id } : undefined };
    },
    viewForm(scope: string, id: string) {
      prune();
      const row = db.prepare('SELECT form_json FROM sent_history WHERE scope=? AND id=?').get(scope, id) as { form_json: string | null } | undefined;
      if (!row) throw new Error('HISTORY_ROW_CHANGED');
      return row.form_json === null ? null : formSnapshotSchema.parse(JSON.parse(row.form_json));
    },
    deleteHistory(scope: string, id: string) {
      if (db.prepare('DELETE FROM sent_history WHERE scope=? AND id=?').run(scope,id).changes !== 1) throw new Error('HISTORY_ROW_CHANGED');
      db.pragma('wal_checkpoint(TRUNCATE)');
    },
    pending() { return db.prepare("SELECT batch, row FROM sent_rows WHERE state = 'unknown' ORDER BY row, batch").all() as { batch: string; row: number }[]; },
    confirmNotSent(batch: string, row: number) {
      const result = db.prepare("UPDATE sent_rows SET state = 'failed' WHERE batch = ? AND row = ? AND state = 'unknown'").run(batch, row);
      if (result.changes !== 1) throw new Error('REVIEW_STATE_CHANGED');
    },
    close() { db.close(); },
  };
}
