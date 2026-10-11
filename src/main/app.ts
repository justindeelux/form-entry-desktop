import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { chmodSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
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
import { openDatabase } from './persistence';
import { scheduleStartSchema, type ScheduleRequest, formViewSchema, FieldValidationError, loadedSchema, loadSchema, sendSchema, reviewSchema, preferencesSchema, historyQuerySchema, historyDeleteSchema, parseFormUrl, parseSheetsUrl, type LoadedData, type Outcome, type Progress } from '../shared/contracts';
import { historyScope, uniqueSheetRows } from './row-history';
import { createScheduler } from './scheduler';
import { completeScheduledRows } from '../shared/schedule';
import { mapRow } from '../shared/mapping';
import { createUpdater } from './updater';

const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', process.env.FORM_ENTRY_SMOKE_DATA ?? mkdtempSync(join(tmpdir(), 'form-entry-smoke-')));
if (require('electron-squirrel-startup') || !app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.FormEntryDesktop.FormEntryDesktop');
  const dataPath = app.getPath('userData');
  mkdirSync(dataPath, { recursive: true, mode: 0o700 });
  chmodSync(dataPath, 0o700);
  const database = openDatabase(join(dataPath, 'phase0.sqlite'));
  for (const suffix of ['', '-wal', '-shm']) { const file = join(dataPath, `phase0.sqlite${suffix}`); if (existsSync(file)) chmodSync(file, 0o600); }
  const historyCleanup = setInterval(() => { if (!busy) database.prune(); }, 60000);
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
  let scheduleRequest: ScheduleRequest | undefined;
  let scheduledRaw: LoadedData | undefined;
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
      scheduledRaw = fresh;
      if (signal.aborted) return;
      loaded = completeScheduledRows(fresh, request.send);
      const result = await send(request.send, signal);
      if (result.state === 'unknown') throw new Error('SUBMISSION_UNKNOWN_REVIEW');
      if (result.state === 'failed') throw new Error('SCHEDULE_SEND_FAILED');
    })();
    active = task;
    try { await task; } finally { busy = false; active = undefined; }
  }, state => {
    if (!state.active && !state.running && loaded && scheduledRaw) loaded = scheduledRaw;
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('schedule.changed', { ...state, data: loaded });
  });
  const updater = createUpdater(() => busy || closing || scheduler.state().active || scheduler.state().running, smoke);
  function trusted(event: IpcMainInvokeEvent) {
    return !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererUrl;
  }
  function handle(channel: string, action: (input: unknown) => Promise<unknown>) {
    ipcMain.handle(channel, async (event, input) => {
      if (!trusted(event)) return { ok: false, error: 'IPC_DENIED' };
      if (closing) return { ok: false, error: 'APP_CLOSING' };
      if (busy) return { ok: false, error: 'BUSY' };
      if (scheduler.state().active && ['data.load', 'data.reloadSheets', 'data.send', 'profile.delete', 'settings.save', 'data.confirmNotSent', 'data.deleteHistory', 'schedule.start'].includes(channel)) return { ok: false, error: 'SCHEDULE_ACTIVE' };
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
    loaded = undefined; sourceUrl = sheets; formUrl = form;
    const chromePath = findChrome();
    if (!chromePath) throw new Error('BROWSER_NOT_FOUND');
    const result = await automation.request(sheetsOnly ? 'reloadSheets' : 'load', { sheetsUrl: sourceUrl, formUrl, requireLogin: request.requireLogin, startRow: request.startRow, minimizeChrome: database.preferences().minimizeChrome, chromePath, profilePath: join(dataPath, 'chrome-profile'), smoke, allowEmpty: scheduled });
    loaded = loadedSchema.parse(sheetsOnly ? { source: result, form: previous!.form } : result);
    if (!scheduled && !closing && !window.isDestroyed()) { window.show(); window.focus(); }
    return loaded;
  }
  handle('data.load', input => load(input));
  handle('data.reloadSheets', input => load(input, true));
  const scope = () => historyScope(sourceUrl, formUrl);
  const record = (row: { number: number; values: string[]; id: string }) => ({ scope: scope(), id: row.id, number: row.number, columns: loaded!.source.columns.map(column => column.label), values: row.values });
  handle('profile.delete', async input => {
    z.object({}).strict().parse(input);
    await automation.request('close');
    try { await deleteChromeProfile(dataPath); }
    catch (error) { if (error instanceof Error && error.message === 'PROFILE_IN_USE') throw error; throw new Error('PROFILE_DELETE_FAILED'); }
    await window.webContents.session.clearStorageData();
    await window.webContents.session.clearCache();
    database.reset();
    automation.stop(); loaded = undefined; sourceUrl = ''; formUrl = '';
    scheduleRequest = undefined; scheduledRaw = undefined; scheduledColumns = '';
  });
  handle('settings.read', async () => database.preferences());
  handle('update.check', async input => { z.object({}).strict().parse(input); updater.check(true); });
  handle('settings.save', async input => database.savePreferences(preferencesSchema.parse(input)));
  handle('data.history', async input => {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    const query = historyQuerySchema.parse(input);
    const ids = database.sentIds(scope());
    const unknown = database.unresolvedIds(scope());
    const unsent = uniqueSheetRows(loaded.source).filter(row => !ids.has(row.id));
    const counts = { unsentCount: unsent.length, sentCount: ids.size, retentionHours: database.preferences().retentionHours, deleteExpired: database.preferences().deleteExpired };
    if (query.status === 'sent') return { ...database.history(scope(), query.cursor, query.search, query.column), ...counts };
    const rows = unsent.filter(row => matchesRow(row.values, query.search, query.column)).filter(row => !query.cursor || row.number < query.cursor.order || row.number === query.cursor.order && row.id < query.cursor.id);
    const visible = rows.slice(0, 20).map(row => ({ ...record(row), order: row.number, state: unknown.has(row.id) ? 'unknown' : 'unsent' }));
    return { rows: visible, ...counts, nextCursor: rows.length > 20 ? { order: visible[19].order, id: visible[19].id } : undefined };
  });
  handle('data.viewForm', async input => {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    const query = formViewSchema.parse(input);
    if (query.status === 'sent') return database.viewForm(scope(), query.id);
    const row = uniqueSheetRows(loaded.source).find(row => row.id === query.id);
    if (!row) throw new Error('HISTORY_ROW_CHANGED');
    try {
      return { formUrl, form: loaded.form, payload: mapRow(loaded, row.values, query.mapping, query.defaults, new Date(), query.aliases, query.formatting) };
    } catch (error) {
      if (error instanceof FieldValidationError) { error.row = row.number; error.column = loaded.source.columns.find(column => column.id === query.mapping[error.field.id])?.label; }
      throw error;
    }
  });
  handle('data.deleteHistory', async input => {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    database.deleteHistory(scope(), historyDeleteSchema.parse(input).id);
  });
  handle('data.pending', async () => database.pending());
  handle('data.confirmNotSent', async input => {
    const { batch, row } = reviewSchema.parse(input);
    database.confirmNotSent(batch, row);
  });
  async function send(input: unknown, signal?: AbortSignal): Promise<Progress> {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    if (database.uncertain()) throw new Error('SUBMISSION_UNKNOWN_REVIEW');
    const { mapping, defaults, aliases, formatting } = sendSchema.parse(input);
    const snapshot = loaded;
    const now = new Date();
    const sentIds = database.sentIds(scope());
    const allRows = uniqueSheetRows(snapshot.source);
    // Validate every row before the first real submission.
    const rows = allRows.filter(row => !sentIds.has(row.id)).map(row => {
      try { return { ...row, payload: mapRow(snapshot, row.values, mapping, defaults, now, aliases, formatting) }; }
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
    let progress: Progress = { submitted: allRows.length - rows.length, total: allRows.length, state: 'running' };
    const notify = () => { if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('data.progress', progress); };
    notify();
    const preferences = database.preferences();
    const delay = preferences.sendDelaySeconds * 1000;
    const abort = signal ? AbortSignal.any([signal, closingSignal.signal]) : closingSignal.signal;
    let hasSubmitted = false;
    for (const row of rows) {
      if (closing) throw new Error('APP_CLOSING');
      if (signal?.aborted) break;
      if (database.sentIds(scope()).has(row.id)) { progress.submitted++; continue; }
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
      database.begin(batch, row.number, record(row));
      let outcome: Outcome = 'unknown', notSent = false;
      try {
        const result = z.enum(['submitted', 'failed', 'unknown', 'not_sent']).parse(await automation.request('submit', request));
        notSent = result === 'not_sent'; outcome = notSent ? 'failed' : result as Outcome;
      }
      finally {
        database.finish(batch, row.number, outcome, { ...record(row), form: { formUrl, form: snapshot.form, payload: row.payload } });
        progress = { ...progress, row: row.number, state: outcome === 'submitted' ? 'running' : outcome, submitted: progress.submitted + (outcome === 'submitted' ? 1 : 0), ...(notSent ? { reason: 'SUBMIT_NOT_CLICKED' as const } : {}) };
        notify();
      }
      if (outcome !== 'submitted') return progress;
      hasSubmitted = true;
    }
    progress = { ...progress, state: signal?.aborted ? 'stopped' : 'submitted' }; notify(); return progress;
  }
  handle('data.send', input => send(input));
  handle('schedule.start', async input => {
    if (!loaded) throw new Error('DATA_NOT_LOADED');
    if (database.uncertain()) throw new Error('SUBMISSION_UNKNOWN_REVIEW');
    const request = scheduleStartSchema.parse(input);
    if (parseSheetsUrl(request.source.sheetsUrl).url !== sourceUrl || parseFormUrl(request.source.formUrl) !== formUrl) throw new Error('DATA_NOT_LOADED');
    const filtered = completeScheduledRows(loaded, request.send);
    scheduleRequest = request; scheduledRaw = loaded; scheduledColumns = columnsSignature(loaded); loaded = filtered;
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
  app.on('will-quit', () => { clearInterval(historyCleanup); database.close(); });
  try { await window.loadFile(rendererFile); if (!closing) updater.start(); }
  catch (error) { if (!closing && !window.isDestroyed()) throw error; }
}).catch(() => { console.error('APP_START_FAILED'); app.exit(1); });
app.on('window-all-closed', () => app.quit());
