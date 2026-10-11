const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('../dist/main/browser');
const { openLoginBrowser, closeLoginBrowser } = require('../dist/automation/login-browser');

(async () => {
  const profile = await mkdtemp(join(tmpdir(), 'form-entry-manual-login-'));
  let manual, automated;
  let seen;
  const received = new Promise(resolve => { seen = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'login-fixture=preserved; HttpOnly; Max-Age=3600; Path=/' });
    response.end('<h1>Local sign-in session fixture</h1>'); seen();
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    manual = await openLoginBrowser(findChrome(), profile, url);
    let timeout;
    await Promise.race([received, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('MANUAL_BROWSER_TIMEOUT')), 15000); })]).finally(() => clearTimeout(timeout));
    await closeLoginBrowser(manual);
    automated = await chromium.launchPersistentContext(profile, { executablePath: findChrome(), headless: false, chromiumSandbox: true, ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'] });
    const cookies = await automated.cookies(url);
    assert.equal(cookies.find(cookie => cookie.name === 'login-fixture')?.value, 'preserved');
    await automated.pages()[0].goto(url);
    assert.equal(await automated.pages()[0].getByRole('heading').innerText(), 'Local sign-in session fixture');
    console.log('MANUAL_LOGIN_TRANSITION_PASSED', JSON.stringify({ localFixture: true, profilePreserved: true, profileReopened: true, googleSignInVerified: false }));
  } finally {
    await automated?.close(); await closeLoginBrowser(manual);
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
