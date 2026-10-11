const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const { findChrome } = require('../dist/main/browser');
const { setChromeWindowState } = require('../dist/automation/chrome-window');
(async () => {
  const browser = await chromium.launch({ executablePath: findChrome(), headless: false, chromiumSandbox: true });
  try {
    const page = await browser.newPage();
    const session = await page.context().newCDPSession(page);
    const state = async () => (await session.send('Browser.getWindowForTarget')).bounds.windowState;
    await setChromeWindowState(page, true);
    assert.equal(await state(), 'minimized');
    await page.setContent('<input aria-label="local fixture">');
    await page.getByLabel('local fixture').fill('works while minimized');
    assert.equal(await state(), 'minimized');
    await setChromeWindowState(page, false);
    assert.equal(await state(), 'normal');
    await session.detach();
    console.log('CHROME_WINDOW_PASSED');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
