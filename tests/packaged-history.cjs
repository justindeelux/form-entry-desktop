const { _electron } = require('playwright-core');
const { waitForState } = require('./wait-for-state.cjs');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rename } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

(async () => {
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-sheet-history-'));
  const source = { sheetsUrl: 'https://docs.google.com/spreadsheets/d/local-fixture/edit?gid=0', formUrl: 'https://docs.google.com/forms/d/e/local-fixture/viewform' };
  const config = {
    mapping: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`q-${i}`, `column-${i}`])),
    defaults: { 'q-1': 'Đủ dữ liệu' }, aliases: { 'q-4': [{ source: 'TP.HCM', option: 'Hồ Chí Minh' }] }, formatting: {},
    sheetColumns: { repeat: 'column-6', repeatDays: 'column-7', repeated: 'column-8', result: 'column-9', sentAt: 'column-10' },
  };
  const options = { executablePath: resolve(process.argv[2]), args: process.argv.includes('--development') ? [resolve('.'), '--smoke-test'] : ['--smoke-test'], env: { ...process.env, FORM_ENTRY_SMOKE_DATA: profile }, timeout: 60000 };
  let application, page;
  async function open() {
    application = await _electron.launch(options);
    await application.evaluate(({ utilityProcess }) => {
      globalThis.fixtureCommands = []; globalThis.failNextWrite = false;
      const originalTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(callback, new Error().stack.split('\n')[2].includes('scheduler.js') ? 800 : delay, ...args);
      const fork = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (...args) => {
        const child = fork(...args), post = child.postMessage.bind(child);
        child.postMessage = message => {
          globalThis.fixtureCommands.push(message.command);
          if (message.command === 'writeSheetRow' && globalThis.failNextWrite) {
            globalThis.failNextWrite = false;
            setImmediate(() => child.emit('message', { id: message.id, result: { ok: false, error: 'SHEETS_WRITE_FAILED' } }));
          } else post(message);
        };
        return child;
      };
    });
    page = await application.firstWindow();
    await page.getByLabel('URL Google Sheets').waitFor();
    await waitForState(page, async () => (await window.desktop.preferences()).ok);
    assert.equal((await page.evaluate(source => window.desktop.load(source), source)).ok, true);
  }
  const send = () => page.evaluate(config => window.desktop.send(config.mapping, config.defaults, config.aliases, config.formatting, config.sheetColumns), config);
  const history = status => page.evaluate(({ config, status }) => window.desktop.history({ ...config, status }), { config, status });
  const submissions = () => application.evaluate(() => globalThis.fixtureCommands.filter(command => command === 'submit').length);
  async function editSheet(edit) {
    const path = join(profile, 'smoke-sheet.json'), sheet = JSON.parse(await readFile(path, 'utf8'));
    edit(sheet);
    await writeFile(`${path}.tmp`, JSON.stringify(sheet)); await rename(`${path}.tmp`, path);
  }
  const start = async () => {
    const result = await page.evaluate(({ source, config }) => window.desktop.startSchedule({ source, send: config, rule: { mode: 'interval', minutes: 1 } }), { source, config });
    assert.equal(result.ok, true, JSON.stringify(result));
  };
  const stop = async () => {
    assert.equal((await page.evaluate(() => window.desktop.stopSchedule())).ok, true);
    await waitForState(page, async () => { const result = await window.desktop.scheduleState(); return result.ok && !result.value.active && !result.value.running; });
  };
  try {
    await open();
    assert.deepEqual((await page.evaluate(() => window.desktop.preferences())).value, { sendDelaySeconds: 0, fieldDelayMs: 0, minimizeChrome: false });
    assert.equal((await page.evaluate(config => window.desktop.send(config.mapping, config.defaults, config.aliases), config)).error, 'SHEET_MAPPING_INVALID');
    assert.equal(await submissions(), 0);
    const initial = await history('unsent'); assert.equal(initial.value.unsentCount, 2);
    const filtered = await page.evaluate(config => window.desktop.history({ ...config, status: 'unsent', search: 'nguyen thi anh', column: 0 }), config);
    assert.equal(filtered.value.rows.length, 1);
    assert.equal((await page.evaluate(() => window.desktop.savePreferences({ retentionHours: 24 }))).ok, false);

    // A confirmed submit followed by a denied Sheet write must survive restart.
    await application.evaluate(() => { globalThis.failNextWrite = true; });
    const failedWrite = await send(); assert.equal(failedWrite.error, 'SHEETS_WRITE_FAILED');
    assert.equal(await submissions(), 1);
    let pending = (await page.evaluate(() => window.desktop.pendingSubmissions())).value;
    assert.equal(pending.length, 1); assert.equal(pending[0].state, 'submitted');
    assert.equal((await send()).error, 'SUBMISSION_UNKNOWN_REVIEW');
    await application.close(); await open();
    pending = (await page.evaluate(() => window.desktop.pendingSubmissions())).value;
    assert.equal(pending[0].state, 'submitted');
    assert.equal((await page.evaluate(item => window.desktop.confirmNotSent(item), pending[0])).error, 'REVIEW_STATE_CHANGED');
    assert.equal((await page.evaluate(item => window.desktop.confirmSent(item), pending[0])).ok, true);
    assert.equal(await submissions(), 0, 'Repair must not submit the Form again');
    assert.deepEqual((await page.evaluate(() => window.desktop.pendingSubmissions())).value, []);
    assert.equal((await history('sent')).value.sentCount, 1);
    const remaining = await send(); assert.equal(remaining.ok, true); assert.equal(remaining.value.submitted, 1);
    let sent = await history('sent'); assert.equal(sent.value.sentCount, 2);
    for (const row of sent.value.rows) {
      assert.equal(row.values[9], 'Đã gửi'); assert.equal(row.values[8], '0');
      assert.match(row.values[10], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      assert.deepEqual(row.values.slice(0, 8), initial.value.rows.find(item => item.number === row.number).values.slice(0, 8));
    }

    const beforeRepeats = await submissions();
    // Manual sends skip even overdue repetitions. A schedule sends one, then waits again.
    await editSheet(sheet => { sheet.rows[0].values[10] = '2020-01-01T14:30:42'; sheet.rows[1].values[6] = ''; sheet.rows[1].values[10] = '2020-01-01T14:30:42'; });
    assert.equal((await send()).value.submitted, 0);
    await start();
    await waitForState(page, async () => { const result = await window.desktop.scheduleState(); return result.ok && !result.value.running && result.value.data?.source.rows.find(row => row.number === 2)?.values[8] === '1'; });
    await stop();
    assert.equal(await submissions(), beforeRepeats + 1, JSON.stringify(await application.evaluate(() => globalThis.fixtureCommands)));
    assert.equal((await history('sent')).value.rows.find(row => row.number === 3).values[8], '0', 'Blank repeat count is ignored');
    await editSheet(sheet => { sheet.rows[0].values[10] = '2020-01-01T14:30:42'; });
    await start();
    await waitForState(page, async () => { const result = await window.desktop.scheduleState(); return result.ok && !result.value.running && result.value.data?.source.rows.find(row => row.number === 2)?.values[8] === '2'; });
    await stop(); assert.equal(await submissions(), beforeRepeats + 2);
    await editSheet(sheet => { sheet.rows[0].values[10] = '2020-01-01T14:30:42'; sheet.rows[1].values[6] = '2'; sheet.rows[1].values[7] = ''; });
    const reloads = await application.evaluate(() => globalThis.fixtureCommands.filter(command => command === 'reloadSheets').length);
    await start();
    await waitForState(page, async () => { const result = await window.desktop.scheduleState(); return result.ok && result.value.active && !result.value.running; });
    const deadline = Date.now() + 30000;
    while (await application.evaluate(() => globalThis.fixtureCommands.filter(command => command === 'reloadSheets').length) < reloads + 2) {
      if (Date.now() > deadline) throw new Error('Schedule did not refresh Sheets twice');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await stop(); assert.equal(await submissions(), beforeRepeats + 2, 'The maximum and a blank interval prevent further repeats');

    // Invalid control values stop the scheduler without a new submit.
    await editSheet(sheet => { sheet.rows[0].values[8] = '0'; sheet.rows[0].values[7] = '0'; });
    await start();
    await waitForState(page, async () => { const result = await window.desktop.scheduleState(); return result.ok && !result.value.active && result.value.error === 'SHEET_REPEAT_INVALID:2'; });
    assert.equal(await submissions(), beforeRepeats + 2);

    // History and paging come from the current Sheet, including identical physical rows.
    await editSheet(sheet => {
      const values = [...sheet.rows[0].values]; values[7] = '1'; values[8] = ''; values[9] = ''; values[10] = '';
      sheet.rows = Array.from({ length: 25 }, (_, index) => ({ number: index + 2, values: [...values] }));
    });
    const first = await history('unsent'); assert.equal(first.value.unsentCount, 25); assert.equal(first.value.rows.length, 20);
    assert.equal(new Set(first.value.rows.map(row => row.id)).size, 20);
    const second = await page.evaluate(({ config, cursor }) => window.desktop.history({ ...config, status: 'unsent', cursor }), { config, cursor: first.value.nextCursor });
    assert.equal(second.value.rows.length, 5); assert.equal(second.value.nextCursor, undefined);
    const { existsSync } = require('node:fs'); assert.equal(existsSync(join(profile, 'phase0.sqlite')), false);
    // Reset deliberately discards a confirmed pending send and even unreadable local OAuth files.
    await application.evaluate(() => { globalThis.failNextWrite = true; });
    assert.equal((await send()).error, 'SHEETS_WRITE_FAILED');
    assert.equal((await page.evaluate(() => window.desktop.pendingSubmissions())).value.length, 1);
    await writeFile(join(profile, 'google-token.enc'), 'unreadable-token-fixture');
    await writeFile(join(profile, 'google-token.enc.tmp'), 'unfinished-token-fixture');
    assert.equal((await page.evaluate(() => window.desktop.deleteProfile())).ok, true);
    assert.deepEqual((await page.evaluate(() => window.desktop.pendingSubmissions())).value, []);
    for (const file of ['state.json', 'state.json.tmp', 'google-token.enc', 'google-token.enc.tmp', 'chrome-profile']) assert.equal(existsSync(join(profile, file)), false);
    assert.equal((await page.evaluate(() => window.desktop.googleState())).value.connected, false);
    await application.close(); await open();
    assert.deepEqual((await page.evaluate(() => window.desktop.pendingSubmissions())).value, []);
    console.log('SHEETS_STORAGE_PASSED' , JSON.stringify({ explicitMapping: true, sheetHistory: true, writeFailureRecovery: true, restart: true, manualDoesNotRepeat: true, scheduledRepeatLimit: true, blankControlsSkipped: true, invalidControlsStop: true, paging: true, noSqlWrites: true }));
  } finally { if (application) await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
