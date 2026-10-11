import type { BrowserContext, Page } from 'playwright-core';
import { parseSheetsUrl } from '../shared/contracts';
import { sourceFromCsv } from './sheets';

async function readSheets(context: BrowserContext, exportUrl: string): Promise<string> {
  let url = exportUrl;
  for (let index = 0; index < 6; index++) {
    const parsed = new URL(url);
    if (parsed.hostname === 'accounts.google.com') throw new Error('LOGIN_REQUIRED');
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
        !(parsed.hostname === 'docs.google.com' || parsed.hostname.endsWith('.googleusercontent.com'))) throw new Error('SHEETS_ACCESS_DENIED');
    const response = await context.request.get(url, { maxRedirects: 0, timeout: 15000 });
    try {
      if (response.status() >= 300 && response.status() < 400) {
        const location = response.headers().location;
        if (!location) throw new Error('SHEETS_ACCESS_DENIED');
        url = new URL(location, url).href; continue;
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
