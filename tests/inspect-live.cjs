const { chromium } = require('playwright-core');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { findChrome } = require('../dist/main/browser');
const { parseFormUrl } = require('../dist/shared/contracts');
const { inspectForm, selectDropdown, prepareSubmit, setChoiceChecked } = require('../dist/automation/google-forms');
const { validatePayload } = require('../dist/shared/contracts');
const assert = require('node:assert/strict');

(async () => {
  const url = parseFormUrl(process.argv[2]);
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-inspect-'));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(profile, { executablePath: findChrome(), headless: false, chromiumSandbox: true });
    const page = browser.pages()[0];
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('[role="listitem"] [role="heading"]').first().waitFor({ timeout: 15000 });
    const inspection = await inspectForm(page);
    if (process.argv[3] === '--repeat-select') {
      const dropdown = inspection.fields.find(field => field.type === 'dropdown');
      const radio = inspection.fields.find(field => field.type === 'radio');
      for (let cycle = 0; cycle < 8; cycle++) {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        const current = await inspectForm(page);
        assert.equal(current.fingerprint, inspection.fingerprint);
        console.log('REPEAT_STEP', cycle, 'radio');
        await setChoiceChecked(page.locator('[role="listitem"]').nth(radio.index).getByRole('radio', { name: radio.options[cycle % radio.options.length], exact: true }), true);
        console.log('REPEAT_STEP', cycle, 'select');
        await selectDropdown(page, dropdown, dropdown.options[cycle % 2]);
        console.log('REPEAT_STEP', cycle, 'preflight');
        await prepareSubmit(page);
      }
      console.log('LIVE_REPEAT_SELECT_PASSED', JSON.stringify({ cycles: 8, submitted: false }));
    }
    if (process.argv[3] === '--inspect-submit') {
      const previousMatches = await page.getByRole('button', { name: /^(Submit|Gửi)$/ }).count();
      await prepareSubmit(page);
      console.log('LIVE_SUBMIT_PREFLIGHT_PASSED', JSON.stringify({ previousMatches, clicked: false, submitted: false }));
      console.log('SUBMIT_CONTROLS', JSON.stringify(await page.getByRole('button').evaluateAll(elements => elements.map(element => ({ text: element.textContent.trim(), label: element.getAttribute('aria-label'), disabled: element.getAttribute('aria-disabled'), visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 })))));
    }
    if (process.argv[3] === '--preview-select') {
      const field = inspection.fields.find(field => field.type === 'dropdown');
      assert.ok(field);
      const container = page.locator('[role="listitem"]').nth(field.index);
      await selectDropdown(page, field, field.options[0]);
      console.log('LIVE_SELECT_PREVIEW_PASSED', JSON.stringify({ field: field.id, submitted: false }));
    }
    if (process.argv[3] === '--preview-date') {
      const value = process.argv[4];
      const dates = inspection.fields.filter(field => field.type === 'date');
      assert.ok(dates.length, 'No supported date field found');
      for (const field of dates) {
        validatePayload([field], { [field.id]: value });
        const input = page.locator('[role="listitem"]').nth(field.index).locator('input[type="date"]');
        await input.fill(value);
        assert.equal(await input.inputValue(), value);
        assert.equal(await input.evaluate(element => element.checkValidity()), true);
        await input.fill('');
      }
      console.log('LIVE_DATE_PREVIEW_PASSED', JSON.stringify({ fields: dates.length, submitted: false }));
    }
    for (const field of inspection.fields.filter(field => field.type === 'unsupported')) {
      const controls = await page.locator('[role="listitem"]').nth(field.index).locator('input, textarea, select').evaluateAll(elements => elements.map(element => ({ tag: element.tagName, type: element.getAttribute('type') })));
      console.log('UNSUPPORTED_CONTROLS', JSON.stringify({ id: field.id, controls }));
    }
    console.log(JSON.stringify(inspection, null, 2));
  } finally { await browser?.close(); await rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
