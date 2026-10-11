const { chromium } = require('playwright-core');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { findChrome } = require('../dist/main/browser');
const { loadSheets } = require('../dist/sources/google-sheets');
(async () => {
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-sheets-'));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(profile, { executablePath: findChrome(), headless: false, chromiumSandbox: true });
    try {
      const source = await loadSheets(browser, browser.pages()[0], process.argv[2], process.argv.includes('--require-login'));
      console.log('SHEETS_LOADED', JSON.stringify({ columns: source.columns.length, rows: source.rows.length, submitted: false }));
    } catch (error) {
      if (error.message !== 'LOGIN_REQUIRED') throw error;
      console.log('LOGIN_REQUIRED_VERIFIED', JSON.stringify({ submitted: false, authenticatedRead: 'pending' }));
    }
  } finally { await browser?.close(); await rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
