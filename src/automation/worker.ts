import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { z } from 'zod';
import { FieldValidationError, fillRequestSchema, loadSchema, parseFormUrl, parseSheetsUrl, type Source } from '../shared/contracts';
import { sourceFromCsv } from '../sources/sheets';
import { assertSheetRow, loadSheets, writeSheetRow } from '../sources/google-sheets';
import { sheetWriteSchema, validateSheetWrite } from '../shared/sheet-state';
import { fillForm, inspectForm, prepareSubmit, submitForm } from './google-forms';
import { setChromeWindowState } from './chrome-window';
import { fixtureHtml, fixtureUrl } from './fixture';
import { closeLoginBrowser, openLoginBrowser } from './login-browser';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sourceSchema } from '../shared/contracts';

let context: BrowserContext | undefined;
let loginBrowser: ChildProcess | undefined;
let browserSettings: { chromePath: string; profilePath: string; loginUrl: string; requireLogin: boolean } | undefined;
let page: Page | undefined;
let sheetsPage: Page | undefined;
let targetUrl: string | undefined;
const openSchema = loadSchema.extend({ chromePath: z.string(), profilePath: z.string(), smoke: z.boolean(), minimizeChrome: z.boolean().default(false), allowEmpty: z.boolean().default(false) });
let sourceSettings: z.infer<typeof openSchema> | undefined;
let smokeSource: Source | undefined;
const smokePath = () => join(dirname(sourceSettings!.profilePath), 'smoke-sheet.json');
async function readSource() {
  if (!context || !sheetsPage || !sourceSettings) throw new Error('BROWSER_CLOSED');
  if (sourceSettings.smoke) {
    if (existsSync(smokePath())) smokeSource = sourceSchema.parse(JSON.parse(readFileSync(smokePath(), 'utf8')));
    return { ...structuredClone(smokeSource!), rows: structuredClone(smokeSource!.rows.filter(row => row.number >= (sourceSettings!.startRow ?? 2))) };
  }
  return loadSheets(context, sheetsPage, sourceSettings.sheetsUrl, false, sourceSettings.startRow, true);
}

async function execute(command: string, args: unknown) {
  if (command === 'close') { await closeLoginBrowser(loginBrowser); loginBrowser = undefined; await context?.close(); context = undefined; page = undefined; sheetsPage = undefined; return; }
  if (command === 'load' || command === 'reloadSheets') {
    if (command === 'reloadSheets' && (!context || !page || page.isClosed())) throw new Error('BROWSER_CLOSED');
    const input = openSchema.parse(args);
    sourceSettings = input;
    const sheets = parseSheetsUrl(input.sheetsUrl);
    browserSettings = { requireLogin: input.requireLogin, chromePath: input.chromePath, profilePath: input.profilePath, loginUrl: `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(sheets.url)}` };
    await closeLoginBrowser(loginBrowser); loginBrowser = undefined;
    targetUrl = parseFormUrl(input.formUrl);
    if (!context) {
      context = await chromium.launchPersistentContext(input.profilePath, {
        executablePath: input.chromePath, headless: false, acceptDownloads: false, chromiumSandbox: true,
        // Match ordinary Chrome's credential storage when reusing the login profile.
        ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'],
      });
      context.on('close', () => { context = undefined; page = undefined; sheetsPage = undefined; });
    }
    sheetsPage = sheetsPage && !sheetsPage.isClosed() ? sheetsPage : context.pages()[0] ?? await context.newPage();
    await setChromeWindowState(sheetsPage, input.minimizeChrome);
    let source;
    if (input.smoke) {
      if (targetUrl !== fixtureUrl || sheets.url !== 'https://docs.google.com/spreadsheets/d/local-fixture/edit?gid=0') throw new Error('FIXTURE_URL_INVALID');
      smokeSource ??= sourceFromCsv('Họ tên,Ghi chú,Trạng thái,Sở thích,Thành phố,Ngày,Lặp lại,Lặp lại sau (ngày),Đã nhập lại,Kết quả,Gửi lúc\nNguyễn Thị Ánh,Dữ liệu cục bộ,CO,du lich,TP.HCM,29/02/2028 14:30:42,2,1,,,\nTrần Bình,,khong,Đọc sách, HA NOI ,2026-10-10,2,1,,,');
      if (!existsSync(smokePath())) writeFileSync(smokePath(), JSON.stringify(smokeSource), { mode: 0o600 });
      source = await readSource();
      if (!source.rows.length && !input.allowEmpty) throw new Error('SHEETS_EMPTY');
    } else {
      source = await loadSheets(context, sheetsPage, input.sheetsUrl, input.requireLogin, input.startRow, input.allowEmpty);
    }
    if (command === 'reloadSheets') return source;
    page = page && !page.isClosed() ? page : await context.newPage();
    await setChromeWindowState(page, input.minimizeChrome);
    if (input.smoke) await page.route('**/*', route => route.request().url() === fixtureUrl ? route.fulfill({ contentType: 'text/html', body: fixtureHtml }) : route.abort());
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
    if (!input.minimizeChrome) await page.bringToFront();
    if (new URL(page.url()).hostname === 'accounts.google.com') throw new Error('LOGIN_REQUIRED');
    return { source, form: await inspectForm(page) };
  }
  if (command === 'checkSheetRow' || command === 'writeSheetRow') {
    const input = sheetWriteSchema.parse(args);
    validateSheetWrite(input);
    if (!context || !sheetsPage || !sourceSettings || parseSheetsUrl(input.sheetsUrl).url !== parseSheetsUrl(sourceSettings.sheetsUrl).url) throw new Error('BROWSER_CLOSED');
    const current = await readSource();
    assertSheetRow(current, input);
    if (command === 'checkSheetRow') return;
    if (sourceSettings.smoke) {
      const row = smokeSource!.rows.find(row => row.number === input.row)!;
      for (const [id, value] of Object.entries(input.updates)) row.values[current.columns.find(column => column.id === id)!.index] = value;
      writeFileSync(smokePath(), JSON.stringify(smokeSource), { mode: 0o600 });
      return readSource();
    }
    return writeSheetRow(context, sheetsPage, input, readSource);
  }
  if (command === 'readSheets') return readSource();
  if (!page || page.isClosed() || !targetUrl) {
    if (command === 'submit') return 'not_sent';
    throw new Error('BROWSER_CLOSED');
  }
  if (command === 'prepare') {
    const input = fillRequestSchema.parse(args);
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
    if (new URL(page.url()).hostname === 'accounts.google.com') throw new Error('LOGIN_REQUIRED');
    if (parseFormUrl(page.url()) !== targetUrl) throw new Error('FORM_SCHEMA_CHANGED');
    await fillForm(page, input.fingerprint, input.payload, input.fieldDelayMs);
    await prepareSubmit(page);
    return;
  }
  if (command === 'submit') {
    try {
      const input = fillRequestSchema.parse(args);
      if (new URL(page.url()).hostname === 'accounts.google.com') return 'not_sent';
      if (parseFormUrl(page.url()) !== targetUrl || (await inspectForm(page)).fingerprint !== input.fingerprint) return 'not_sent';
    } catch { return 'not_sent'; }
    return submitForm(page);
  }
  throw new Error('COMMAND_INVALID');
}

