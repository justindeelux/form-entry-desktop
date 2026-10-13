import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeScheduledRows, nextScheduleRun } from '../src/shared/schedule';
import { createScheduler } from '../src/main/scheduler';
import { scheduleRuleSchema, type LoadedData } from '../src/shared/contracts';
import { sourceFromCsv } from '../src/sources/sheets';

afterEach(() => vi.useRealTimers());
describe('scheduled eligibility and boundaries', () => {
  const data: LoadedData = { source: sourceFromCsv('Tên,Ghi chú,Ngày\nÁnh,Đủ,2026-10-11\nBình,,2026-10-11\n,Đủ,2026-10-11\nC,Đủ,31/02/2026'), form: { fingerprint: 'form', fields: [
    { id: 'name', title: 'Tên', index: 0, required: true, type: 'text', options: [] },
    { id: 'note', title: 'Ghi chú', index: 1, required: false, type: 'text', options: [] },
    { id: 'date', title: 'Ngày', index: 2, required: true, type: 'date', options: [] },
  ] } };
  const config = { mapping: { name: 'column-0', note: 'column-1', date: 'column-2' }, defaults: {}, aliases: {}, formatting: {}, sheetColumns: {} };
  it('loads only complete mapped and valid required values, leaving source unchanged', () => {
    const before = JSON.stringify(data);
    expect(completeScheduledRows(data, config).source.rows.map(row => row.number)).toEqual([2]);
    expect(completeScheduledRows(data, { ...config, defaults: { note: 'Mặc định' } }).source.rows.map(row => row.number)).toEqual([2, 3]);
    expect(JSON.stringify(data)).toBe(before);
    expect(() => completeScheduledRows(data, { ...config, mapping: { name: 'missing' } })).toThrow('MAPPING_INVALID');
  });
  it('supports no eligible rows and an empty source when explicitly allowed', () => {
    expect(completeScheduledRows({ ...data, source: { ...data.source, rows: [data.source.rows[2]] } }, config).source.rows).toEqual([]);
    expect(sourceFromCsv('Tên\n', 1, true)).toMatchObject({ rows: [], columns: [{ label: 'Tên', sample: '' }] });
    expect(() => sourceFromCsv('Tên\n')).toThrow('SHEETS_EMPTY');
  });
  it('validates minute/hour boundaries and computes the next local daily time', () => {
    expect(scheduleRuleSchema.parse({ mode: 'interval', minutes: 1 })).toEqual({ mode: 'interval', minutes: 1 });
    for (const minutes of [0, -1, 1.5, 10081, '1']) expect(scheduleRuleSchema.safeParse({ mode: 'interval', minutes }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ mode: 'daily', hour: 24, minute: 0 }).success).toBe(false);
    expect(scheduleRuleSchema.safeParse({ mode: 'daily', hour: 23, minute: 60 }).success).toBe(false);
    const now = new Date(2026, 9, 11, 8, 0);
    expect(nextScheduleRun({ mode: 'interval', minutes: 5 }, now)).toBe(now.getTime() + 300000);
    expect(nextScheduleRun({ mode: 'daily', hour: 9, minute: 15 }, now)).toBe(new Date(2026, 9, 11, 9, 15).getTime());
    expect(nextScheduleRun({ mode: 'daily', hour: 8, minute: 0 }, now)).toBe(new Date(2026, 9, 12, 8, 0).getTime());
    expect(nextScheduleRun({ mode: 'daily', hour: 0, minute: 0 }, new Date(2026, 11, 31, 23, 59))).toBe(new Date(2027, 0, 1).getTime());
  });
});
describe('main-process scheduler', () => {
  it('waits for first interval, never overlaps, and cancels future runs', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const run = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const scheduler = createScheduler(run, vi.fn());
    scheduler.start({ mode: 'interval', minutes: 1 });
    await vi.advanceTimersByTimeAsync(59999); expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120000); expect(run).toHaveBeenCalledOnce();
    expect(scheduler.state().running).toBe(true);
    resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.state().nextRunAt).toBe(Date.now() + 60000);
    scheduler.stop(); await vi.advanceTimersByTimeAsync(120000); expect(run).toHaveBeenCalledOnce();
  });
  it('allows stopping during a run, waits for current outcome, and never restarts it', async () => {
    vi.useFakeTimers();
    let resolve!: () => void, signal!: AbortSignal;
    const run = vi.fn((abort: AbortSignal) => { signal = abort; return new Promise<void>(done => { resolve = done; }); });
    const scheduler = createScheduler(run, vi.fn());
    scheduler.start({ mode: 'interval', minutes: 1 }); await vi.advanceTimersByTimeAsync(60000);
    scheduler.stop(); expect(signal.aborted).toBe(true); expect(scheduler.state().running).toBe(true);
    expect(() => scheduler.start({ mode: 'interval', minutes: 1 })).toThrow('SCHEDULE_ACTIVE');
    resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.state()).toMatchObject({ active: false, running: false });
    await vi.advanceTimersByTimeAsync(600000); expect(run).toHaveBeenCalledOnce();
  });
  it('stops on an uncertain result instead of retrying and supports daily scheduling', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 11, 7, 59));
    const run = vi.fn(async () => { throw new Error('SUBMISSION_UNKNOWN_REVIEW'); });
    const scheduler = createScheduler(run, vi.fn());
    scheduler.start({ mode: 'daily', hour: 8, minute: 0 }); await vi.advanceTimersByTimeAsync(60000);
    expect(scheduler.state()).toMatchObject({ active: false, running: false, error: 'SUBMISSION_UNKNOWN_REVIEW' });
    await vi.advanceTimersByTimeAsync(86400000); expect(run).toHaveBeenCalledOnce();
  });
});
