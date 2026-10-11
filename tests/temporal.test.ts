import { describe, expect, it } from 'vitest';
import { normalizeDate, normalizeDateTime, parseTemporal } from '../src/shared/temporal';
import { validatePayload, type FormField } from '../src/shared/contracts';

describe('calendar conversion', () => {
  it.each(['11/10/2026 09:30:42', '2026-10-11T09:30:42', '2026-10-11 09:30:42'])('extracts date and preserves time from %s', value => {
    expect(normalizeDate(value)).toBe('2026-10-11');
    expect(normalizeDateTime(value)).toBe('2026-10-11T09:30:42');
  });
  it.each(['11/10/2026', '2026-10-11'])('uses midnight for %s', value => {
    expect(normalizeDateTime(value)).toBe('2026-10-11T00:00:00');
  });
  it('handles 12-hour time and minute-only time without locale guessing', () => {
    expect(normalizeDateTime('11/10/2026 12:30 AM')).toBe('2026-10-11T00:30:00');
    expect(normalizeDateTime('11/10/2026 12:30 PM')).toBe('2026-10-11T12:30:00');
    expect(normalizeDateTime('11/10/2026 9:30 PM')).toBe('2026-10-11T21:30:00');
    expect(normalizeDateTime('11/10/2026 09:30')).toBe('2026-10-11T09:30:00');
  });
  it.each(['29/02/2026 09:30', '31/04/2026', '2026-10-11 24:00:00', '2026-10-11 23:60:00', '2026-10-11 23:59:60', '2026-10-11T09:30:00Z', '2026-10-11 garbage', '0000-01-01', '10/11/26', '11/10/2026 00:30 AM'])('rejects malformed or invalid %s even when only date is needed', value => {
    expect(parseTemporal(value)).toBeUndefined();
    expect(normalizeDate(value)).toBe(value);
  });
});
describe('datetime payload boundary', () => {
  const field: FormField = { id: 'dt', title: 'Ngày giờ', index: 0, type: 'datetime', required: true, options: [], timeLayout: 'time', timePrecision: 'second', minDate: '2026-10-10', maxDate: '2026-10-12' };
  it('validates full datetime values and inclusive calendar/date-time bounds', () => {
    expect(() => validatePayload([field], { dt: '2026-10-12T23:59:59' })).not.toThrow();
    expect(() => validatePayload([field], { dt: '2026-10-13T00:00:00' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => validatePayload([{ ...field, minDate: '2026-10-11T10:00:00' }], { dt: '2026-10-11T09:59:59' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => validatePayload([{ ...field, required: false }], { dt: '' })).not.toThrow();
  });
  it('requires canonical datetime and respects minute-only fields', () => {
    expect(() => validatePayload([field], { dt: '2026-10-11' })).toThrow('ROW_VALIDATION_FAILED');
    expect(() => validatePayload([{ ...field, timePrecision: 'minute' }], { dt: '2026-10-11T09:30:00' })).not.toThrow();
    expect(() => validatePayload([{ ...field, timePrecision: 'minute' }], { dt: '2026-10-11T09:30:01' })).toThrow('ROW_VALIDATION_FAILED');
  });
});
