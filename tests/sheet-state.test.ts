import { describe, expect, it } from 'vitest';
import { sourceFromCsv } from '../src/sources/sheets';
import { repeatDue, sameSheetCell, sheetStatus, sheetTimestamp, submissionUpdates, timestampFormula, validateSheetColumns, validateSheetWrite } from '../src/shared/sheet-state';
import { assertSheetRow, columnAddress } from '../src/sources/google-sheets';
import { sheetRows } from '../src/main/row-history';
import type { SheetColumns } from '../src/shared/contracts';

const source = sourceFromCsv('Họ tên,Số lần,Số ngày,Bộ đếm,Trạng thái,Thời điểm\nÁnh,2,1,0,Đã gửi,12/10/2026 14:30:42\nÁnh,2,1,0,Đã gửi,12/10/2026 14:30:42');
const columns: SheetColumns = { repeat: 'column-1', repeatDays: 'column-2', repeated: 'column-3', result: 'column-4', sentAt: 'column-5' };
const values = source.rows[0].values;
const withValues = (changes: Record<number, string | undefined>) => values.map((value, index) => changes[index] ?? value);

describe('explicit Sheets state mapping and repetition', () => {
  it('requires explicit distinct state columns and the complete optional repeat group', () => {
    expect(() => validateSheetColumns(source, {})).toThrow('SHEET_MAPPING_INVALID');
    expect(() => validateSheetColumns(source, { result: 'column-4', sentAt: 'column-5' })).not.toThrow();
    expect(() => validateSheetColumns(source, columns)).not.toThrow();
    for (const invalid of [{ ...columns, repeated: undefined }, { ...columns, result: columns.sentAt }, { ...columns, result: 'missing' }])
      expect(() => validateSheetColumns(source, invalid)).toThrow('SHEET_MAPPING_INVALID');
  });
  it('uses selected columns regardless of labels and skips a blank limit or interval', () => {
    expect(sheetStatus(source, values, columns)).toBe('sent');
    expect(sheetStatus(source, withValues({ 4: '' }), columns)).toBe('unsent');
    expect(() => sheetStatus(source, withValues({ 4: 'Có' }), columns)).toThrow('SHEET_STATUS_INVALID');
    for (const changes of [{ 1: '' }, { 2: '' }, { 1: ' ' }]) expect(repeatDue(source, withValues(changes), columns, new Date(2030, 0))).toBe(false);
    expect(repeatDue(source, values, { result: columns.result, sentAt: columns.sentAt }, new Date(2030, 0))).toBe(false);
  });
  it('waits until the exact due time and caps the number of additional sends', () => {
    expect(repeatDue(source, values, columns, new Date(2026, 9, 13, 14, 30, 41))).toBe(false);
    expect(repeatDue(source, values, columns, new Date(2026, 9, 13, 14, 30, 42))).toBe(true);
    expect(repeatDue(source, withValues({ 3: '1' }), columns, new Date(2026, 9, 14))).toBe(true);
    expect(repeatDue(source, withValues({ 3: '2' }), columns, new Date(2030, 0))).toBe(false);
    expect(repeatDue(source, withValues({ 1: '0', 5: '' }), columns, new Date(2030, 0))).toBe(false);
    expect(repeatDue(source, withValues({ 3: '' }), columns, new Date(2030, 0))).toBe(true);
  });
  it('allows repetition configured after sending, anchored to the existing sent time', () => {
    const now = new Date(2026, 9, 13, 14, 30, 42);
    for (const changes of [{ 1: '' }, { 2: '' }, { 1: '', 2: '' }]) {
      const row = withValues(changes);
      expect(repeatDue(source, row, columns, now)).toBe(false);
      row[1] = '2'; row[2] = '1';
      expect(sheetStatus(source, row, columns)).toBe('sent');
      expect(repeatDue(source, row, columns, now)).toBe(true);
    }
  });
  it('rejects invalid numbers and missing or malformed dates when repetition is needed', () => {
    for (const changes of [{ 1: '-1' }, { 1: '1.5' }, { 1: '9007199254740992' }, { 2: '0' }, { 2: 'abc' }, { 3: '-1' }, { 3: '1.2' }, { 5: '' }, { 5: '31/02/2026' }])
      expect(() => repeatDue(source, withValues(changes), columns, new Date(2030, 0))).toThrow('SHEET_REPEAT_INVALID');
  });
  it('writes initial count zero and increments once with a new sent time', () => {
    const now = new Date(2026, 11, 31, 23, 59, 58);
    expect(submissionUpdates(source, withValues({ 3: '9' }), columns, false, now)).toEqual({ 'column-3': '0', 'column-5': '2026-12-31T23:59:58', 'column-4': 'Đã gửi' });
    expect(submissionUpdates(source, withValues({ 3: '1' }), columns, true, now)['column-3']).toBe('2');
    expect(repeatDue(source, withValues({ 5: '31-12-2026 23:59:58' }), columns, new Date(2027, 0, 1, 23, 59, 58))).toBe(true);
  });
  it('parses full timestamps, time-first placeholders and spreadsheet serials without losing seconds', () => {
    const expected = new Date(2026, 9, 13, 14, 30, 42).getTime();
    for (const value of ['13-10-2026 14:30:42', '14:30:42 13-10-2026', '2026-10-13T14:30:42']) expect(sheetTimestamp(value)).toBe(expected);
    const formula = timestampFormula('2026-10-13T14:30:42');
    const match = formula.match(/^=(\d+)\+(\d+)\/86400$/)!;
    const serial = String(Number(match[1]) + Number(match[2]) / 86400);
    expect(sheetTimestamp(serial)).toBe(expected);
    expect(sameSheetCell(serial, '2026-10-13T14:30:42', true)).toBe(true);
    expect(sheetTimestamp('invalid')).toBeUndefined();
  });
});

