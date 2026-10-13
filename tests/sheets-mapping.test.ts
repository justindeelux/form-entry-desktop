import { describe, expect, it } from 'vitest';
import { loadSchema, defaultsSchema, parseSheetsUrl, type LoadedData } from '../src/shared/contracts';
import { parseCsv, sourceFromCsv } from '../src/sources/sheets';
import { mapRow } from '../src/shared/mapping';

describe('Sheets source', () => {
  it('selects the tab from query or fragment and validates Google URLs', () => {
    expect(parseSheetsUrl('https://docs.google.com/spreadsheets/d/abc/edit#gid=12').exportUrl).toBe('https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=12');
    expect(parseSheetsUrl('https://docs.google.com/spreadsheets/d/abc/edit?gid=3#gid=12').url).toContain('gid=3');
    expect(parseSheetsUrl('https://docs.google.com/spreadsheets/u/0/d/abc/edit#gid=12')).toEqual(parseSheetsUrl('https://docs.google.com/spreadsheets/d/abc/edit?gid=12'));
    for (const url of ['http://docs.google.com/spreadsheets/d/abc/edit', 'https://user@docs.google.com/spreadsheets/d/abc/edit', 'https://evil.test/spreadsheets/d/abc/edit', 'https://docs.google.com/spreadsheets/d/abc/edit?gid=oops']) expect(() => parseSheetsUrl(url)).toThrow('SHEETS_URL_INVALID');
  });
  it('preserves Unicode, zero prefixes, commas, multiline and escaped quotes', () => {
    expect(parseCsv('\uFEFFHọ tên,SĐT,Ghi chú\r\nÁnh,001234,"a,b\n""c"""\r\n')).toEqual([['Họ tên', 'SĐT', 'Ghi chú'], ['Ánh', '001234', 'a,b\n"c"']]);
    for (const text of ['"unfinished', 'x"y', '"x"oops']) expect(() => parseCsv(text)).toThrow('SHEETS_DATA_INVALID');
  });
  it('distinguishes duplicate/blank headers and preserves source row numbers', () => {
    const data = sourceFromCsv('Tên,Tên,\nA,B,\n,,\nC,D,E');
    expect(data.columns.map(column => column.id)).toEqual(['column-0', 'column-1', 'column-2']);
    expect(data.columns[2].label).toBe('Cột 3');
    expect(data.rows.map(row => row.number)).toEqual([2, 4]);
  });
  it('reads from the physical Sheets row, retaining headers and skipping blank rows', () => {
    const csv = 'Tên,Ghi chú\nA,first\n,\nC,last';
    expect(sourceFromCsv(csv, 3).rows).toEqual([{ number: 4, values: ['C', 'last'] }]);
    expect(sourceFromCsv(csv, 3).columns[0]).toMatchObject({ label: 'Tên', sample: 'C' });
    expect(sourceFromCsv(csv, 1)).toEqual(sourceFromCsv(csv));
    expect(() => sourceFromCsv(csv, 5)).toThrow('SHEETS_EMPTY');
    const urls = { sheetsUrl: '', formUrl: '' };
    for (const startRow of [0, -1, 1.5, 10002, '101']) expect(loadSchema.safeParse({ ...urls, startRow }).success).toBe(false);
    expect(loadSchema.parse({ ...urls, startRow: 101 }).startRow).toBe(101);
  });
  it('rejects empty and excessively wide sources', () => {
    expect(() => sourceFromCsv('Tên\n')).toThrow('SHEETS_EMPTY');
    expect(() => sourceFromCsv('A\nx,y')).toThrow('SHEETS_TOO_LARGE');
    expect(() => sourceFromCsv(`A\n${'x'.repeat(10001)}`)).toThrow('SHEETS_TOO_LARGE');
  });
});
describe('mapping rows', () => {
  const data: LoadedData = { source: sourceFromCsv('Tên,Ngày,Sở thích\n  Ánh  ,29/02/2028,Đọc sách; Du lịch'), form: { fingerprint: 'abc', fields: [
    { id: 'name', title: 'Tên', index: 0, required: true, type: 'text', options: [] },
    { id: 'date', title: 'Ngày', index: 1, required: true, type: 'date', options: [] },
    { id: 'hobbies', title: 'Sở thích', index: 2, required: false, type: 'checkbox', options: ['Đọc sách', 'Du lịch'] },
  ] } };
  const mapping = { name: 'column-0', date: 'column-1', hobbies: 'column-2' };
  it('trims values, converts day-first dates and splits checkbox choices', () => {
    expect(mapRow(data, data.source.rows[0].values, mapping)).toEqual({ name: 'Ánh', date: '2028-02-29', hobbies: ['Đọc sách', 'Du lịch'] });
  });
  it('uses defaults for unmapped fields and blank cells, preserving nonblank Sheets values', () => {
    const defaults = { name: '  Mặc định  ', date: '29/02/2028', hobbies: 'Đọc sách; Du lịch' };
    expect(mapRow(data, [], {}, defaults)).toEqual({ name: 'Mặc định', date: '2028-02-29', hobbies: ['Đọc sách', 'Du lịch'] });
    expect(mapRow(data, ['Ánh', ' ', ''], mapping, defaults)).toEqual({ name: 'Ánh', date: '2028-02-29', hobbies: ['Đọc sách', 'Du lịch'] });
    expect(() => mapRow(data, [], {}, { ...defaults, name: '  ' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => mapRow(data, [], {}, { ...defaults, hobbies: 'Other' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => mapRow(data, [], {}, { ...defaults, stale: 'value' })).toThrow('MAPPING_INVALID');
  });
  it('resolves current date in local calendar time, keeps Sheets priority and validates date limits', () => {
    const now = new Date(2026, 9, 11, 0, 15);
    const defaults = { name: 'Mặc định', date: { currentDate: true as const } };
    expect(mapRow(data, [], {}, defaults, now).date).toBe('2026-10-11');
    expect(mapRow(data, ['Ánh', '29/02/2028'], mapping, defaults, now).date).toBe('2028-02-29');
    expect(() => mapRow(data, [], {}, { ...defaults, name: { currentDate: true } }, now)).toThrow('ROW_VALIDATION_FAILED');
    const restricted = { ...data, form: { ...data.form, fields: data.form.fields.map(field => field.type === 'date' ? { ...field, minDate: '2027-01-01' } : field) } };
    expect(() => mapRow(restricted, [], {}, defaults, now)).toThrow('ROW_VALIDATION_FAILED');
    expect(defaultsSchema.safeParse({ date: { currentDate: false } }).success).toBe(false);
    expect(defaultsSchema.safeParse({ date: { currentDate: true, extra: 1 } }).success).toBe(false);
  });
  it('takes the date from timestamps while preserving source priority over current-date defaults', () => {
    expect(mapRow(data, ['Ánh', '11/10/2026 09:30:00', 'Đọc sách'], mapping, { date: { currentDate: true } }).date).toBe('2026-10-11');
    expect(() => mapRow(data, ['Ánh', '11/10/2026 25:30:00', 'Đọc sách'], mapping)).toThrow('ROW_VALIDATION_FAILED');
  });
  it('adds midnight for date-only datetime fields and preserves supplied time', () => {
    const datetime: LoadedData = { ...data, form: { ...data.form, fields: data.form.fields.map(field => field.id === 'date' ? { ...field, type: 'datetime', timePrecision: 'minute' } : field) } };
    expect(mapRow(datetime, ['Ánh', '29/02/2028', 'Đọc sách'], mapping).date).toBe('2028-02-29T00:00:00');
    expect(mapRow(datetime, ['Ánh', '29/02/2028 14:30', 'Đọc sách'], mapping).date).toBe('2028-02-29T14:30:00');
    expect(mapRow(datetime, ['Ánh', '', 'Đọc sách'], mapping, { date: { currentDate: true } }, new Date(2026, 9, 11, 9, 15, 42)).date).toBe('2026-10-11T09:15:00');
    expect(() => mapRow(datetime, ['Ánh', '29/02/2028 14:30:42', 'Đọc sách'], mapping)).toThrow('ROW_VALIDATION_FAILED');
  });
  it('blocks stale IDs, missing required mappings, invalid dates and unknown options', () => {
    expect(() => mapRow(data, data.source.rows[0].values, { ...mapping, name: 'deleted' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => mapRow(data, data.source.rows[0].values, { date: 'column-1' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => mapRow(data, ['Ánh', '29/02/2026', 'Đọc sách'], mapping)).toThrow('ROW_VALIDATION_FAILED');
    expect(() => mapRow(data, ['Ánh', '2028-02-29', 'Other'], mapping)).toThrow('ROW_VALIDATION_FAILED');
  });
});
