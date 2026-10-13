import { z } from 'zod';
import { type Aliases, aliasesSchema, formattingSchema, defaultsSchema, mappingSchema, sheetColumnsSchema, parseFormUrl, parseSheetsUrl, type LoadedData } from '../shared/contracts';

export const settingsSchema = z.object({
  sheetsUrl: z.string().max(2000), formUrl: z.string().max(2000), requireLogin: z.boolean(), startRow: z.number().int().min(1).max(10001).optional(),
  aliases: aliasesSchema.default({}), formatting: formattingSchema.default({}), mapping: mappingSchema, defaults: defaultsSchema.default({}), binding: z.string().optional(),
  sheetColumns: sheetColumnsSchema.default({}),
});
export type Settings = z.infer<typeof settingsSchema>;
const defaults: Settings = { sheetsUrl: '', formUrl: '', requireLogin: false, mapping: {}, defaults: {}, aliases: {}, formatting: {}, sheetColumns: {} };
const key = 'form-entry-settings-v1';
export function readSettings(storage: Pick<Storage, 'getItem'>): { settings: Settings; error?: string } {
  try {
    const saved = storage.getItem(key);
    return { settings: saved ? settingsSchema.parse(JSON.parse(saved)) : defaults };
  } catch { return { settings: defaults, error: 'Không đọc được cấu hình đã lưu. Hãy nhập lại URL và các kết nối.' }; }
}
export function saveSettings(storage: Pick<Storage, 'setItem'>, settings: Settings) {
  storage.setItem(key, JSON.stringify(settingsSchema.parse(settings)));
}
export function mappingBinding(data: LoadedData, settings: Pick<Settings, 'sheetsUrl' | 'formUrl'>): string {
  return JSON.stringify([parseSheetsUrl(settings.sheetsUrl.trim()).url, parseFormUrl(settings.formUrl.trim()),
    data.source.columns.map(({ id, label, index }) => [id, label, index]), data.form.fingerprint]);
}
export function restoreMapping(settings: Settings, data: LoadedData) {
  if (settings.binding !== mappingBinding(data, settings)) return {};
  return Object.fromEntries(Object.entries(settings.mapping).filter(([field, column]) =>
    data.form.fields.some(item => item.id === field) && data.source.columns.some(item => item.id === column)));
}

export function restoreDefaults(settings: Settings, data: LoadedData) {
  if (settings.binding !== mappingBinding(data, settings)) return {};
  return Object.fromEntries(Object.entries(settings.defaults).filter(([field]) => data.form.fields.some(item => item.id === field)));
}

export function restoreAliases(settings: Settings, data: LoadedData): Aliases {
  if (settings.binding !== mappingBinding(data, settings)) return {};
  return Object.fromEntries(Object.entries(settings.aliases).map(([id, entries]) => [id,
    entries.filter(entry => data.form.fields.some(field => field.id === id && field.options.includes(entry.option)))
  ]));
}

export function restoreFormatting(settings: Settings, data: LoadedData) {
  if (settings.binding !== mappingBinding(data, settings)) return {};
  return Object.fromEntries(Object.entries(settings.formatting).filter(([id]) => data.form.fields.some(field => field.id === id && ['text', 'paragraph'].includes(field.type))));
}

export function restoreSheetColumns(settings: Settings, data: LoadedData) {
  if (settings.binding !== mappingBinding(data, settings)) return {};
  return Object.fromEntries(Object.entries(settings.sheetColumns).filter(([, id]) => data.source.columns.some(column => column.id === id)));
}
