import { describe, expect, it } from 'vitest';
import { mapRow } from '../src/shared/mapping';
import { sendSchema, type LoadedData } from '../src/shared/contracts';
import { sourceFromCsv } from '../src/sources/sheets';
import { sheetRowId } from '../src/main/row-history';
const data: LoadedData = { source: sourceFromCsv('Tên,SĐT\nnguyễn đỨc TOÀN,123456789'), form: { fingerprint: 'format-fixture', fields: [
  { id: 'name', index: 0, title: 'Tên', type: 'text', required: true, options: [] },
  { id: 'phone', index: 1, title: 'SĐT', type: 'text', required: false, options: [] },
] } };
const mapping = { name: 'column-0', phone: 'column-1' };
const formatting = { name: { name: true }, phone: { phone: true } };
describe('format only outgoing Form values', () => {
  it('title-cases Vietnamese names and adds one leading zero without mutating source or identity', () => {
    const original = structuredClone(data.source);
    const id = sheetRowId(data.source, data.source.rows[0].values);
    expect(mapRow(data, data.source.rows[0].values, mapping, {}, new Date(), {}, formatting)).toEqual({ name: 'Nguyễn Đức Toàn', phone: '0123456789' });
    expect(data.source).toEqual(original);
    expect(sheetRowId(data.source, data.source.rows[0].values)).toBe(id);
    expect(mapRow(data, data.source.rows[0].values, mapping)).toEqual({ name: 'nguyễn đỨc TOÀN', phone: '123456789' });
  });
  it('keeps leading zeros, leaves empty optional cells empty, and preserves Vietnamese accents', () => {
    for (const phone of ['0123456789', '00123', '']) expect(mapRow(data, ['NGUYỄN  ĐỨC TOÀN', phone], mapping, {}, new Date(), {}, formatting)).toEqual({ name: 'Nguyễn  Đức Toàn', phone });
    expect(mapRow(data, ['nguyễn đức toàn'.normalize('NFD'), '123'], mapping, {}, new Date(), {}, formatting).name).toBe('Nguyễn Đức Toàn'.normalize('NFD'));
  });
  it('formats defaults after fallback selection and retains required validation', () => {
    expect(mapRow(data, [], {}, { name: 'nguyễn đức toàn', phone: '123456789' }, new Date(), {}, formatting)).toEqual({ name: 'Nguyễn Đức Toàn', phone: '0123456789' });
    expect(() => mapRow(data, [], {}, {}, new Date(), {}, formatting)).toThrow('ROW_VALIDATION_FAILED');
    expect(mapRow(data, ['nguyễn đức toàn', '123'], mapping, {}, new Date(), {}, { name: { name: false }, phone: { phone: false } })).toEqual({ name: 'nguyễn đức toàn', phone: '123' });
  });
  it('blocks formatting on non-text fields and stale IDs', () => {
    const choices = { ...data, form: { ...data.form, fields: [{ ...data.form.fields[0], type: 'dropdown' as const, options: ['abc'] }] } };
    expect(() => mapRow(choices, ['abc'], { name: 'column-0' }, {}, new Date(), {}, { name: { name: true } })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => mapRow(data, ['a'], mapping, {}, new Date(), {}, { stale: { name: true } })).toThrow('MAPPING_INVALID');
  });
  it('defaults legacy send calls to disabled formatting and validates flags', () => {
    expect(sendSchema.parse({ mapping }).formatting).toEqual({});
    expect(sendSchema.safeParse({ mapping, formatting: { name: { name: 'true' } } }).success).toBe(false);
    expect(sendSchema.safeParse({ mapping, formatting: { name: { script: 'anything' } } }).success).toBe(false);
  });
});
