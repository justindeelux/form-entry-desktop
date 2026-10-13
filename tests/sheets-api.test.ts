import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSheetsApi, sourceFromValues } from '../src/sources/sheets-api';
import { submissionUpdates } from '../src/shared/sheet-state';
const url = 'https://docs.google.com/spreadsheets/d/fixture/edit?gid=5';
const source = sourceFromValues([['Name', 'Count', 'State', 'Time', 'Repeat', 'Days'], ['Ánh', '', 'Chưa gửi', '', '2', '1']]);
const columns = { result: 'column-2', sentAt: 'column-3', repeated: 'column-1', repeat: 'column-4', repeatDays: 'column-5' };
const updates = submissionUpdates(source, source.rows[0].values, columns, false, new Date(2026, 9, 13, 14, 30, 42));
const input = { sheetsUrl: url, source, row: 2, sheetColumns: columns, updates };
const auth = () => ({ accessToken: vi.fn(async () => 'token'), invalidate: vi.fn() });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => vi.useRealTimers());
describe('Google Sheets API', () => {
  it('keeps headers with no rows, physical row numbers, formatted phone values and empty header identifiers', () => {
    expect(sourceFromValues([['Name', 'State']])).toMatchObject({ rows: [], columns: [{ label: 'Name', sample: '' }, { label: 'State', sample: '' }] });
    expect(sourceFromValues([['Name', 'Phone', ''], ['Ánh', '00123'], ['', '', ''], ['Bình', '00456']], 3)).toMatchObject({ rows: [{ number: 4, values: ['Bình', '00456', ''] }], columns: [{ id: 'column-0' }, { id: 'column-1' }, { id: 'column-2', label: 'Cột 3' }] });
    expect(() => sourceFromValues([])).toThrow('SHEETS_EMPTY');
    expect(() => sourceFromValues([['A'], ['x', 'y']])).toThrow('SHEETS_TOO_LARGE');
  });
  it('targets the numeric tab ID and atomically writes only mapped controls with numeric datetime and counter', async () => {
    let values = [source.columns.map(column => column.label), [...source.rows[0].values]];
    const request = vi.fn<typeof fetch>(async (url, options) => {
      const body = JSON.parse(options!.body as string);
      if (String(url).endsWith('/values:batchGetByDataFilter')) {
        expect(body.dataFilters).toEqual([{ gridRange: { sheetId: 5 } }]);
        return json({ valueRanges: [{ valueRange: { values } }] });
      }
      expect(String(url)).toBe('https://sheets.googleapis.com/v4/spreadsheets/fixture:batchUpdate');
      expect(body.requests).toHaveLength(3);
      for (const { updateCells: cell } of body.requests) {
        expect(cell.range.sheetId).toBe(5); expect(cell.range.startRowIndex).toBe(1);
        const value = cell.rows[0].values[0], index = cell.range.startColumnIndex;
        expect(index).toBeGreaterThan(0);
        if (index === 3) { expect(value.userEnteredValue.numberValue).toBeGreaterThan(46000); expect(value.userEnteredFormat.numberFormat.type).toBe('DATE_TIME'); values[1][index] = '13/10/2026 14:30:42'; }
        else values[1][index] = String(value.userEnteredValue.numberValue ?? value.userEnteredValue.stringValue);
      }
      return json({});
    });
    const result = await createSheetsApi(auth(), request).write(input);
    expect(result.rows[0].values).toEqual(['Ánh', '0', 'Đã gửi', '13/10/2026 14:30:42', '2', '1']);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith(':batchUpdate'))).toHaveLength(1);
    expect(request.mock.calls.every(([, options]) => (options!.headers as Record<string, string>).Authorization === 'Bearer token')).toBe(true);
  });
  it('refuses changed rows and unmapped updates before writing', async () => {
    const request = vi.fn<typeof fetch>(async () => json({ valueRanges: [{ valueRange: { values: [source.columns.map(column => column.label), ['Bình', '', 'Chưa gửi', '', '2', '1']] } }] }));
    const api = createSheetsApi(auth(), request);
    await expect(api.write(input)).rejects.toThrow('SHEET_ROW_CHANGED');
    expect(request).toHaveBeenCalledTimes(1);
    await expect(api.write({ ...input, updates: { 'column-0': 'Đã gửi' } })).rejects.toThrow('SHEET_WRITE_INVALID');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('refreshes a rejected token once and reports missing file authorization without retrying', async () => {
    const session = auth();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ valueRanges: [{ valueRange: { values: [['Name']] } }] }));
    expect((await createSheetsApi(session, request).read(url)).rows).toEqual([]); expect(session.invalidate).toHaveBeenCalledOnce();
    const denied = vi.fn<typeof fetch>(async () => json({}, 403));
    await expect(createSheetsApi(session, denied).read(url)).rejects.toThrow('SHEETS_API_ACCESS_DENIED'); expect(denied).toHaveBeenCalledOnce();
  });
  it('backs off on temporary failures and retries only API requests', async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 429)).mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ valueRanges: [{ valueRange: { values: [['Name']] } }] }));
    const pending = createSheetsApi(auth(), request).read(url);
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).rows).toEqual([]); expect(request).toHaveBeenCalledTimes(3);
  });
});
