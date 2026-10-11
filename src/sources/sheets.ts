import type { Source } from '../shared/contracts';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
      continue;
    }
    if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (char !== ',') {
        rows.push(row); row = [];
        if (char === '\r' && text[index + 1] === '\n') index++;
      }
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === '"' || closed) throw new Error('SHEETS_DATA_INVALID');
    else cell += char;
  }
  if (quoted) throw new Error('SHEETS_DATA_INVALID');
  if (row.length || cell || closed) { row.push(cell); rows.push(row); }
  return rows;
}

export function sourceFromCsv(text: string, startRow = 1, allowEmpty = false): Source {
  const records = parseCsv(text);
  const headers = records.shift();
  if (!headers?.length) throw new Error('SHEETS_EMPTY');
  if (headers.length > 200 || headers.some(value => value.length > 10000) || records.length > 10000 || records.some(row => row.length > headers.length || row.some(value => value.length > 10000))) throw new Error('SHEETS_TOO_LARGE');
  const rows = records.map((values, index) => ({ number: index + 2, values: headers.map((_, column) => values[column] ?? '') }))
    .filter(row => row.number >= startRow && row.values.some(value => value.trim()));
  if (!rows.length && !allowEmpty) throw new Error('SHEETS_EMPTY');
  return { columns: headers.map((label, index) => ({ id: `column-${index}`, index, label: label.trim() || `Cột ${index + 1}`, sample: rows[0]?.values[index] ?? '' })), rows };
}
