import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { matchesRow } from '../shared/row-filter';
import { deleteChromeProfile } from './profile';
import { z } from 'zod';
import { findChrome } from './browser';
import { createAutomation } from './automation';
import { openState, type Checkpoint } from './persistence';
import { scheduleStartSchema, type ScheduleRequest, formViewSchema, FieldValidationError, loadedSchema, loadSchema, sendSchema, reviewSchema, preferencesSchema, historyQuerySchema, historyDeleteSchema, parseFormUrl, parseSheetsUrl, type LoadedData, type Outcome, sourceSchema, type SheetColumns, type SendConfiguration, type Progress } from '../shared/contracts';
import { historyScope, sheetRows } from './row-history';
import { createScheduler } from './scheduler';
import { completeScheduledRows } from '../shared/schedule';
import { mapRow } from '../shared/mapping';
import { sameSheetCell, sheetCell, sheetStatus, sheetTimestamp, repeatDue, submissionUpdates, validateSheetColumns } from '../shared/sheet-state';
import { createUpdater } from './updater';

const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', process.env.FORM_ENTRY_SMOKE_DATA ?? mkdtempSync(join(tmpdir(), 'form-entry-smoke-')));
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('local.form-entry.desktop');
  const dataPath = app.getPath('userData');
  mkdirSync(dataPath, { recursive: true, mode: 0o700 });
  chmodSync(dataPath, 0o700);
  const store = openState(join(dataPath, 'state.json'), join(dataPath, 'phase0.sqlite'));
  const automation = createAutomation(smoke);
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl = pathToFileURL(rendererFile).href;
  const icon = join(app.getAppPath(), 'assets/app-icon.png');
  app.dock?.setIcon(icon);
  const window = new BrowserWindow({
    icon,
    width: 1180, height: 910, minWidth: 1000, minHeight: 650, title: 'Form Entry Desktop',
    webPreferences: { preload: join(__dirname, '../preload/bridge.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  let busy = false, closing = false, mayQuit = false;
  const closingSignal = new AbortController();
  let active: Promise<unknown> | undefined;
  let loaded: LoadedData | undefined;
  let sourceUrl = '', formUrl = '';
  let sourceRequest: z.infer<typeof loadSchema> | undefined;
  let scheduleRequest: ScheduleRequest | undefined;
  let scheduledColumns = '';
  const columnsSignature = (data: LoadedData) => JSON.stringify(data.source.columns.map(({ id, label, index }) => [id, label, index]));
  const scheduler = createScheduler(async signal => {
    if (busy) { try { await active; } catch { /* The current IPC operation reports its own error. */ } }
    if (closing || signal.aborted) return;
    busy = true;
    const request = scheduleRequest!;
    const task = (async () => {
      const fresh = await load(request.source, true, true);
      if (columnsSignature(fresh) !== scheduledColumns) { loaded = undefined; throw new Error('FORM_SCHEMA_CHANGED'); }
      if (signal.aborted) return;
      const result = await send(request.send, signal);
      if (result.state === 'unknown') throw new Error('SUBMISSION_UNKNOWN_REVIEW');
      if (result.state === 'failed') throw new Error('SCHEDULE_SEND_FAILED');
    })();
    active = task;
    try { await task; } finally { busy = false; active = undefined; }
  }, state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('schedule.changed', { ...state, data: loaded });
  });
  const updater = createUpdater(() => busy || closing || scheduler.state().active || scheduler.state().running, smoke, state => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('update.changed', state);
  });
  function trusted(event: IpcMainInvokeEvent) {
    return !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererUrl;
  }
  function handle(channel: string, action: (input: unknown) => Promise<unknown>) {
    ipcMain.handle(channel, async (event, input) => {
      if (!trusted(event)) return { ok: false, error: 'IPC_DENIED' };
      if (closing) return { ok: false, error: 'APP_CLOSING' };
      if (busy) return { ok: false, error: 'BUSY' };
      if (scheduler.state().active && ['data.load', 'data.reloadSheets', 'data.send', 'profile.delete', 'settings.save', 'data.confirmNotSent', 'data.confirmSent', 'data.deleteHistory', 'schedule.start'].includes(channel)) return { ok: false, error: 'SCHEDULE_ACTIVE' };
      busy = true;
      try { active = action(input); return { ok: true, value: await active }; }
      catch (error) {
        if (error instanceof FieldValidationError) return { ok: false, error: `ROW_VALIDATION_FAILED${error.row ? `:${error.row}` : ''}`,
          details: { fieldId: error.field.id, fieldTitle: error.field.title, reason: error.reason, row: error.row, column: error.column, choice: error.choice } };
        const code = error instanceof Error && /^[A-Z_]+(?::\d+)?$/.test(error.message) ? error.message : 'OPERATION_FAILED';
        return { ok: false, error: code };
      } finally { busy = false; active = undefined; }
    });
  }
  async function load(input: unknown, sheetsOnly = false, scheduled = false) {
    const previous = loaded;
    const request = loadSchema.parse(input);
    const sheets = parseSheetsUrl(request.sheetsUrl).url, form = parseFormUrl(request.formUrl);
    if (sheetsOnly && (!previous || sheets !== sourceUrl || form !== formUrl)) throw new Error('DATA_NOT_LOADED');
    loaded = undefined; sourceUrl = sheets; formUrl = form; sourceRequest = request;
    const chromePath = findChrome();
    if (!chromePath) throw new Error('BROWSER_NOT_FOUND');
    const result = await automation.request(sheetsOnly ? 'reloadSheets' : 'load', { sheetsUrl: sourceUrl, formUrl, requireLogin: request.requireLogin, startRow: request.startRow, minimizeChrome: store.preferences().minimizeChrome, chromePath, profilePath: join(dataPath, 'chrome-profile'), smoke, allowEmpty: true });
    loaded = loadedSchema.parse(sheetsOnly ? { source: result, form: previous!.form } : result);
    if (!scheduled && !closing && !window.isDestroyed()) { window.show(); window.focus(); }
    return loaded;
  }
  handle('data.load', input => load(input));
  handle('data.reloadSheets', input => load(input, true));
  const scope = () => historyScope(sourceUrl, formUrl);
  async function writeRow(row: { number: number; values: string[] }, sheetColumns: SheetColumns, updates: Record<string, string>) {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    const source = sourceSchema.parse(await automation.request('writeSheetRow', {
      sheetsUrl: sourceUrl, source: { ...loaded.source, rows: [row] }, row: row.number, sheetColumns, updates,
    }, 180000));
    loaded = { ...loaded, source };
  }
  async function syncCheckpoint(checkpoint: Checkpoint) {
    if (!loaded || checkpoint.sourceUrl !== sourceUrl || checkpoint.formUrl !== formUrl) throw new Error('DATA_NOT_LOADED');
    if (checkpoint.columns !== columnsSignature(loaded)) throw new Error('SHEET_ROW_CHANGED');
    const row = sheetRows(loaded.source, checkpoint.sheetColumns).find(row => row.id === checkpoint.id && row.number === checkpoint.row);
    if (!row) throw new Error('SHEET_ROW_CHANGED');
    for (const [id, baseline] of Object.entries(checkpoint.baseline)) {
      const actual = sheetCell(loaded.source, row.values, id);
      const desired = checkpoint.updates[id];
      if (actual !== baseline && (desired === undefined || !sameSheetCell(actual, desired, id === checkpoint.sheetColumns.sentAt))) throw new Error('SHEET_ROW_CHANGED');
    }
    await writeRow(row, checkpoint.sheetColumns, checkpoint.updates);
    store.clear(checkpoint.batch, checkpoint.row);
  }
  async function migrateLegacy(config: SendConfiguration) {
    for (const previous of store.legacyHistory(scope())) {
      const labels = z.array(z.string()).parse(JSON.parse(previous.columns_json));
      const values = z.array(z.string()).parse(JSON.parse(previous.values_json));
      const controls = Object.values(config.sheetColumns);
      const matches = sheetRows(loaded!.source, config.sheetColumns).filter(row => loaded!.source.columns
        .filter(column => !controls.includes(column.id)).every(column => {
          const index = labels.indexOf(column.label);
          return index >= 0 && labels.lastIndexOf(column.label) === index && values[index] === row.values[column.index];
        }));
      if (!matches.length) continue;
      for (const row of matches) {
        if (sheetStatus(loaded!.source, row.values, config.sheetColumns) === 'sent') continue;
        await writeRow(row, config.sheetColumns, submissionUpdates(loaded!.source, row.values, config.sheetColumns, false, new Date(previous.sent_at)));
      }
      store.migrated(`${scope()}:${previous.id}`);
    }
  }
  handle('profile.delete', async input => {
    z.object({}).strict().parse(input);
    await automation.request('close');
    try { await deleteChromeProfile(dataPath); }
    catch (error) { if (error instanceof Error && error.message === 'PROFILE_IN_USE') throw error; throw new Error('PROFILE_DELETE_FAILED'); }
    await window.webContents.session.clearStorageData();
    await window.webContents.session.clearCache();
    store.resetPreferences();
    automation.stop(); loaded = undefined; sourceUrl = ''; formUrl = '';
    scheduleRequest = undefined; sourceRequest = undefined; scheduledColumns = '';
  });
  handle('settings.read', async () => store.preferences());
  for (const channel of ['update.check', 'update.install', 'update.state']) {
    ipcMain.handle(channel, (event, input) => {
      if (!trusted(event)) return { ok: false, error: 'IPC_DENIED' };
      if (closing) return { ok: false, error: 'APP_CLOSING' };
      try {
        z.object({}).strict().parse(input);
        const value = channel === 'update.state' ? updater.state() : channel === 'update.check' ? updater.check() : updater.apply();
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'OPERATION_FAILED' };
      }
    });
  }
  handle('settings.save', async input => store.savePreferences(preferencesSchema.parse(input)));
  handle('data.history', async input => {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    const query = historyQuerySchema.parse(input);
    const source = sourceSchema.parse(await automation.request('readSheets'));
    const fresh = { ...loaded, source };
    if (columnsSignature(fresh) !== columnsSignature(loaded)) { loaded = undefined; throw new Error('FORM_SCHEMA_CHANGED'); }
    loaded = fresh;
    const allRows = sheetRows(loaded.source, query.sheetColumns);
    const rowsWithState = allRows.map(row => ({ ...row, state: sheetStatus(loaded!.source, row.values, query.sheetColumns) }));
    const counts = { unsentCount: rowsWithState.filter(row => row.state === 'unsent').length, sentCount: rowsWithState.filter(row => row.state === 'sent').length };
    const rows = rowsWithState.filter(row => row.state === query.status && matchesRow(row.values, query.search, query.column))
      .filter(row => !query.cursor || row.number < query.cursor.order || row.number === query.cursor.order && row.id < query.cursor.id);
    const pending = store.checkpoints().filter(item => item.sourceUrl === sourceUrl && item.formUrl === formUrl);
    const visible = rows.slice(0, 20).map(row => ({ ...row, columns: loaded!.source.columns.map(column => column.label), order: row.number,
      state: pending.some(item => item.row === row.number) ? 'unknown' : row.state,
      sentAt: sheetTimestamp(sheetCell(loaded!.source, row.values, query.sheetColumns.sentAt)),
    }));
    return { rows: visible, ...counts, nextCursor: rows.length > 20 ? { order: visible[19].order, id: visible[19].id } : undefined };
  });
  handle('data.viewForm', async input => {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    const query = formViewSchema.parse(input);
    const row = sheetRows(loaded.source, query.sheetColumns).find(row => row.id === query.id);
    if (!row) throw new Error('HISTORY_ROW_CHANGED');
    try {
      return { formUrl, form: loaded.form, payload: mapRow(loaded, row.values, query.mapping, query.defaults, new Date(), query.aliases, query.formatting) };
    } catch (error) {
      if (error instanceof FieldValidationError) { error.row = row.number; error.column = loaded.source.columns.find(column => column.id === query.mapping[error.field.id])?.label; }
      throw error;
    }
  });
  handle('data.deleteHistory', async input => {
    if (!loaded || !sourceRequest) throw new Error('DATA_NOT_LOADED');
    if (store.uncertain()) throw new Error('SUBMISSION_UNKNOWN_REVIEW');
    const { id, sheetColumns } = historyDeleteSchema.parse(input);
    await load(sourceRequest, true, true);
    validateSheetColumns(loaded.source, sheetColumns);
    const row = sheetRows(loaded.source, sheetColumns).find(row => row.id === id);
    if (!row) throw new Error('HISTORY_ROW_CHANGED');
    await writeRow(row, sheetColumns, { [sheetColumns.result!]: 'Chưa gửi', [sheetColumns.sentAt!]: '', ...(sheetColumns.repeated ? { [sheetColumns.repeated]: '0' } : {}) });
  });
  handle('data.pending', async () => store.pending());
  handle('data.confirmNotSent', async input => {
    const { batch, row } = reviewSchema.parse(input);
    store.confirmNotSent(batch, row);
  });
  handle('data.confirmSent', async input => {
    const { batch, row } = reviewSchema.parse(input);
    if (store.pending().some(item => item.batch === batch && item.row === row && item.sourceUrl === '')) {
      store.confirmLegacySent(batch, row); return;
    }
    if (!sourceRequest) throw new Error('DATA_NOT_LOADED');
    await load(sourceRequest, true, true);
    const checkpoint = store.checkpoint(batch, row);
    if (checkpoint.sourceUrl !== sourceUrl || checkpoint.formUrl !== formUrl) throw new Error('DATA_NOT_LOADED');
    await syncCheckpoint(store.submitted(batch, row));
  });
  async function send(input: unknown, signal?: AbortSignal): Promise<Progress> {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    if (store.uncertain()) throw new Error('SUBMISSION_UNKNOWN_REVIEW');
    const config = sendSchema.parse(input);
    const { mapping, defaults, aliases, formatting, sheetColumns } = config;
    if (!signal) {
      const signature = columnsSignature(loaded);
      if (!sourceRequest) throw new Error('DATA_NOT_LOADED');
      await load(sourceRequest, true, true);
      if (columnsSignature(loaded!) !== signature) throw new Error('FORM_SCHEMA_CHANGED');
    }
    validateSheetColumns(loaded!.source, sheetColumns);
    await migrateLegacy(config);
    const snapshot = loaded!;
    const now = new Date();
    const candidates = signal ? completeScheduledRows(snapshot, config, now).source : snapshot.source;
    const allRows = sheetRows(candidates, sheetColumns);
    // Validate every selected row before the first real submission.
    const rows = allRows.filter(row => {
      const sent = sheetStatus(snapshot.source, row.values, sheetColumns) === 'sent';
      try { return !sent || !!signal && repeatDue(snapshot.source, row.values, sheetColumns, now); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : 'SHEET_REPEAT_INVALID'}:${row.number}`); }
    }).map(row => {
      try { return { ...row, repeat: sheetStatus(snapshot.source, row.values, sheetColumns) === 'sent', payload: mapRow(snapshot, row.values, mapping, defaults, now, aliases, formatting) }; }
      catch (error) {
        if (error instanceof FieldValidationError) {
          error.row = row.number;
          error.column = snapshot.source.columns.find(column => column.id === mapping[error.field.id])?.label;
          throw error;
        }
        throw new Error(`ROW_VALIDATION_FAILED:${row.number}`);
      }
    });
    const batch = createHash('sha256').update(JSON.stringify([scope(), rows.map(row => row.id)])).digest('hex');
    let progress: Progress = { submitted: 0, total: rows.length, state: 'running' };
    const notify = () => { if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('data.progress', progress); };
    notify();
    const preferences = store.preferences();
    const delay = preferences.sendDelaySeconds * 1000;
    const abort = signal ? AbortSignal.any([signal, closingSignal.signal]) : closingSignal.signal;
    let hasSubmitted = false;
    for (const row of rows) {
      if (closing) throw new Error('APP_CLOSING');
      if (signal?.aborted) break;
      if (hasSubmitted && delay) {
        try { await wait(delay, undefined, { signal: abort }); }
        catch (error) { if (closing) throw new Error('APP_CLOSING'); if (signal?.aborted) break; throw error; }
      }
      if (closing) throw new Error('APP_CLOSING');
      const request = { fingerprint: snapshot.form.fingerprint, payload: row.payload, fieldDelayMs: preferences.fieldDelayMs };
      try { await automation.request('prepare', request, 60000 + Math.max(0, snapshot.form.fields.length - 1) * preferences.fieldDelayMs); }
      catch (error) {
        if (error instanceof FieldValidationError) { error.row = row.number; error.column = snapshot.source.columns.find(column => column.id === mapping[error.field.id])?.label; }
        if (error instanceof Error && error.message === 'AUTOMATION_FAILED') throw new Error(`FORM_PREPARATION_FAILED:${row.number}`);
        if (error instanceof Error && /^[A-Z_]+$/.test(error.message)) throw new Error(`${error.message}:${row.number}`);
        throw error;
      }
      if (closing) throw new Error('APP_CLOSING');
      if (signal?.aborted) break;
      const updates = submissionUpdates(snapshot.source, row.values, sheetColumns, row.repeat, new Date());
      const sheetRequest = { sheetsUrl: sourceUrl, source: { ...snapshot.source, rows: [row] }, row: row.number, sheetColumns, updates };
      await automation.request('checkSheetRow', sheetRequest);
      if (closing) throw new Error('APP_CLOSING');
      if (signal?.aborted) break;
      store.begin({ batch, row: row.number, state: 'unknown', sourceUrl, formUrl, id: row.id, columns: columnsSignature(snapshot), sheetColumns,
        baseline: Object.fromEntries(Object.values(sheetColumns).filter((id): id is string => !!id).map(id => [id, sheetCell(snapshot.source, row.values, id)])), updates });
      let outcome: Outcome = 'unknown', notSent = false;
      try {
        const result = z.enum(['submitted', 'failed', 'unknown', 'not_sent']).parse(await automation.request('submit', request));
        notSent = result === 'not_sent'; outcome = notSent ? 'failed' : result as Outcome;
      }
      finally {
        if (outcome === 'submitted') store.submitted(batch, row.number, submissionUpdates(snapshot.source, row.values, sheetColumns, row.repeat, new Date()));
        else if (outcome === 'failed') store.clear(batch, row.number);
        progress = { ...progress, row: row.number, state: outcome === 'submitted' ? 'running' : outcome, submitted: progress.submitted + (outcome === 'submitted' ? 1 : 0), ...(notSent ? { reason: 'SUBMIT_NOT_CLICKED' as const } : {}) };
        notify();
      }
      if (outcome !== 'submitted') return progress;
      await syncCheckpoint(store.checkpoint(batch, row.number));
      hasSubmitted = true;
    }
    progress = { ...progress, state: signal?.aborted ? 'stopped' : 'submitted' }; notify(); return progress;
  }
  handle('data.send', input => send(input));
  handle('schedule.start', async input => {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    if (store.uncertain()) throw new Error('SUBMISSION_UNKNOWN_REVIEW');
    const request = scheduleStartSchema.parse(input);
    if (parseSheetsUrl(request.source.sheetsUrl).url !== sourceUrl || parseFormUrl(request.source.formUrl) !== formUrl) throw new Error('DATA_NOT_LOADED');
    validateSheetColumns(loaded.source, request.send.sheetColumns);
    completeScheduledRows(loaded, request.send);
    scheduleRequest = request; scheduledColumns = columnsSignature(loaded);
    return { ...scheduler.start(request.rule), data: loaded };
  });
  ipcMain.handle('schedule.state', (event, input) => {
    if (!trusted(event)) return { ok: false, error: 'IPC_DENIED' };
    try { z.object({}).strict().parse(input); return { ok: true, value: { ...scheduler.state(), data: loaded } }; }
    catch { return { ok: false, error: 'OPERATION_FAILED' }; }
  });
  ipcMain.handle('schedule.stop', (event, input) => {
    if (!trusted(event)) return { ok: false, error: 'IPC_DENIED' };
    try { z.object({}).strict().parse(input); return { ok: true, value: { ...scheduler.stop(), data: loaded } }; }
    catch { return { ok: false, error: 'OPERATION_FAILED' }; }
  });
  window.on('close', event => {
    if (!mayQuit) { event.preventDefault(); app.quit(); }
  });
  app.on('before-quit', event => {
    if (mayQuit) return;
    event.preventDefault();
    if (closing) return;
    closing = true; closingSignal.abort(); scheduler.stop(); updater.stop();
    void (async () => {
      try { await active; } catch { /* The IPC handler reports the error. */ }
      try { await automation.request('close'); } catch { /* Browser may already be closed. */ }
      automation.stop(); mayQuit = true; updater.finishQuit();
    })();
  });
  app.on('will-quit', () => store.close());
  try { await window.loadFile(rendererFile); if (!closing) updater.start(); }
  catch (error) { if (!closing && !window.isDestroyed()) throw error; }
}).catch(() => { console.error('APP_START_FAILED'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
