const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
(async () => {
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-reload-'));
  const application = await _electron.launch({ executablePath: resolve(process.argv[2]), args: ['--smoke-test'], env: { ...process.env, FORM_ENTRY_SMOKE_DATA: profile }, timeout: 60000 });
  try {
    await application.evaluate(({ utilityProcess }) => {
      globalThis.reloadCommands = [];
      const fork = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (...args) => {
        const child = fork(...args); globalThis.reloadWorker = child;
        const post = child.postMessage.bind(child);
        child.postMessage = message => { globalThis.reloadCommands.push(message.command); post(message); };
        return child;
      };
    });
    const page = await application.firstWindow();
    const request = { sheetsUrl: 'https://docs.google.com/spreadsheets/d/local-fixture/edit?gid=0', formUrl: 'https://docs.google.com/forms/d/e/local-fixture/viewform' };
    assert.equal((await page.evaluate(request => window.desktop.reloadSheets(request), request)).error, 'DATA_NOT_LOADED');
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
    const commandsBefore = await application.evaluate(() => [...globalThis.reloadCommands]);
    await page.getByRole('button', { name: 'Tải lại Sheets', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Tải lại Sheets') && !button.disabled));
    await page.getByRole('button', { name: 'Gửi 2 dòng lên Form', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('tbody')?.textContent.includes('Trần Bình'));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('form-entry-settings-v1')));
    for (const key of Object.keys(config)) assert.deepEqual(saved[key], config[key]);
    assert.equal(await page.getByRole('button', { name: 'Chỉnh sửa mapping', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.deepEqual((await application.evaluate(() => globalThis.reloadCommands)).slice(commandsBefore.length), ['reloadSheets']);
    await page.getByRole('button', { name: 'Gửi 2 dòng lên Form', exact: true }).click();
    await page.getByText('Đã gửi 2/2 dòng. Hoàn tất.', { exact: true }).waitFor({ timeout: 60000 });
    const send = await page.getByRole('button', { name: 'Gửi 0 dòng lên Form', exact: true }).boundingBox();
    const status = await page.locator('[role="status"]').filter({ hasText: 'Đã gửi 2/2 dòng.' }).boundingBox();
    const table = await page.getByRole('table').boundingBox();
    assert.ok(status.y >= send.y + send.height && status.y + status.height <= table.y, 'Progress directly below actions and above table');
    await page.getByRole('button', { name: 'Tải lại Sheets', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Tải lại Sheets') && !button.disabled));
    await page.getByRole('tab', { name: 'Đã gửi (2)', exact: true }).waitFor();
    const sent = await page.evaluate(config => window.desktop.history({ ...config, status: 'sent' }), config);
    assert.equal(sent.value.sentCount, 2); assert.equal(sent.value.unsentCount, 0);
    await mkdir('.local-checks', { recursive: true });
    await page.screenshot({ path: '.local-checks/reload.png', fullPage: true });
    await application.evaluate(() => new Promise(resolve => { globalThis.reloadWorker.once('exit', resolve); globalThis.reloadWorker.kill(); }));
    await page.getByRole('button', { name: 'Tải lại Sheets', exact: true }).click();
    await page.getByText('Chrome đã đóng. Bấm Tải dữ liệu để mở lại.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Gửi \d+ dòng lên Form$/ }).count(), 0);
    assert.deepEqual((await page.evaluate(() => JSON.parse(localStorage.getItem('form-entry-settings-v1')))).mapping, config.mapping);
    console.log('PACKAGED_RELOAD_PASSED');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