const errors = new Set(['SHEETS_TAB_CHANGED', 'SHEETS_EDITOR_UNAVAILABLE', 'SHEETS_EXPORT_FAILED', 'SHEETS_WRITE_FAILED', 'SHEET_ROW_CHANGED', 'SHEET_MAPPING_INVALID', 'SHEET_WRITE_INVALID', 'LOGIN_REQUIRED', 'LOGIN_BROWSER_OPEN', 'BROWSER_NOT_FOUND', 'FORM_NOT_READY', 'FORM_URL_INVALID', 'SHEETS_URL_INVALID', 'SHEETS_ACCESS_DENIED', 'SHEETS_TOO_LARGE', 'SHEETS_EMPTY', 'SHEETS_DATA_INVALID', 'UNSUPPORTED_QUESTION', 'FORM_SCHEMA_CHANGED', 'ROW_VALIDATION_FAILED', 'FILL_VERIFICATION_FAILED', 'RESTORED_DRAFT_REVIEW', 'SUBMIT_NOT_CLICKED', 'BROWSER_CLOSED']);
process.parentPort!.on('message', async event => {
  const { id, command, args } = event.data as { id: number; command: string; args?: unknown };
  try {
    process.parentPort!.postMessage({ id, result: { ok: true, value: await execute(command, args) } });
  } catch (error) {
    let code = error instanceof Error && errors.has(error.message) ? error.message : command === 'writeSheetRow' ? 'SHEETS_WRITE_FAILED' : 'AUTOMATION_FAILED';
    if (code === 'LOGIN_REQUIRED' && command !== 'submit' && browserSettings) {
      try {
        await context?.close(); context = undefined; page = undefined; sheetsPage = undefined;
        if (browserSettings.requireLogin) loginBrowser = await openLoginBrowser(browserSettings.chromePath, browserSettings.profilePath, browserSettings.loginUrl);
        else code = 'LOGIN_DISABLED';
      } catch { code = 'AUTOMATION_FAILED'; }
    }
    process.parentPort!.postMessage({ id, result: { ok: false, error: code, ...(error instanceof FieldValidationError ? { details: { fieldId: error.field.id, fieldTitle: error.field.title, reason: error.reason } } : {}) } });
  }
});
