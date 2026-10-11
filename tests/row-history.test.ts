import { matchesRow } from '../src/shared/row-filter';
import { describe, expect, it } from 'vitest';
import { historyScope, sheetRowId, uniqueSheetRows } from '../src/main/row-history';
import { sourceFromCsv } from '../src/sources/sheets';
import { historyQuerySchema, preferencesSchema } from '../src/shared/contracts';
describe('whole Sheets row identity', () => {
  it('includes unmapped columns and preserves raw strings', () => {
    const source = sourceFromCsv('Tên,Ghi chú\nÁnh,abc');
    const id = sheetRowId(source, source.rows[0].values);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(sheetRowId(source, ['Ánh', 'abcd'])).not.toBe(id);
    expect(sheetRowId(source, ['Ánh ', 'abc'])).not.toBe(id);
    expect(sheetRowId(source, ['Ánh', 'abc'])).toBe(id);
  });
  it('stays stable when rows move or append, excludes row number, and scopes by Form/source', () => {
    const before = sourceFromCsv('A,B\nx,y');
    const after = sourceFromCsv('A,B\nz,w\nx,y');
    expect(sheetRowId(before, before.rows[0].values)).toBe(sheetRowId(after, after.rows[1].values));
    expect(historyScope('s1', 'f1')).not.toBe(historyScope('s1', 'f2'));
    expect(historyScope('s1', 'f1')).not.toBe(historyScope('s2', 'f1'));
  });
  it('uses all ordered columns and deduplicates identical rows, newest source row first', () => {
    const source = sourceFromCsv('A,B\nx,y\nx,y\nz,w');
    expect(uniqueSheetRows(source).map(row => row.number)).toEqual([4, 3]);
    expect(sheetRowId(source, ['x', 'y'])).not.toBe(sheetRowId(sourceFromCsv('B,A\ny,x'), ['y', 'x']));
  });
  it('filters raw values without case/accents, across all columns or one column', () => {
    expect(matchesRow(['Đặng Ánh', 'Hà Nội'], 'DANG anh')).toBe(true);
    expect(matchesRow(['Đặng Ánh', 'Hà Nội'], 'ha noi', 0)).toBe(false);
    expect(matchesRow(['Đặng Ánh', 'Hà Nội'], 'ha noi', 1)).toBe(true);
    expect(matchesRow(['x'], '%')).toBe(false);
    expect(matchesRow(['x'], '')).toBe(true);
  });
  it('validates delay and filters at IPC boundary', () => {
    expect(preferencesSchema.parse({ retentionHours: 24 }).sendDelaySeconds).toBe(0);
    for (const sendDelaySeconds of [-1, 0.5, 3601, '1']) expect(preferencesSchema.safeParse({ retentionHours: 24, sendDelaySeconds }).success).toBe(false);
    for (const fieldDelayMs of [-1, 0.5, 60001, '100']) expect(preferencesSchema.safeParse({ retentionHours: 24, fieldDelayMs }).success).toBe(false);
    for (const key of ['deleteExpired', 'minimizeChrome']) expect(preferencesSchema.safeParse({ retentionHours: 24, [key]: 'true' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ mapping: {}, status: 'sent', search: 'x'.repeat(201) }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ mapping: {}, status: 'sent', column: 200 }).success).toBe(false);
  });
  it('validates cursor and retention at IPC boundary', () => {
    expect(preferencesSchema.parse({ retentionHours: 24 })).toEqual({ retentionHours: 24, sendDelaySeconds: 0, fieldDelayMs: 0, deleteExpired: false, minimizeChrome: false });
    for (const value of [0, -1, 1.5, 8761, '24']) expect(preferencesSchema.safeParse({ retentionHours: value }).success).toBe(false);
    expect(historyQuerySchema.parse({ mapping: {}, status: 'sent' }).defaults).toEqual({});
    expect(historyQuerySchema.safeParse({ mapping: {}, status: 'sent', cursor: { order: 0, id: 'wrong' } }).success).toBe(false);
  });
});