describe('safe Sheets writes and row identity', () => {
  const request = { sheetsUrl: 'https://docs.google.com/spreadsheets/d/fixture/edit?gid=5', source, row: 2, sheetColumns: columns, updates: { 'column-4': 'Đã gửi' } };
  it('keeps identical physical rows distinct and identity stable across control updates', () => {
    const before = sheetRows(source, columns);
    expect(before).toHaveLength(2);
    expect(before[0].id).not.toBe(before[1].id);
    const edited = { ...source, rows: source.rows.map(row => ({ ...row, values: withValues({ 3: '1', 5: '2026-10-14T14:30:42' }) })) };
    expect(sheetRows(edited, columns).map(row => row.id)).toEqual(before.map(row => row.id));
    expect(sheetRows({ ...source, rows: [{ number: 2, values: withValues({ 0: 'Bình' }) }] }, columns)[0].id).not.toBe(before[1].id);
  });
  it('refuses changed rows, reordered headers and writes outside the selected controls', () => {
    expect(() => assertSheetRow(source, request)).not.toThrow();
    expect(() => assertSheetRow({ ...source, rows: [{ number: 2, values: withValues({ 4: 'Chưa gửi' }) }] }, request)).toThrow('SHEET_ROW_CHANGED');
    expect(() => assertSheetRow({ ...source, columns: [...source.columns].reverse() }, request)).toThrow('SHEET_ROW_CHANGED');
    expect(() => validateSheetWrite({ ...request, updates: { 'column-0': 'Other name' } })).toThrow('SHEET_WRITE_INVALID');
    expect(() => validateSheetWrite({ ...request, updates: { 'column-3': '=IMPORTXML("other")' } })).toThrow('SHEET_WRITE_INVALID');
    expect(() => validateSheetWrite(request)).not.toThrow();
    expect([0, 25, 26, 199].map(columnAddress)).toEqual(['A', 'Z', 'AA', 'GR']);
  });
});
