const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const { findChrome } = require('../dist/main/browser');
const { fixtureUrl, fixtureHtml } = require('../dist/automation/fixture');
const { normalizeDateTime } = require('../dist/shared/temporal');
const { inspectForm, fillForm, selectDropdown, prepareSubmit, setChoiceChecked, submitForm } = require('../dist/automation/google-forms');

(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage();
    await page.route(fixtureUrl, route => route.fulfill({ contentType: 'text/html', body: fixtureHtml }));
    await page.goto(fixtureUrl);
    const schema = await inspectForm(page);
    assert.deepEqual(schema.fields.map(field => field.type), ['text', 'paragraph', 'radio', 'checkbox', 'dropdown', 'date']);
    const payload = { 'q-0': 'Nguyễn Thị Ánh', 'q-1': 'Dữ liệu kiểm tra cục bộ', 'q-2': 'Có', 'q-3': ['Du lịch'], 'q-4': 'Hồ Chí Minh', 'q-5': '2028-02-29' };
    await page.evaluate(() => {
      window.fillTimes = [];
      document.addEventListener('input', event => {
        if (event.target.closest('[role="listitem"]')?.querySelector('[role="heading"]')) window.fillTimes.push(performance.now());
      });
    });
    await fillForm(page, schema.fingerprint, payload, 120);
    const times = await page.evaluate(() => window.fillTimes);
    assert.ok(times[1] - times[0] >= 110, 'Configured delay between text fields');
    console.log('FIELD_DELAY_PASSED');
    for (let row = 0; row < 28; row++) {
      await page.goto(fixtureUrl, { waitUntil: 'load' });
      await fillForm(page, schema.fingerprint, { ...payload, 'q-2': row % 2 ? 'Không' : 'Có', 'q-4': row % 2 ? 'Hà Nội' : 'Hồ Chí Minh' });
      await prepareSubmit(page);
      assert.equal(await submitForm(page), 'submitted', `Sequential local row ${row + 2}`);
    }
    console.log('SEQUENTIAL_28_ROWS_PASSED');
    await page.goto(fixtureUrl, { waitUntil: 'load' });
    await assert.rejects(() => fillForm(page, schema.fingerprint, { ...payload, 'q-5': '2026-02-29' }), /ROW_VALIDATION_FAILED/);
    await assert.rejects(() => fillForm(page, schema.fingerprint, { ...payload, 'q-5': '2031-01-01' }), /ROW_VALIDATION_FAILED/);
    await page.locator('[role="heading"]').nth(4).evaluate(element => { element.textContent = 'Thành phố'; });
    const optional = await inspectForm(page);
    await fillForm(page, optional.fingerprint, { ...payload, 'q-4': '' });
    await fillForm(page, optional.fingerprint, payload);
    await assert.rejects(() => fillForm(page, optional.fingerprint, { ...payload, 'q-4': '' }), error => error.field?.id === 'q-4' && error.reason.includes('khôi phục'));
    await page.locator('[role="heading"]').nth(4).evaluate(element => { element.textContent = 'Thành phố *'; });
    await fillForm(page, schema.fingerprint, payload);
    assert.equal(await page.locator('input[type="date"]').inputValue(), '2028-02-29');
    await page.locator('[role="heading"]').last().evaluate(element => { element.textContent = 'Ngày phỏng vấn'; });
    await page.locator('input[type="date"]').evaluate(element => { element.required = false; });
    const optionalDate = await inspectForm(page);
    await fillForm(page, optionalDate.fingerprint, { ...payload, 'q-5': '' });
    assert.equal(await page.locator('input[type="date"]').inputValue(), '');
    await page.locator('[role="listitem"]').nth(2).evaluate(element => {
      element.innerHTML = `<div role="heading">Trạng thái *</div><div role="radiogroup">
        <div role="radio" tabindex="0" aria-label="Có" data-value="Có" aria-checked="false" onclick="setTimeout(()=>{this.parentElement.querySelectorAll('[role=radio]').forEach(item=>item.setAttribute('aria-checked',String(item===this)))},150)">Có</div>
        <div role="radio" tabindex="0" aria-label="Không" data-value="Không" aria-checked="false" onclick="setTimeout(()=>{this.parentElement.querySelectorAll('[role=radio]').forEach(item=>item.setAttribute('aria-checked',String(item===this)))},150)">Không</div></div>`;
    });
    const delayedRadio = await inspectForm(page);
    for (const value of ['Có', 'Không', 'Có', 'Có']) {
      await fillForm(page, delayedRadio.fingerprint, { ...payload, 'q-2': value, 'q-5': '' });
      assert.equal(await page.getByRole('radio', { name: value, exact: true }).isChecked(), true);
    }
    await page.locator('[role="listitem"]').nth(3).evaluate(element => {
      element.innerHTML = '<div role="heading">Sở thích</div><div role="checkbox" tabindex="0" aria-label="Du lịch" data-value="Du lịch" aria-checked="false" onclick="setTimeout(()=>this.setAttribute(\'aria-checked\',String(this.getAttribute(\'aria-checked\')!==\'true\')),150)">Du lịch</div>';
    });
    const delayedCheckbox = await inspectForm(page);
    for (const options of [['Du lịch'], [], ['Du lịch']]) {
      await fillForm(page, delayedCheckbox.fingerprint, { ...payload, 'q-3': options, 'q-5': '' });
      assert.equal(await page.getByRole('checkbox', { name: 'Du lịch', exact: true }).isChecked(), options.length > 0);
    }
    await page.getByRole('radio', { name: 'Không', exact: true }).evaluate(element => { element.removeAttribute('onclick'); });
    await assert.rejects(() => fillForm(page, delayedCheckbox.fingerprint, { ...payload, 'q-2': 'Không', 'q-3': ['Du lịch'], 'q-5': '' }), error => error.field?.id === 'q-2' && error.reason.includes('trạng thái lựa chọn'));
    await page.getByRole('radio', { name: 'Không', exact: true }).evaluate(element => { element.setAttribute('onclick', "setTimeout(()=>{this.parentElement.querySelectorAll('[role=radio]').forEach(item=>item.setAttribute('aria-checked',String(item===this)))},150)"); });
    const temporalLayouts = [
      ['combined', '<input type="datetime-local" required step="1" min="2024-01-01T00:00:00" max="2030-12-31T23:59:59">', 'second'],
      ['time', '<input type="date" required min="2024-01-01" max="2030-12-31"><input type="time" required>', 'minute'],
      ['parts', '<input type="date" required><input type="number" name="entry.123_hour" min="0" max="23" required><input type="number" name="entry.123_minute" min="0" max="59" required>', 'minute'],
      ['parts', '<input type="date" required><input type="number" aria-label="Giờ" min="0" max="23" required><input type="number" aria-label="Phút" min="0" max="59" required><input type="number" aria-label="Giây" min="0" max="59" required>', 'second'],
    ];
    for (const [layout, controls, precision] of temporalLayouts) {
      await page.locator('[role="listitem"]').nth(5).evaluate((element, controls) => { element.innerHTML = '<div role="heading">Ngày giờ *</div>' + controls; }, controls);
      const datetime = await inspectForm(page);
      assert.equal(datetime.fields[5].type, 'datetime');
      assert.equal(datetime.fields[5].timeLayout, layout);
      assert.equal(datetime.fields[5].timePrecision, precision);
      for (const source of ['29/02/2028', precision === 'second' ? '29/02/2028 14:30:42' : '29/02/2028 14:30']) {
        const value = normalizeDateTime(source);
        await fillForm(page, datetime.fingerprint, { ...payload, 'q-5': value });
        const values = await page.locator('[role="listitem"]').nth(5).locator('input').evaluateAll(inputs => inputs.map(input => input.value));
        if (layout === 'combined') assert.equal(normalizeDateTime(values[0]), value);
        else {
          assert.equal(values[0], '2028-02-29');
          const clock = layout === 'time' ? values[1] : values.slice(1).map(part => part.padStart(2, '0')).join(':');
          assert.equal(normalizeDateTime(`2028-02-29T${clock}`), value);
        }
      }
      await assert.rejects(() => fillForm(page, datetime.fingerprint, { ...payload, 'q-5': '2028-02-29T24:00:00' }), /ROW_VALIDATION_FAILED/);
      if (precision === 'minute') await assert.rejects(() => fillForm(page, datetime.fingerprint, { ...payload, 'q-5': '2028-02-29T14:30:42' }), /ROW_VALIDATION_FAILED/);
      await page.locator('[role="listitem"]').nth(5).evaluate(element => { element.querySelector('[role="heading"]').textContent = 'Ngày giờ'; element.querySelectorAll('input').forEach(input => { input.required = false; }); });
      const optionalDatetime = await inspectForm(page);
      await fillForm(page, optionalDatetime.fingerprint, { ...payload, 'q-5': '' });
      assert.deepEqual(await page.locator('[role="listitem"]').nth(5).locator('input').evaluateAll(inputs => inputs.map(input => input.value)), layout === 'combined' ? [''] : layout === 'time' ? ['', ''] : precision === 'second' ? ['', '', '', ''] : ['', '', '']);
    }
    const dropdown = schema.fields[4];
    await page.locator('[role="listitem"]').nth(4).evaluate(element => {
      element.innerHTML = `<div role="heading">Thành phố *</div>
        <div role="listbox" aria-expanded="false" tabindex="0" onclick="this.setAttribute('aria-expanded','true');setTimeout(()=>{this.querySelector('[data-menu]').style.transform='scale(1)'},150)">
          <div role="option" data-value="Hà Nội" aria-selected="true">Hà Nội</div>
          <div data-menu style="transform:scale(0)">
            <div role="option" data-value="Hồ Chí Minh" onclick="event.stopPropagation();const box=this.closest('[role=listbox]');setTimeout(()=>{box.querySelector('[aria-selected]').setAttribute('data-value','Hồ Chí Minh');box.querySelector('[aria-selected]').textContent='Hồ Chí Minh';box.setAttribute('aria-expanded','false');this.parentElement.style.transform='scale(0)'},150)">Hồ Chí Minh</div>
          </div>
        </div>`;
    });
    await selectDropdown(page, dropdown, 'Hồ Chí Minh');
    assert.equal(await page.locator('[role="listitem"]').nth(4).locator('[aria-selected=true]').getAttribute('data-value'), 'Hồ Chí Minh');
    await page.locator('[role="listitem"]').nth(4).evaluate(element => {
      element.innerHTML = '<div role="heading">Thành phố *</div><div role="listbox" tabindex="0"><div role="option" data-value="Hà Nội">Hà Nội</div><div role="option" data-value="Hà Nội">Hà Nội</div></div>';
    });
    await assert.rejects(() => selectDropdown(page, dropdown, 'Hà Nội'), error => error.field?.id === 'q-4' && error.reason.includes('chờ option hiển thị'));
    await assert.rejects(() => selectDropdown(page, dropdown, 'Missing'), error => error.field?.id === 'q-4' && error.reason.includes('chờ option hiển thị'));
    assert.equal(await submitForm(page), 'submitted');
    await page.setContent(`<button aria-label="  Gửi  " onclick="window.clickCount++;document.body.innerHTML='<p>Câu trả lời của bạn đã được ghi lại.</p>'">Gửi</button><script>window.clickCount=0</script>`.normalize('NFD'));
    await prepareSubmit(page);
    assert.equal(await page.evaluate(() => window.clickCount), 0, 'Trial must not submit');
    assert.equal(await submitForm(page), 'submitted');
    assert.equal(await page.evaluate(() => window.clickCount), 1);
    await page.setContent('<button>Send something else</button>');
    await assert.rejects(() => prepareSubmit(page), /SUBMIT_NOT_CLICKED/);
    assert.equal(await submitForm(page), 'not_sent');
    await page.setContent('<button>Gửi</button><button>Gửi</button>');
    assert.equal(await submitForm(page), 'not_sent');
    await page.setContent('<button aria-disabled="true">Gửi</button>');
    assert.equal(await submitForm(page), 'not_sent');
    await page.setContent(`<button onclick="window.clickCount++;document.body.innerHTML='<div role=alert>Bắt buộc nhập trường này</div>'">Submit</button><script>window.clickCount=0</script>`);
    assert.equal(await submitForm(page), 'failed');
    assert.equal(await page.evaluate(() => window.clickCount), 1);
    await page.setContent(`<button onclick="window.clickCount++;document.body.innerHTML='<p>Custom unrecognized confirmation</p>'">Submit</button><script>window.clickCount=0</script>`);
    assert.equal(await submitForm(page), 'unknown');
    assert.equal(await page.evaluate(() => window.clickCount), 1, 'Unknown must never trigger retry');
    console.log('ADAPTER_SMOKE_PASSED');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
