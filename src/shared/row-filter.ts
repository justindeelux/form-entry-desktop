const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
export function matchesRow(values: string[], search: string, column?: number): boolean {
  const query = normalize(search.trim());
  return !query || (column === undefined ? values : [values[column] ?? '']).some(value => normalize(value).includes(query));
}
