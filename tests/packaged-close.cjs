const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const { mkdtemp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

(async () => {
  for (const mode of ['opening', 'idle', 'waiting', 'preparing', 'submitting']) {
    const profile = await mkdtemp(join(tmpdir(), 'form-entry-close-'));
    const report = join(profile, 'close-check.json');
    const application = await _electron.launch({ executablePath: resolve(process.argv[2]), args: process.argv.includes('--development') ? [resolve('.'), '--smoke-test'] : ['--smoke-test'], env: { ...process.env, FORM_ENTRY_SMOKE_DATA: profile }, timeout: 60000 });
    let stderr = '';
    application.process().stderr.on('data', chunk => { stderr += chunk; });
    let exited = false;
    try {
      await application.evaluate(({ app, utilityProcess }, { report, mode }) => {
        const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
        const { writeFileSync } = require('node:fs');
        globalThis.closeCommands = [];
        process.on('uncaughtException', error => { writeFileSync(report, JSON.stringify({ error: error.stack })); app.exit(90); });
        app.on('will-quit', () => {
          const { existsSync, readFileSync } = require('node:fs');
          const path = app.getPath('userData') + '/smoke-sheet.json';
          const sent = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).rows.filter(row => row.values[9] === 'Đã gửi').length : 0;
          writeFileSync(report, JSON.stringify({ commands: globalThis.closeCommands, sent }));
        });
        const fork = utilityProcess.fork.bind(utilityProcess);
        utilityProcess.fork = (...args) => {
          const child = fork(...args), post = child.postMessage.bind(child), on = child.on.bind(child), submits = new Set();
          child.on = (event, listener) => on(event, event === 'message' ? message => {
            if (submits.delete(message.id)) setTimeout(() => listener(message), 500);
            else listener(message);
          } : listener);
          child.postMessage = message => {
            globalThis.closeCommands.push(message.command);
            if (mode === 'submitting' && message.command === 'submit') submits.add(message.id);
            post(message);
          };
          return child;
        };
      }, { report, mode });
      const page = await application.firstWindow();
      if (mode !== 'opening') await page.getByLabel('URL Google Sheets').waitFor();
      if (mode !== 'idle' && mode !== 'opening') {
        const source = { sheetsUrl: 'https://docs.google.com/spreadsheets/d/local-fixture/edit?gid=0', formUrl: 'https://docs.google.com/forms/d/e/local-fixture/viewform' };
        assert.equal((await page.evaluate(source => window.desktop.load(source), source)).ok, true);
        const send = { sheetColumns: { repeat: 'column-6', repeatDays: 'column-7', repeated: 'column-8', result: 'column-9', sentAt: 'column-10' }, mapping: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`q-${i}`, `column-${i}`])), aliases: { 'q-4': [{ source: 'TP.HCM', option: 'Hồ Chí Minh' }] } };
        if (mode === 'waiting') {
          assert.equal((await page.evaluate(({ source, send }) => window.desktop.startSchedule({ source, send, rule: { mode: 'interval', minutes: 1 } }), { source, send })).ok, true);
        } else {
          if (mode === 'preparing') await page.evaluate(() => window.desktop.savePreferences({ fieldDelayMs: 300 }));
          // Do not await sending: close while the worker is preparing or returning a Submit outcome.
          await page.evaluate(send => { void window.desktop.send(send.mapping, {}, send.aliases, {}, send.sheetColumns); }, send);
          await application.evaluate((_, command) => new Promise(resolve => {
            const timer = setInterval(() => {
              if (globalThis.closeCommands.includes(command)) { clearInterval(timer); resolve(); }
            }, 10);
          }), mode === 'preparing' ? 'prepare' : 'submit');
        }
      }
      const exit = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Window close did not quit')), 30000);
        application.process().once('exit', (code, signal) => { clearTimeout(timer); exited = true; resolve({ code, signal }); });
      });
      await application.evaluate(({ BrowserWindow }, mode) => {
        setImmediate(() => {
          const window = BrowserWindow.getAllWindows()[0];
          if (mode === 'idle') window.destroy(); else window.close();
        });
      }, mode);
      assert.deepEqual(await exit, { code: 0, signal: null }, `${mode}: ${stderr}`);
      const result = JSON.parse(await readFile(report, 'utf8'));
      assert.equal(result.error, undefined);
      assert.equal(result.sent, mode === 'submitting' ? 1 : 0);
      assert.equal(result.commands.filter(command => command === 'submit').length, mode === 'submitting' ? 1 : 0);
      console.log('WINDOW_CLOSE_PASSED', mode);
    } finally { if (!exited) await application.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
