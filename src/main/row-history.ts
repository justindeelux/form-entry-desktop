import { createHash } from 'node:crypto';
import type { SheetColumns, Source } from '../shared/contracts';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const historyScope = (sourceUrl: string, formUrl: string) => hash([sourceUrl, formUrl]);
export function sheetRows(source: Source, columns: SheetColumns) {
  return [...source.rows].sort((a, b) => b.number - a.number).map(row => ({ ...row,
    id: hash([row.number, source.columns.map(column => [column.index, column.label]),
      source.columns.filter(column => !Object.values(columns).includes(column.id)).map(column => row.values[column.index] ?? '')]),
  }));
}
