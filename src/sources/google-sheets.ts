import type { BrowserContext, JSHandle, Page } from 'playwright-core';
import { parseSheetsUrl } from '../shared/contracts';
import { sourceFromCsv } from './sheets';
import { sameSheetCell, sheetWriteSchema, timestampFormula, validateSheetWrite, type SheetWrite } from '../shared/sheet-state';
import type { Source } from '../shared/contracts';
import { setTimeout as wait } from 'node:timers/promises';

async function readSheets(context: BrowserContext, exportUrl: string): Promise<string> {
  let url = exportUrl;
  let retries = 0;
  for (let index = 0; index < 6; index++) {
    const parsed = new URL(url);
    if (parsed.hostname === 'accounts.google.com') throw new Error('LOGIN_REQUIRED');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !(parsed.hostname === 'docs.google.com' || parsed.hostname.endsWith('.googleusercontent.com'))) throw new Error('SHEETS_ACCESS_DENIED');
    const response = await context.request.get(url, { maxRedirects: 0, timeout: 15000, headers: { 'Cache-Control': 'no-cache' } });
    try {
      if (response.status() >= 300 && response.status() < 400) {
        const location = response.headers().location;
        if (!location) throw new Error('SHEETS_ACCESS_DENIED');
        url = new URL(location, url).href; continue;
      }
      if (response.status() === 429 || response.status() >= 500) {
        if (retries >= 2) throw new Error('SHEETS_EXPORT_FAILED');
        await wait(500 * ++retries); continue;
      }
      if (!response.ok()) throw new Error('SHEETS_ACCESS_DENIED');
      if (response.headers()['content-type']?.toLowerCase().includes('text/html')) throw new Error('SHEETS_ACCESS_DENIED');
      if (Number(response.headers()['content-length']) > 10 * 1024 * 1024) throw new Error('SHEETS_TOO_LARGE');
      const body = await response.body();
      if (body.length > 10 * 1024 * 1024) throw new Error('SHEETS_TOO_LARGE');
      return body.toString('utf8');
    } finally { await response.dispose(); }
  }
  throw new Error('SHEETS_ACCESS_DENIED');
}

export function assertSheetRow(current: Source, expected: SheetWrite) {
  const signature = (source: Source) => JSON.stringify(source.columns.map(({ id, label, index }) => [id, label, index]));
  const before = expected.source.rows.find(row => row.number === expected.row);
  const after = current.rows.find(row => row.number === expected.row);
  if (!before || !after || signature(current) !== signature(expected.source) || JSON.stringify(before.values) !== JSON.stringify(after.values)) throw new Error('SHEET_ROW_CHANGED');
}

export function columnAddress(index: number) {
  let result = '';
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) result = String.fromCharCode(65 + (number - 1) % 26) + result;
  return result;
}

export async function writeSheetRow(context: BrowserContext, page: Page, args: SheetWrite, read: () => Promise<Source>) {
  const input = sheetWriteSchema.parse(args);
  validateSheetWrite(input);
  let current = await read();
  assertSheetRow(current, input);
  const url = parseSheetsUrl(input.sheetsUrl).url;
  const gid = new URL(url).searchParams.get('gid')!;
  await page.goto(`${url}#gid=${gid}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (new URL(page.url()).hostname === 'accounts.google.com') throw new Error('LOGIN_REQUIRED');
  await page.waitForURL(actual => {
    try {
      const activeGid = new URLSearchParams(actual.hash.slice(1)).get('gid');
      if (activeGid !== null) actual.searchParams.set('gid', activeGid);
      return parseSheetsUrl(actual.href).url === url;
    } catch { return false; }
  }, { timeout: 15000 }).catch(() => { throw new Error('SHEETS_TAB_CHANGED'); });
  await page.bringToFront();
  // shortcut: editor selectors depend on Sheets UI; replace this writer if Google changes them.
  const nameBox = page.locator('input.waffle-name-box, .waffle-name-box input').first();
  await nameBox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { throw new Error('SHEETS_EDITOR_UNAVAILABLE'); });
  let previousClipboard: JSHandle<ClipboardItem[]> | undefined;
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://docs.google.com' });
    previousClipboard = await page.evaluateHandle(() => navigator.clipboard.read());
    for (const [id, value] of Object.entries(input.updates)) {
      const column = input.source.columns.find(column => column.id === id)!;
      const datetime = id === input.sheetColumns.sentAt;
      const row = current.rows.find(row => row.number === input.row)!;
      if (sameSheetCell(row.values[column.index] ?? '', value, datetime)) continue;
      // Refuse to overwrite a row edited or moved after form preparation.
      const fresh = await read();
      assertSheetRow(fresh, { ...input, source: { ...current, rows: [row] } });
      await nameBox.fill(`${columnAddress(column.index)}${input.row}`);
      await nameBox.press('Enter');
      if (value === '') await page.keyboard.press('Backspace');
      else {
        await page.evaluate(text => navigator.clipboard.writeText(text), datetime ? timestampFormula(value) : value);
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      }
      const deadline = Date.now() + 15000;
      let verified = false;
      do {
        current = await read();
        const updated = current.rows.find(row => row.number === input.row);
        if (updated && sameSheetCell(updated.values[column.index] ?? '', value, datetime)) {
          const expectedValues = [...row.values]; expectedValues[column.index] = updated.values[column.index];
          assertSheetRow(current, { ...input, source: { ...input.source, rows: [{ number: input.row, values: expectedValues }] } });
          verified = true; break;
        }
        await page.waitForTimeout(1000);
      } while (Date.now() < deadline);
      if (!verified) throw new Error('SHEETS_WRITE_FAILED');
    }
    return current;
  } finally {
    if (previousClipboard) {
      await page.evaluate(items => navigator.clipboard.write(items), previousClipboard).catch(() => {});
      await previousClipboard.dispose().catch(() => {});
    }
    await context.clearPermissions().catch(() => {});
  }
}

export async function loadSheets(context: BrowserContext, page: Page, inputUrl: string, requireLogin = false, startRow?: number, allowEmpty = false) {
  const sheets = parseSheetsUrl(inputUrl);
  if (requireLogin) {
    const cookies = await context.cookies('https://accounts.google.com');
    if (!cookies.some(cookie => ['SID', '__Secure-1PSID', '__Secure-3PSID'].includes(cookie.name))) throw new Error('LOGIN_REQUIRED');
    await page.goto(sheets.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (new URL(page.url()).hostname === 'accounts.google.com') throw new Error('LOGIN_REQUIRED');
  }
  return sourceFromCsv(await readSheets(context, sheets.exportUrl), startRow, allowEmpty);
}
