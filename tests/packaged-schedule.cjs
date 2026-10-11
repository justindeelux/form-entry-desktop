const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
(async () => {
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-schedule-'));
  const application = await _electron.launch({ executablePath: resolve(process.argv[2]), args: ['--smoke-test'], env: { ...process.env, FORM_ENTRY_SMOKE_DATA: profile }, timeout: 60000 });
  try {
    await application.evaluate(({ utilityProcess }) => {
      globalThis.scheduleCommands = []; globalThis.completedData = false;
      const setTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (callback, delay, ...args) => {
        const caller = new Error().stack.split('\n')[2];
        return setTimeout(callback, caller.includes('scheduler.js') ? 3000 : delay, ...args);
      };
      const fork = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (...args) => {
        const child = fork(...args), post = child.postMessage.bind(child), reloads = new Set();
        child.prependListener('message', message => {
          if (reloads.delete(message.id) && message.result.ok && globalThis.completedData) message.result.value.rows[1].values[1] = 'Đã bổ sung';
        });
        child.postMessage = message => {
          globalThis.scheduleCommands.push(message.command);
          if (message.command === 'reloadSheets' && message.args.allowEmpty) reloads.add(message.id);
          if (message.command === 'prepare') globalThis.schedulePrepareHook?.();
          post(message);
        };
        return child;
      };
    });
    const page = await application.firstWindow();
    const request = { sheetsUrl: 'https://docs.google.com/spreadsheets/d/local-fixture/edit?gid=0', formUrl: 'https://docs.google.com/forms/d/e/local-fixture/viewform' };
    assert.equal((await page.evaluate(request => window.desktop.startSchedule({ source: request, send: { mapping: {} }, rule: { mode: 'interval', minutes: 1 } }), request)).error, 'DATA_NOT_LOADED');
    await page.getByLabel('URL Google Sheets').fill(request.sheetsUrl);
    await page.getByLabel('URL Google Form').fill(request.formUrl);
    await page.getByRole('button', { name: 'Tải dữ liệu', exact: true }).click();
    await page.getByRole('tab', { name: 'Chưa gửi (2)', exact: true }).waitFor();
    const loaded = await page.evaluate(request => window.desktop.load(request), request);
    assert.equal(loaded.ok, true);
    const config = { mapping: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`q-${i}`, `column-${i}`])), defaults: {}, formatting: {}, aliases: { 'q-4': [{ source: 'TP.HCM', option: 'Hồ Chí Minh' }] } };
    await page.evaluate(({ request, data, config }) => {
      const saved = JSON.parse(localStorage.getItem('form-entry-settings-v1'));
      const binding = JSON.stringify([request.sheetsUrl, request.formUrl, data.source.columns.map(({ id, label, index }) => [id, label, index]), data.form.fingerprint]);
      localStorage.setItem('form-entry-settings-v1', JSON.stringify({ ...saved, ...config, binding }));
    }, { request, data: loaded.value, config });
    await page.reload();
    await page.getByRole('button', { name: 'Tải dữ liệu', exact: true }).click();
    await page.getByRole('button', { name: 'Chỉnh sửa mapping', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Chưa gửi (2)', exact: true }).waitFor();
    const sendButton = page.getByRole('button', { name: 'Gửi 2 dòng lên Form', exact: true });
    const scheduleButton = page.getByRole('button', { name: 'Đặt lịch', exact: true });
    const reloadButton = page.getByRole('button', { name: 'Tải lại Sheets', exact: true });
    const positions = await Promise.all([sendButton, scheduleButton, reloadButton].map(button => button.boundingBox()));
    assert.ok(positions[0].x < positions[1].x && positions[1].x < positions[2].x);
    await scheduleButton.click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Số phút giữa các lượt').fill('1');
    await mkdir('.local-checks', { recursive: true });
    await page.screenshot({ path: '.local-checks/schedule-modal.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
    await page.getByRole('button', { name: 'Dừng', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Chưa gửi (1)', exact: true }).waitFor();
    assert.equal(await reloadButton.isDisabled(), true);
    assert.equal((await page.evaluate(config => window.desktop.send(config.mapping, config.defaults, config.aliases), config)).error, 'SCHEDULE_ACTIVE');
    const countdown = page.locator('[aria-label="Đếm ngược lịch gửi"]');
    assert.ok((await countdown.boundingBox()).y < (await page.getByRole('button', { name: 'Dừng', exact: true }).boundingBox()).y);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const bar = countdown;
    const initial = Number(await bar.getAttribute('aria-valuenow'));
    assert.ok(initial > 95, 'Countdown starts nearly full');
    await page.waitForFunction(initial => Number(document.querySelector('[aria-label="Đếm ngược lịch gửi"]').getAttribute('aria-valuenow')) < initial, initial);
    const appearance = await bar.evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.getPropertyValue('--progress-section-color').trim(), orange: getComputedStyle(document.documentElement).getPropertyValue('--mantine-color-orange-6').trim(), transition: style.transitionDuration, timing: style.transitionTimingFunction };
    });
    assert.equal(appearance.color, appearance.orange);
    assert.equal(appearance.transition, '0.1s'); assert.equal(appearance.timing, 'linear');
    await page.screenshot({ path: '.local-checks/schedule-running.png', fullPage: true });
    await page.getByRole('tab', { name: 'Đã gửi (1)', exact: true }).waitFor({ timeout: 60000 });
    await application.evaluate(() => { globalThis.completedData = true; });
    await page.getByRole('tab', { name: 'Đã gửi (2)', exact: true }).waitFor({ timeout: 60000 });
    await page.waitForFunction(async () => { const state = await window.desktop.scheduleState(); return state.ok && state.value.active && !state.value.running; });
    const prepareCount = await application.evaluate(() => globalThis.scheduleCommands.filter(command => command === 'prepare').length);
    assert.equal(prepareCount, 2, 'Only newly complete source rows submitted');
    const reloadCount = await application.evaluate(() => globalThis.scheduleCommands.filter(command => command === 'reloadSheets').length);
    await page.waitForFunction(async () => { const state = await window.desktop.scheduleState(); return state.ok && state.value.active && !state.value.running; });
    // Stop while waiting; no overlapping or repeated submission of archived rows.
    await page.getByRole('button', { name: 'Dừng', exact: true }).click();
    await page.getByRole('button', { name: 'Đặt lịch', exact: true }).waitFor();
    assert.equal((await application.evaluate(() => globalThis.scheduleCommands.filter(command => command === 'prepare').length)), 2);
    const sent = await page.evaluate(config => window.desktop.history({ ...config, status: 'sent' }), config);
    assert.equal(sent.value.sentCount, 2);
    // Daily UI configuration, then stop before its accelerated due time.
    await page.getByRole('button', { name: 'Đặt lịch', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByText('Hàng ngày', { exact: true }).click();
    await dialog.getByLabel('Giờ', { exact: true }).fill('23');
    await dialog.getByLabel('Phút', { exact: true }).fill('59');
    await dialog.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
    await page.getByRole('button', { name: 'Dừng', exact: true }).click();
    await page.getByRole('button', { name: 'Đặt lịch', exact: true }).waitFor();
    // Stop during preparation: completed submit count must not increase.
    for (const row of sent.value.rows) await page.evaluate(id => window.desktop.deleteHistory(id), row.id);
    await page.evaluate(() => window.desktop.savePreferences({ retentionHours: 24, fieldDelayMs: 300 }));
    const submitCount = await application.evaluate(() => globalThis.scheduleCommands.filter(command => command === 'submit').length);
    const preparing = application.evaluate(() => new Promise(resolve => { globalThis.schedulePrepareHook = resolve; }));
    await page.getByRole('button', { name: 'Đặt lịch', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByText('Mỗi N phút', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
    await preparing;
    await page.getByRole('button', { name: 'Dừng', exact: true }).click();
    await page.getByRole('button', { name: 'Đặt lịch', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(await application.evaluate(() => globalThis.scheduleCommands.filter(command => command === 'submit').length), submitCount);
    const stopped = await page.evaluate(() => window.desktop.scheduleState());
    assert.equal(stopped.value.active, false); assert.equal(stopped.value.running, false);
    console.log('PACKAGED_SCHEDULE_PASSED', JSON.stringify({ reloadCount, completeRowsOnly: true, newRowsAfterCompletion: true, dailyControls: true, countdownPlacement: true, dedup: true, stopDuringPreparation: true, acceleratedFixtureTimer: true }));
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
