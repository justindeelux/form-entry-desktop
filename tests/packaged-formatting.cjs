const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
(async () => {
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-formatting-'));
  const options = { executablePath: resolve(process.argv[2]), args: process.argv.includes('--development') ? [resolve('.'), '--smoke-test'] : ['--smoke-test'], env: { ...process.env, FORM_ENTRY_SMOKE_DATA: profile }, timeout: 60000 };
  let application = await _electron.launch(options);
  try {
    let page = await application.firstWindow();
    const sheetsUrl = 'https://docs.google.com/spreadsheets/d/local-fixture/edit?gid=0';
    const formUrl = 'https://docs.google.com/forms/d/e/local-fixture/viewform';
    await page.getByLabel('URL Google Sheets').fill(sheetsUrl);
    await page.getByLabel('URL Google Form').fill(formUrl);
    await page.getByRole('button', { name: 'Tải dữ liệu', exact: true }).click();
    await page.getByRole('tab', { name: 'Chưa gửi (2)', exact: true }).waitFor();
    const original = await page.evaluate(() => window.desktop.history({ sheetColumns: { repeat: 'column-6', repeatDays: 'column-7', repeated: 'column-8', result: 'column-9', sentAt: 'column-10' }, mapping: {}, status: 'unsent' }));
    const invalidPreview = await page.evaluate(id => window.desktop.viewForm({ id, status: 'unsent', mapping: {}, sheetColumns: { repeat: 'column-6', repeatDays: 'column-7', repeated: 'column-8', result: 'column-9', sentAt: 'column-10' } }), original.value.rows[0].id);
    assert.equal(invalidPreview.ok, false); assert.equal(invalidPreview.details.fieldId, 'q-0');
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('form-entry-settings-v1'));
      const mapping = Object.fromEntries([2, 3, 4, 5].map(i => [`q-${i}`, `column-${i}`]));
      localStorage.setItem('form-entry-settings-v1', JSON.stringify({ ...saved, sheetColumns: { repeat: 'column-6', repeatDays: 'column-7', repeated: 'column-8', result: 'column-9', sentAt: 'column-10' }, mapping, aliases: { 'q-4': [{ source: 'TP.HCM', option: 'Hồ Chí Minh' }] } }));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Tải dữ liệu', exact: true }).click();
    await page.getByRole('button', { name: 'Chỉnh sửa mapping', exact: true }).click();
    await page.getByRole('button', { name: 'Chọn cột cho Họ tên *', exact: true }).click();
    await page.getByLabel('Giá trị mặc định cho Họ tên *', { exact: true }).fill('nguyễn đức toàn');
    const nameHelp = page.getByRole('button', { name: 'Giải thích làm đẹp tên', exact: true });
    await page.waitForFunction(() => {
      const help = document.querySelector('button[aria-label="Giải thích làm đẹp tên"]');
      const popup = help?.closest('.mantine-Popover-dropdown');
      return popup && getComputedStyle(popup).opacity === '1';
    });
    await nameHelp.focus(); await nameHelp.hover();
    await page.getByRole('tooltip').filter({ hasText: 'nguyễn đức toàn → Nguyễn Đức Toàn' }).waitFor();
    await nameHelp.click();
    assert.equal(await page.getByRole('checkbox', { name: 'Làm đẹp tên cho Họ tên *', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: 'Làm đẹp tên cho Họ tên *', exact: true }).check();
    await page.getByRole('heading', { name: 'Google Form', exact: true }).click();
    await page.getByRole('button', { name: 'Chọn cột cho Ghi chú', exact: true }).click();
    await page.getByLabel('Giá trị mặc định cho Ghi chú', { exact: true }).fill('123456789');
    const phone = page.getByRole('checkbox', { name: 'Làm đẹp số điện thoại cho Ghi chú', exact: true });
    const phoneHelp = page.getByRole('button', { name: 'Giải thích làm đẹp số điện thoại', exact: true });
    await phone.focus();
    await page.keyboard.press('Tab');
    assert.equal(await phoneHelp.evaluate(element => element === document.activeElement), true);
    await page.getByRole('tooltip').filter({ hasText: '123456789 → 0123456789' }).waitFor();
    assert.equal(await phone.isChecked(), false);
    await phone.check(); await phone.uncheck();
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('form-entry-settings-v1')).formatting))['q-1'], undefined);
    await phone.check();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('form-entry-settings-v1')));
    assert.deepEqual(saved.formatting, { 'q-0': { name: true }, 'q-1': { phone: true } });
    await mkdir('.local-checks', { recursive: true });
    await phoneHelp.hover();
    await page.getByRole('tooltip').filter({ hasText: '123456789 → 0123456789' }).waitFor();
    await page.waitForFunction(() => { const tooltip = document.querySelector('[role="tooltip"]'); return tooltip && getComputedStyle(tooltip).opacity === '1'; });
    await page.screenshot({ path: '.local-checks/formatting.png', fullPage: true });
    await application.close(); application = await _electron.launch(options); page = await application.firstWindow();
    // Observe the exact payload sent to the real worker, without changing its behavior.
    await application.evaluate(({ utilityProcess }) => {
      globalThis.fixturePayloads = [];
      const fork = utilityProcess.fork.bind(utilityProcess);
      utilityProcess.fork = (...args) => {
        const child = fork(...args), post = child.postMessage.bind(child);
        child.postMessage = message => {
          if (message.command === 'prepare') globalThis.fixturePayloads.push(message.args.payload);
          return post(message);
        };
        return child;
      };
    });
    await page.getByRole('button', { name: 'Tải dữ liệu', exact: true }).click();
    await page.getByRole('button', { name: 'Chỉnh sửa mapping', exact: true }).click();
    await page.getByRole('button', { name: 'Chọn cột cho Họ tên *', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Làm đẹp tên cho Họ tên *', exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('Giá trị mặc định cho Họ tên *', { exact: true }).inputValue(), 'nguyễn đức toàn');
    await page.getByRole('heading', { name: 'Google Form', exact: true }).click();
    const raw = await page.evaluate(() => window.desktop.history({ sheetColumns: { repeat: 'column-6', repeatDays: 'column-7', repeated: 'column-8', result: 'column-9', sentAt: 'column-10' }, mapping: {}, status: 'unsent' }));
    assert.deepEqual(raw.value.rows.map(({ id, values }) => ({ id, values })), original.value.rows.map(({ id, values }) => ({ id, values })));
    await page.getByRole('button', { name: 'Xem trước form dòng 3', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByText('Nguyễn Đức Toàn', { exact: true }).waitFor();
    await dialog.getByText('0123456789', { exact: true }).waitFor();
    await dialog.getByText('Hà Nội', { exact: true }).waitFor();
    assert.equal((await application.evaluate(() => globalThis.fixturePayloads)).length, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[role="dialog"]')).opacity === '1');
    await page.screenshot({ path: '.local-checks/form-preview.png', fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Gửi 2 dòng lên Form', exact: true }).click();
    await page.getByText('Đã gửi 2/2 dòng. Hoàn tất.', { exact: true }).waitFor({ timeout: 60000 });
    const payloads = await application.evaluate(() => globalThis.fixturePayloads);
    assert.equal(payloads.length, 2);
    for (const payload of payloads) { assert.equal(payload['q-0'], 'Nguyễn Đức Toàn'); assert.equal(payload['q-1'], '0123456789'); }
    const sent = await page.evaluate(() => window.desktop.history({ sheetColumns: { repeat: 'column-6', repeatDays: 'column-7', repeated: 'column-8', result: 'column-9', sentAt: 'column-10' }, mapping: {}, status: 'sent' }));
    for (const row of sent.value.rows) { assert.deepEqual(row.values.slice(0, 8), original.value.rows.find(item => item.id === row.id).values.slice(0, 8)); assert.equal(row.values[9], 'Đã gửi'); }
    for (const row of sent.value.rows) {
      const archived = await page.evaluate(({ id, saved }) => window.desktop.viewForm({ id, status: 'sent', ...saved }), { id: row.id, saved: { mapping: saved.mapping, defaults: saved.defaults, aliases: saved.aliases, formatting: saved.formatting, sheetColumns: saved.sheetColumns } });
      assert.equal(archived.ok, true);
      assert.deepEqual(archived.value.payload, payloads[row.number === 3 ? 0 : 1]);
    }
    const repeated = await page.evaluate(saved => window.desktop.send(saved.mapping, saved.defaults, saved.aliases, {}, saved.sheetColumns), saved);
    assert.equal(repeated.ok, true); assert.equal(repeated.value.submitted, 0);
    assert.equal((await application.evaluate(() => globalThis.fixturePayloads)).length, 2);
    await page.getByRole('button', { name: 'Reset mapping', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận reset', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('form-entry-settings-v1')).formatting), {});
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('form-entry-settings-v1')).sheetColumns), {});
    const afterReset = await page.evaluate(saved => window.desktop.history({ mapping: {}, sheetColumns: saved.sheetColumns, status: 'sent' }), saved);
    assert.equal(afterReset.value.sentCount, 2);
    console.log('PACKAGED_FORMATTING_PASSED', JSON.stringify({ immediateSave: true, restart: true, outgoingValues: true, originalSheetData: true, onlyControlColumnsChanged: true, sheetIdentity: true, resetClearsFormatting: true, formattingTooltips: true, helpDoesNotToggle: true, formPreviewWithoutSubmit: true, previewMatchesCurrentMapping: true, resetRetainsSheetData: true, fixtureOnly: true }));
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
