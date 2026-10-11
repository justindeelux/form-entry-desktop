const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
(async () => {
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-start-row-'));
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
    await application.evaluate(({ app }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { join } = require('node:path');
      const assert = require('node:assert/strict');
      const { openDatabase } = require(join(app.getAppPath(), 'dist/main/persistence.js'));
      const path = join(app.getPath('userData'), 'legacy-check.sqlite');
      let db = openDatabase(path);
      db.begin('old-full-range', 2); db.finish('old-full-range', 2, 'submitted'); db.close();
      db = openDatabase(path);
      assert.equal(db.state('old-full-range', 2), 'unknown');
      assert.equal(db.history('scope').rows.length, 0);
      assert.equal(db.uncertain(), true);
      db.confirmNotSent('old-full-range', 2);
      assert.equal(db.uncertain(), false);
      db.close();
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
    await page.getByRole('button', { name: 'Chỉnh sửa URL', exact: true }).click();
    await page.getByLabel('Dòng bắt đầu đọc trên Sheets').fill('3');
    await page.getByRole('button', { name: 'Tải dữ liệu', exact: true }).click();
    await page.getByRole('tab', { name: 'Chưa gửi (1)', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Gửi 1 dòng lên Form', exact: true }).click();
    await page.getByText('Đã gửi 1/1 dòng. Hoàn tất.', { exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('tab', { name: 'Đã gửi (1)', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Chỉnh sửa URL', exact: true }).click();
    await page.getByLabel('Dòng bắt đầu đọc trên Sheets').fill('');
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('form-entry-settings-v1')))).startRow, undefined);
    await page.getByRole('button', { name: 'Tải dữ liệu', exact: true }).click();
    await page.getByRole('tab', { name: 'Chưa gửi (1)', exact: true }).waitFor();
    const result = await page.evaluate(config => window.desktop.history({ ...config, status: 'unsent' }), config);
    console.log('RESTORED_RANGE', JSON.stringify(result));
    assert.equal(result.value.unsentCount, 1);
    assert.equal(result.value.sentCount, 1);
    assert.deepEqual(result.value.rows.map(row => row.number), [2]);
    await page.getByRole('button', { name: 'Gửi 1 dòng lên Form', exact: true }).click();
    await page.getByText('Đã gửi 2/2 dòng. Hoàn tất.', { exact: true }).waitFor({ timeout: 60000 });
    await page.getByRole('tab', { name: 'Đã gửi (2)', exact: true }).waitFor();
    console.log('PACKAGED_START_ROW_PASSED');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
