import { resolveOption } from './options';
import { FieldValidationError, validatePayload, type Aliases, type Defaults, type LoadedData, type Mapping, type Formatting, type Payload } from './contracts';

import { normalizeDate, normalizeDateTime } from './temporal';
export { normalizeDate, normalizeDateTime } from './temporal';

export function mapRow(data: LoadedData, values: string[], mapping: Mapping, defaults: Defaults = {}, now = new Date(), aliases: Aliases = {}, formatting: Formatting = {}): Payload {
  const payload: Payload = {};
  for (const fieldId of new Set([...Object.keys(mapping), ...Object.keys(defaults), ...Object.keys(formatting)])) {
    const columnId = mapping[fieldId];
    const field = data.form.fields.find(field => field.id === fieldId);
    const column = data.source.columns.find(column => column.id === columnId);
    if (!field) throw new Error('MAPPING_INVALID');
    if (columnId !== undefined && !column) throw new FieldValidationError(field, 'Cột đã nối không còn tồn tại; tải lại và nối lại cột.');
    const fallback = defaults[fieldId];
    if (typeof fallback === 'object' && !['date', 'datetime'].includes(field.type)) throw new FieldValidationError(field, 'Thời gian hiện tại chỉ dùng cho trường ngày hoặc ngày giờ.');
    let value = (column ? values[column.index] ?? '' : '').trim();
    if (!value) value = typeof fallback === 'object'
      ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}${field.type === 'datetime' ? `T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(field.timePrecision === 'second' ? now.getSeconds() : 0).padStart(2, '0')}` : ''}`
      : (fallback ?? '').trim();
    const format = formatting[fieldId];
    if ((format?.name || format?.phone) && !['text', 'paragraph'].includes(field.type)) throw new FieldValidationError(field, 'Làm đẹp tên/số điện thoại chỉ dùng cho trường văn bản.');
    if (format?.name) value = value.toLocaleLowerCase('vi-VN').replace(/(^|\s)(\p{L})/gu, (_match, space: string, letter: string) => space + letter.toLocaleUpperCase('vi-VN'));
    if (format?.phone && value && !value.startsWith('0')) value = `0${value}`;
    if (field.type === 'date') value = normalizeDate(value);
    if (field.type === 'datetime') value = normalizeDateTime(value);
    payload[fieldId] = field.type === 'checkbox' ? value.split(';').map(option => option.trim()).filter(Boolean).map(option => resolveOption(field, option, aliases[fieldId]))
      : ['radio', 'dropdown'].includes(field.type) && value ? resolveOption(field, value, aliases[fieldId]) : value;
  }
  validatePayload(data.form.fields, payload);
  return payload;
}
