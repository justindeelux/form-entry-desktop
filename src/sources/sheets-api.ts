import { z } from 'zod';
import { parseSheetsUrl, sourceSchema, type Source } from '../shared/contracts';
import { assertSheetRow } from './google-sheets';
import { sameSheetCell, sheetWriteSchema, validateSheetWrite, type SheetWrite } from '../shared/sheet-state';
import { parseTemporal } from '../shared/temporal';
import { setTimeout as wait } from 'node:timers/promises';

const propertiesSchema = z.object({ sheets: z.array(z.object({ properties: z.object({ sheetId: z.number().int().nonnegative().default(0), title: z.string(), sheetType: z.string().default('GRID') }) })) });
const valuesSchema = z.object({ valueRanges: z.array(z.object({ valueRange: z.object({ values: z.array(z.array(z.union([z.string(), z.number(), z.boolean()]))).optional() }) })).optional() });
export function sourceFromValues(values: (string | number | boolean)[][], startRow = 1): Source {
  const [headers, ...records] = values;
  if (!headers?.length || !headers.some(value => String(value).trim())) throw new Error('SHEETS_EMPTY');
  if (headers.length > 200 || records.length > 10000 || records.some(row => row.length > headers.length)) throw new Error('SHEETS_TOO_LARGE');
  const rows = records.map((values, index) => ({ number: index + 2, values: headers.map((_, column) => String(values[column] ?? '')) }))
    .filter(row => row.number >= startRow && row.values.some(value => value.trim()));
  const source = { columns: headers.map((value, index) => ({ id: `column-${index}`, index, label: String(value).trim() || `Cột ${index + 1}`, sample: rows[0]?.values[index] ?? '' })), rows };
  if (source.columns.some(column => column.label.length > 10000) || source.rows.some(row => row.values.some(value => value.length > 10000))) throw new Error('SHEETS_TOO_LARGE');
  return sourceSchema.parse(source);
}
function identity(url: string) {
  const parsed = new URL(parseSheetsUrl(url).url);
  return { id: parsed.pathname.split('/')[3], gid: Number(parsed.searchParams.get('gid')) };
}
function datetimeNumber(value: string) {
  const parsed = parseTemporal(value); if (!parsed) throw new Error('SHEET_WRITE_INVALID');
  const [year, month, day] = parsed.date.split('-').map(Number), [hour, minute, second] = parsed.time.split(':').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000 + 25569 + (hour * 3600 + minute * 60 + second) / 86400;
}
export function createSheetsApi(auth: { accessToken(): Promise<string>; invalidate(): void }, request: typeof fetch = fetch) {
  async function call(path: string, body?: unknown) {
    let refreshed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      let response: Response;
      try { response = await request(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${await auth.accessToken()}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000),
      }); } catch (error) {
        if (error instanceof Error && error.message.startsWith('GOOGLE_')) throw error;
        throw new Error('SHEETS_API_UNAVAILABLE');
      }
      if (response.status === 401 && !refreshed) { auth.invalidate(); refreshed = true; continue; }
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        if (attempt === 4) throw new Error('SHEETS_API_UNAVAILABLE');
        await wait(Math.min(8000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 200)); continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 401 ? 'GOOGLE_RECONNECT_REQUIRED' : response.status === 403 || response.status === 404 ? 'SHEETS_API_ACCESS_DENIED' : 'SHEETS_API_REQUEST_INVALID');
      }
      if (Number(response.headers.get('content-length')) > 10 * 1024 * 1024) { await response.body?.cancel(); throw new Error('SHEETS_TOO_LARGE'); }
      const reader = response.body?.getReader(); if (!reader) throw new Error('SHEETS_DATA_INVALID');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 10 * 1024 * 1024) throw new Error('SHEETS_TOO_LARGE'); chunks.push(value); } }
      finally { await reader.cancel(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new Error('SHEETS_DATA_INVALID'); }
    }
    throw new Error('SHEETS_API_UNAVAILABLE');
  }
  async function tabs(file: string) {
    if (!/^[\w-]+$/.test(file)) throw new Error('SHEETS_URL_INVALID');
    const result = propertiesSchema.parse(await call(`${file}?fields=sheets.properties(sheetId,title,sheetType)`));
    return result.sheets.filter(sheet => sheet.properties.sheetType === 'GRID').map(({ properties }) => ({ id: properties.sheetId, title: properties.title }));
  }
  async function read(url: string, startRow?: number) {
    const { id, gid } = identity(url);
    const result = valuesSchema.parse(await call(`${id}/values:batchGetByDataFilter`, { dataFilters: [{ gridRange: { sheetId: gid } }], majorDimension: 'ROWS', valueRenderOption: 'FORMATTED_VALUE' }));
    if (result.valueRanges?.length !== 1) throw new Error('SHEETS_TAB_CHANGED');
    return sourceFromValues(result.valueRanges[0].valueRange.values ?? [], startRow);
  }
  async function check(input: SheetWrite, startRow?: number) {
    const parsed = sheetWriteSchema.parse(input); validateSheetWrite(parsed);
    const current = await read(parsed.sheetsUrl, startRow); assertSheetRow(current, parsed); return current;
  }
  async function write(input: SheetWrite, startRow?: number) {
    const parsed = sheetWriteSchema.parse(input); validateSheetWrite(parsed);
    const current = await check(parsed, startRow), { id, gid } = identity(parsed.sheetsUrl);
    const requests = Object.entries(parsed.updates).filter(([column, value]) => {
      const index = current.columns.find(item => item.id === column)!.index;
      return !sameSheetCell(current.rows.find(row => row.number === parsed.row)!.values[index], value, column === parsed.sheetColumns.sentAt);
    }).map(([column, value]) => {
      const datetime = column === parsed.sheetColumns.sentAt, index = current.columns.find(item => item.id === column)!.index;
      const userEnteredValue = value === '' ? undefined : datetime ? { numberValue: datetimeNumber(value) } : column === parsed.sheetColumns.repeated ? { numberValue: Number(value) } : { stringValue: value };
      return { updateCells: { range: { sheetId: gid, startRowIndex: parsed.row - 1, endRowIndex: parsed.row, startColumnIndex: index, endColumnIndex: index + 1 },
        rows: [{ values: [{ userEnteredValue, ...(datetime && value !== '' ? { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd/MM/yyyy HH:mm:ss' } } } : {}) }] }],
        fields: datetime && value !== '' ? 'userEnteredValue,userEnteredFormat.numberFormat' : 'userEnteredValue' } };
    });
    if (!requests.length) return current;
    await call(`${id}:batchUpdate`, { requests });
    const written = await read(parsed.sheetsUrl, startRow), row = written.rows.find(row => row.number === parsed.row);
    if (!row || Object.entries(parsed.updates).some(([column, value]) => !sameSheetCell(row.values[written.columns.find(item => item.id === column)?.index ?? -1] ?? '', value, column === parsed.sheetColumns.sentAt))) throw new Error('SHEETS_WRITE_FAILED');
    const expectedValues = [...current.rows.find(row => row.number === parsed.row)!.values];
    for (const column of Object.keys(parsed.updates)) { const index = current.columns.find(item => item.id === column)!.index; expectedValues[index] = row.values[index]; }
    assertSheetRow(written, { ...parsed, source: { ...current, rows: [{ number: parsed.row, values: expectedValues }] } });
    return written;
  }
  return { tabs, read, check, write };
}
