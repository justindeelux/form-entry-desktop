const assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const { resolve } = require('node:path');
(async () => {
  const application = await _electron.launch({ executablePath: resolve(process.argv[2]), args: process.argv.includes('--development') ? [resolve('.'), '--smoke-test'] : ['--smoke-test'], timeout: 60000 });
  try {
    await (await application.firstWindow()).getByRole('button', { name: 'Tải dữ liệu', exact: true }).waitFor();
    const result = await application.evaluate(async ({ app }) => {
      const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const { join } = require('node:path');
      const { createAutomation } = require(join(app.getAppPath(), 'dist/main/automation.js'));
      const { findChrome } = require(join(app.getAppPath(), 'dist/main/browser.js'));
      const utility = createAutomation();
      let error;
      try {
        await utility.request('load', { sheetsUrl: 'https://docs.google.com/spreadsheets/d/local-login-check/edit?gid=0', formUrl: 'https://docs.google.com/forms/d/e/local-login-check/viewform', requireLogin: true, chromePath: findChrome(), profilePath: join(app.getPath('userData'), 'manual-login-check'), smoke: false, externalSource: { columns: [{ id: 'column-0', index: 0, label: 'Tên', sample: '' }], rows: [] } });
      } catch (caught) { error = caught.message; }
      finally { try { await utility.request('close'); } finally { utility.stop(); } }
      return { error, packaged: app.isPackaged };
    });
    assert.equal(result.error, 'LOGIN_REQUIRED');
    assert.equal(result.packaged, !process.argv.includes('--development'));
    console.log('PACKAGED_MANUAL_LOGIN_PASSED', JSON.stringify({ ...result, submitted: false, googleCredentialsUsed: false }));
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
