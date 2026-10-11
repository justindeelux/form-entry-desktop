import { createHash } from 'node:crypto';
import type { Source } from '../shared/contracts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const historyScope = (sourceUrl: string, formUrl: string) => hash([sourceUrl, formUrl]);
export function sheetRowId(source: Source, values: string[]) {
  return hash([source.columns.map(column => [column.index, column.label]), source.columns.map(column => values[column.index] ?? '')]);
}
export function uniqueSheetRows(source: Source) {
  const seen = new Set<string>();
  return [...source.rows].sort((a, b) => b.number - a.number).flatMap(row => {
    const id = sheetRowId(source, row.values);
    if (seen.has(id)) return [];
    seen.add(id); return [{ ...row, id }];
  });
}
