import { describe, expect, it } from 'vitest';
import { parseFormUrl, validatePayload, type FormField } from '../src/shared/contracts';

const fields: FormField[] = [
  { id: 'q-0', index: 0, title: 'Họ tên *', required: true, type: 'text', options: [] },
  { id: 'q-1', index: 1, title: 'Sở thích', required: false, type: 'checkbox', options: ['Đọc sách', 'Du lịch'] },
];
describe('Form trust boundary', () => {
  it('accepts respondent URLs and removes prefilled and session parameters', () => {
    expect(parseFormUrl('https://docs.google.com/forms/d/e/abc/viewform?entry.123=test#part')).toBe('https://docs.google.com/forms/d/e/abc/viewform');
    expect(parseFormUrl('https://docs.google.com/forms/d/abc/viewform')).toBe('https://docs.google.com/forms/d/abc/viewform');
  });
  it.each(['http://docs.google.com/forms/d/abc/viewform', 'https://docs.google.com.evil.test/forms/d/abc/viewform', 'https://user@docs.google.com/forms/d/abc/viewform', 'https://docs.google.com/forms/d/abc/edit', 'file:///etc/passwd', 'https://docs.google.com:444/forms/d/abc/viewform'])('rejects %s', url => {
    expect(() => parseFormUrl(url)).toThrow('FORM_URL_INVALID');
  });

});
describe('payload validation', () => {
  it('preserves Vietnamese text and valid checkbox choices', () => {
    expect(() => validatePayload(fields, { 'q-0': 'Nguyễn Thị Ánh', 'q-1': ['Đọc sách'] })).not.toThrow();
  });
  it('blocks missing required values, unknown fields, invalid and duplicate options', () => {
    expect(() => validatePayload(fields, { 'q-0': '  ' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => validatePayload(fields, { unknown: 'x' })).toThrow('FORM_SCHEMA_CHANGED');
    expect(() => validatePayload(fields, { 'q-0': 'x', 'q-1': ['Unknown'] })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => validatePayload(fields, { 'q-0': 'x', 'q-1': ['Du lịch', 'Du lịch'] })).toThrow('ROW_VALIDATION_FAILED');
  });
  it('reports the failing field and separates blank, choice and date-bound reasons', () => {
    const check = (testFields: FormField[], payload: Record<string, string | string[]>, fieldId: string, reason: string) => {
      try { validatePayload(testFields, payload); throw new Error('Expected failure'); }
      catch (error) { expect(error).toMatchObject({ field: { id: fieldId }, reason: expect.stringContaining(reason) }); }
    };
    check(fields, {}, 'q-0', 'chưa có cột');
    check(fields, { 'q-0': '', 'q-1': [] }, 'q-0', 'đang trống');
    check(fields, { 'q-0': 'x', 'q-1': ['Other'] }, 'q-1', 'không khớp');
    check([{ id: 'date', title: 'Ngày', index: 0, type: 'date', required: true, options: [], minDate: '2027-01-01' }], { date: '2026-10-11' }, 'date', '2027-01-01');
  });
  it('blocks unsupported questions and incorrect scalar/array types', () => {
    expect(() => validatePayload([{ ...fields[0], type: 'unsupported' }], {})).toThrow('UNSUPPORTED_QUESTION');
    expect(() => validatePayload(fields, { 'q-0': ['x'] })).toThrow('ROW_VALIDATION_FAILED');
  });
});

describe('calendar dates', () => {
  const date: FormField = { id: 'date', index: 0, title: 'Ngày *', required: true, type: 'date', options: [] };
  it.each(['2028-02-29', '2026-10-10', '2000-02-29'])('accepts %s', value => {
    expect(() => validatePayload([date], { date: value })).not.toThrow();
  });
  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '10/10/2026', '2026-1-1', '0000-01-01', '2026-10-10T00:00:00Z', ''])('rejects %s', value => {
    expect(() => validatePayload([date], { date: value })).toThrow('ROW_VALIDATION_FAILED');
  });
  it('allows a blank optional date and checks discovered bounds inclusively', () => {
    expect(() => validatePayload([{ ...date, required: false }], { date: '' })).not.toThrow();
    const bounded = { ...date, minDate: '2026-10-10', maxDate: '2026-10-12' };
    expect(() => validatePayload([bounded], { date: '2026-10-10' })).not.toThrow();
    expect(() => validatePayload([bounded], { date: '2026-10-12' })).not.toThrow();
    expect(() => validatePayload([bounded], { date: '2026-10-09' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => validatePayload([bounded], { date: '2026-10-13' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => validatePayload([date], { date: ['2026-10-10'] })).toThrow('ROW_VALIDATION_FAILED');
  });
});
