import { matchesRow } from '../src/shared/row-filter';
import { describe, expect, it } from 'vitest';
import { historyScope, sheetRows } from '../src/main/row-history';
import { sourceFromCsv } from '../src/sources/sheets';
import { historyQuerySchema, preferencesSchema } from '../src/shared/contracts';
describe('whole Sheets row identity', () => {
  it('includes unmapped columns and preserves raw strings', () => {
    const source = sourceFromCsv('Tên,Ghi chú\nÁnh,abc');
    const id = sheetRows(source, {})[0].id;
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(sheetRows({ ...source, rows: [{ number: 2, values: ['Ánh', 'abcd'] }] }, {})[0].id).not.toBe(id);
    expect(sheetRows({ ...source, rows: [{ number: 2, values: ['Ánh ', 'abc'] }] }, {})[0].id).not.toBe(id);
    expect(sheetRows({ ...source, rows: [{ number: 2, values: ['Ánh', 'abc'] }] }, {})[0].id).toBe(id);
  });
  it('detects moved rows and scopes legacy migration by Form/source', () => {
    const before = sourceFromCsv('A,B\nx,y');
    const after = sourceFromCsv('A,B\nz,w\nx,y');
    expect(sheetRows(before, {})[0].id).not.toBe(sheetRows(after, {})[0].id);
    expect(historyScope('s1', 'f1')).not.toBe(historyScope('s1', 'f2'));
    expect(historyScope('s1', 'f1')).not.toBe(historyScope('s2', 'f1'));
  });
  it('uses all ordered columns and keeps identical physical rows, last source row first', () => {
    const source = sourceFromCsv('A,B\nx,y\nx,y\nz,w');
    expect(sheetRows(source, {}).map(row => row.number)).toEqual([4, 3, 2]);
    expect(sheetRows(source, {})[1].id).not.toBe(sheetRows(sourceFromCsv('B,A\ny,x'), {})[0].id);
  });
  it('filters raw values without case/accents, across all columns or one column', () => {
    expect(matchesRow(['Đặng Ánh', 'Hà Nội'], 'DANG anh')).toBe(true);
    expect(matchesRow(['Đặng Ánh', 'Hà Nội'], 'ha noi', 0)).toBe(false);
    expect(matchesRow(['Đặng Ánh', 'Hà Nội'], 'ha noi', 1)).toBe(true);
    expect(matchesRow(['x'], '%')).toBe(false);
    expect(matchesRow(['x'], '')).toBe(true);
  });
  it('validates delay and filters at IPC boundary', () => {
    expect(preferencesSchema.parse({}).sendDelaySeconds).toBe(0);
    for (const sendDelaySeconds of [-1, 0.5, 3601, '1']) expect(preferencesSchema.safeParse({ sendDelaySeconds }).success).toBe(false);
    for (const fieldDelayMs of [-1, 0.5, 60001, '100']) expect(preferencesSchema.safeParse({ fieldDelayMs }).success).toBe(false);
    for (const key of ['minimizeChrome']) expect(preferencesSchema.safeParse({ [key]: 'true' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ mapping: {}, status: 'sent', search: 'x'.repeat(201) }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ mapping: {}, status: 'sent', column: 200 }).success).toBe(false);
  });
  it('validates cursor and rejects obsolete local history retention', () => {
    expect(preferencesSchema.parse({})).toEqual({ sendDelaySeconds: 0, fieldDelayMs: 0, minimizeChrome: false });
    for (const value of [24, 0, -1, 1.5, 8761, '24']) expect(preferencesSchema.safeParse({ retentionHours: value }).success).toBe(false);
    expect(historyQuerySchema.parse({ mapping: {}, status: 'sent' }).defaults).toEqual({});
    expect(historyQuerySchema.safeParse({ mapping: {}, status: 'sent', cursor: { order: 0, id: 'wrong' } }).success).toBe(false);
  });
});
