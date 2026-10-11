import { describe, expect, it } from 'vitest';
import { resolveOption } from '../src/shared/options';
import { FieldValidationError, type FormField, type LoadedData } from '../src/shared/contracts';
import { mapRow } from '../src/shared/mapping';
const field: FormField = { id: 'q-0', title: 'Thành phố', index: 0, required: true, type: 'dropdown', options: ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng'] };
describe('canonical option matching', () => {
  it.each([' HÀ\u00a0 NỘI ', 'ha noi', 'Hà Nội', 'Hà_Nội', 'Hà-Nội'])('normalizes %s', value => expect(resolveOption(field, value)).toBe('Hà Nội'));
  it.each(['Hồ Chí Mnh', 'Hồ Chí Mnih'])('accepts a unique small typo %s', value => expect(resolveOption(field, value)).toBe('Hồ Chí Minh'));
  it('stops at normalization ambiguity, while exact match wins', () => {
    const ambiguous = { ...field, options: ['Hòa', 'Hóa'] };
    expect(() => resolveOption(ambiguous, 'Hoa')).toThrow(FieldValidationError);
    expect(resolveOption(ambiguous, 'Hòa')).toBe('Hòa');
  });
  it('blocks short, numeric, abbreviation, punctuation and distant inputs', () => {
    for (const [source, options] of [['Co', ['Có', 'Cổ']], ['Quận 1', ['Quận 2']], ['TP.HCM', field.options], ['Có', ['Không']], ['Hà+Nội', ['Hà Nội']], ['Ho Chi Minh 1', ['Hồ Chí Minh 2']]] as [string, string[]][]) expect(() => resolveOption({ ...field, options }, source)).toThrow(FieldValidationError);
  });
  it('uses confirmed per-field aliases only if option still exists', () => {
    expect(resolveOption(field, 'TP.HCM', [{ source: 'TP.HCM', option: 'Hồ Chí Minh' }])).toBe('Hồ Chí Minh');
    expect(() => resolveOption(field, 'TP.HCM', [{ source: 'TP.HCM', option: 'Removed' }])).toThrow();
    expect(resolveOption(field, 'Hà Nội', [{ source: 'Hà Nội', option: 'Hồ Chí Minh' }])).toBe('Hà Nội');
  });
  it('requires separation from second candidate', () => expect(() => resolveOption({ ...field, options: ['Hồ Chí Minh', 'Hồ Chí Minx'] }, 'Hồ Chí Mnh')).toThrow());
  it('handles two edits in long labels but blocks larger differences', () => {
    const long = { ...field, options: ['Thành phố Hồ Chí Minh'] };
    expect(resolveOption(long, 'Thành phố H Chí Mnh')).toBe(long.options[0]);
    expect(() => resolveOption(long, 'Thanh pho xa la')).toThrow();
  });
  it('returns original Form option and stops duplicate resolved checkbox values', () => {
    const data: LoadedData = { source: { columns: [{ id: 'c', index: 0, label: 'City', sample: '' }], rows: [] }, form: { fingerprint: 'fp', fields: [field] } };
    expect(mapRow(data, ['ho chi minh'], { 'q-0': 'c' })).toEqual({ 'q-0': 'Hồ Chí Minh' });
    const checkbox = { ...data, form: { ...data.form, fields: [{ ...field, type: 'checkbox' as const }] } };
    expect(() => mapRow(checkbox, ['ha noi;HÀ NỘI'], { 'q-0': 'c' })).toThrow(FieldValidationError);
    try { mapRow(data, ['TP.HCM'], { 'q-0': 'c' }); } catch (error) {
      expect((error as FieldValidationError).choice).toEqual({ source: 'TP.HCM', options: field.options });
    }
    expect(mapRow(data, ['TP.HCM'], { 'q-0': 'c' }, {}, new Date(), { 'q-0': [{ source: 'TP.HCM', option: 'Hồ Chí Minh' }] })).toEqual({ 'q-0': 'Hồ Chí Minh' });
  });
});
