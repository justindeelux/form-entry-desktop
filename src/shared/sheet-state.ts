import { z } from 'zod';
import { parseTemporal } from './temporal';
import { sheetColumnsSchema, sourceSchema, type SheetColumns, type Source } from './contracts';

export function validateSheetColumns(source: Source, columns: SheetColumns) {
  const selected = Object.values(columns).filter((value): value is string => !!value);
  if (!columns.result || !columns.sentAt || selected.length !== new Set(selected).size ||
      selected.some(id => !source.columns.some(column => column.id === id))) throw new Error('SHEET_MAPPING_INVALID');
  const repeats = [columns.repeat, columns.repeatDays, columns.repeated].filter(Boolean).length;
  if (repeats !== 0 && repeats !== 3) throw new Error('SHEET_MAPPING_INVALID');
}

export function sheetCell(source: Source, values: string[], id?: string): string {
  return id ? values[source.columns.find(column => column.id === id)?.index ?? -1]?.trim() ?? '' : '';
}

export function sheetStatus(source: Source, values: string[], columns: SheetColumns): 'sent' | 'unsent' {
  const value = sheetCell(source, values, columns.result);
  if (value === 'Đã gửi') return 'sent';
  if (!value || value === 'Chưa gửi') return 'unsent';
  throw new Error('SHEET_STATUS_INVALID');
}

export function sheetTimestamp(value: string): number | undefined {
  const parsed = parseTemporal(value);
  if (parsed) return new Date(`${parsed.date}T${parsed.time}`).getTime();
  // Unformatted date cells may be exported as spreadsheet serial numbers.
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) return;
  const serial = Number(value.replace(',', '.'));
  if (serial < 1 || serial > 2958465) return;
  const utc = new Date(Math.round((serial - 25569) * 86400000));
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds()).getTime();
}

function integer(value: string, minimum: number): number | undefined {
  if (!/^\d+$/.test(value)) return;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
}

export function repeatDue(source: Source, values: string[], columns: SheetColumns, now: Date): boolean {
  const repeat = sheetCell(source, values, columns.repeat), days = sheetCell(source, values, columns.repeatDays);
  if (!repeat || !days) return false;
  const limit = integer(repeat, 0), interval = integer(days, 1);
  const completed = repeatedCount(source, values, columns);
  if (limit === undefined || interval === undefined) throw new Error('SHEET_REPEAT_INVALID');
  if (completed >= limit) return false;
  const sentAt = sheetTimestamp(sheetCell(source, values, columns.sentAt));
  if (sentAt === undefined) throw new Error('SHEET_REPEAT_INVALID');
  const due = new Date(sentAt);
  due.setDate(due.getDate() + interval);
  if (!Number.isFinite(due.getTime())) throw new Error('SHEET_REPEAT_INVALID');
  return due.getTime() <= now.getTime();
}

export function repeatedCount(source: Source, values: string[], columns: SheetColumns): number {
  const value = sheetCell(source, values, columns.repeated);
  const count = value ? integer(value, 0) : 0;
  if (count === undefined) throw new Error('SHEET_REPEAT_INVALID');
  return count;
}

export function submissionUpdates(source: Source, values: string[], columns: SheetColumns, repeat: boolean, sentAt: Date): Record<string, string> {
  const parts = [sentAt.getFullYear(), sentAt.getMonth() + 1, sentAt.getDate()].map((part, index) => String(part).padStart(index ? 2 : 4, '0'));
  const time = [sentAt.getHours(), sentAt.getMinutes(), sentAt.getSeconds()].map(part => String(part).padStart(2, '0'));
  return {
    ...(columns.repeated ? { [columns.repeated]: String(repeat ? repeatedCount(source, values, columns) + 1 : 0) } : {}),
    [columns.sentAt!]: `${parts.join('-')}T${time.join(':')}`,
    [columns.result!]: 'Đã gửi',
  };
}

export const sheetWriteSchema = z.object({
  sheetsUrl: z.string().max(2000), source: sourceSchema, row: z.number().int().min(2).max(10001),
  sheetColumns: sheetColumnsSchema, updates: z.record(z.string(), z.string().max(100)),
}).strict();
export type SheetWrite = z.infer<typeof sheetWriteSchema>;

export function validateSheetWrite(input: SheetWrite) {
  validateSheetColumns(input.source, input.sheetColumns);
  if (!input.source.rows.some(row => row.number === input.row) || !Object.keys(input.updates).length) throw new Error('SHEET_ROW_CHANGED');
  const writable = [input.sheetColumns.result, input.sheetColumns.sentAt, input.sheetColumns.repeated];
  for (const [id, value] of Object.entries(input.updates)) {
    if (!writable.includes(id) || (id === input.sheetColumns.result && !['Đã gửi', 'Chưa gửi'].includes(value)) ||
        (id === input.sheetColumns.sentAt && value !== '' && !parseTemporal(value)) ||
        (id === input.sheetColumns.repeated && integer(value, 0) === undefined)) throw new Error('SHEET_WRITE_INVALID');
  }
}

export function sameSheetCell(actual: string, expected: string, datetime: boolean) {
  return datetime && expected !== '' ? sheetTimestamp(actual) === sheetTimestamp(expected) : actual.trim() === expected;
}

export function timestampFormula(value: string) {
  const parsed = parseTemporal(value);
  if (!parsed) throw new Error('SHEET_WRITE_INVALID');
  const [year, month, day] = parsed.date.split('-').map(Number);
  const [hour, minute, second] = parsed.time.split(':').map(Number);
  // Integer arithmetic works in Sheets locales with either decimal separator.
  return `=${Math.round(Date.UTC(year, month - 1, day) / 86400000) + 25569}+${hour * 3600 + minute * 60 + second}/86400`;
}
