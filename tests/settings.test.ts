import { describe, expect, it } from 'vitest';
import { mappingBinding, readSettings, restoreSheetColumns, restoreAliases, restoreFormatting, restoreDefaults, restoreMapping, saveSettings } from '../src/renderer/settings';
import { sourceFromCsv } from '../src/sources/sheets';
import type { LoadedData } from '../src/shared/contracts';
const data: LoadedData = { source: sourceFromCsv('Tên\nÁnh'), form: { fingerprint: 'schema-1', fields: [{ id: 'q-0', index: 0, title: 'Tên', type: 'text', required: true, options: [] }] } };
const settings = { sheetsUrl: 'https://docs.google.com/spreadsheets/d/abc/edit#gid=0', formUrl: 'https://docs.google.com/forms/d/e/abc/viewform', requireLogin: false, sheetColumns: {}, formatting: {}, aliases: {}, defaults: { 'q-0': 'Mặc định' }, mapping: { 'q-0': 'column-0' } };
function storage() {
  let text: string | null = null;
  return { getItem: () => text, setItem: (_key: string, value: string) => { text = value; } };
}
describe('immediate local settings', () => {
  it('starts with login unchecked and empty URLs/mapping', () => {
    expect(readSettings(storage()).settings).toEqual({ sheetsUrl: '', formUrl: '', requireLogin: false, sheetColumns: {}, formatting: {}, aliases: {}, defaults: {}, mapping: {} });
  });
  it('saves each change synchronously and restores URLs, login and mapping', () => {
    const store = storage();
    const saved = { ...settings, requireLogin: true, startRow: 101, binding: mappingBinding(data, settings) };
    saveSettings(store, saved);
    expect(readSettings(store).settings).toEqual(saved);
    expect(restoreMapping(readSettings(store).settings, data)).toEqual(saved.mapping);
    expect(restoreDefaults(readSettings(store).settings, data)).toEqual(saved.defaults);
    expect(restoreDefaults(saved, { ...data, form: { ...data.form, fingerprint: "changed" } })).toEqual({});
    saveSettings(store, { ...saved, sheetsUrl: 'unfinished URL', mapping: {} });
    expect(readSettings(store).settings.sheetsUrl).toBe('unfinished URL');
    expect(readSettings(store).settings.mapping).toEqual({});
    expect(store.getItem()).not.toContain('Ánh');
  });
  it('does not rebind saved connections to a different tab, header order or Form schema', () => {
    const saved = { ...settings, binding: mappingBinding(data, settings) };
    expect(restoreMapping({ ...saved, sheetsUrl: settings.sheetsUrl.replace('gid=0', 'gid=1') }, data)).toEqual({});
    expect(restoreMapping(saved, { ...data, source: sourceFromCsv('Khác\nÁnh') })).toEqual({});
    expect(restoreMapping(saved, { ...data, form: { ...data.form, fingerprint: 'schema-2' } })).toEqual({});
    expect(restoreMapping({ ...saved, sheetsUrl: settings.sheetsUrl.replace('#gid=0', '?gid=0') }, data)).toEqual(saved.mapping);
  });
  it('persists a dynamic current-date default without freezing it to a date string', () => {
    const store = storage();
    const saved = { ...settings, defaults: { date: { currentDate: true as const } } };
    saveSettings(store, saved);
    expect(readSettings(store).settings.defaults).toEqual(saved.defaults);
  });
  it('persists aliases and restores only for matching binding and existing options', () => {
    const choices = { ...data, form: { ...data.form, fields: [{ ...data.form.fields[0], type: 'dropdown' as const, options: ['Hồ Chí Minh'] }] } };
    const saved = { ...settings, binding: mappingBinding(choices, settings), aliases: { 'q-0': [{ source: 'TP.HCM', option: 'Hồ Chí Minh' }] } };
    const store = storage(); saveSettings(store, saved);
    expect(restoreAliases(readSettings(store).settings, choices)).toEqual(saved.aliases);
    expect(restoreAliases(saved, { ...choices, form: { ...choices.form, fingerprint: 'new' } })).toEqual({});
    expect(restoreAliases(saved, { ...choices, form: { ...choices.form, fields: [] } })).toEqual({ 'q-0': [] });
    const { aliases, ...older } = settings;
    expect(readSettings({ getItem: () => JSON.stringify(older) }).settings.aliases).toEqual({});
  });
  it('persists formatting immediately and restores it only for compatible fields and binding', () => {
    const store = storage();
    const saved = { ...settings, formatting: { 'q-0': { name: true }, stale: { phone: true } }, binding: mappingBinding(data, settings) };
    saveSettings(store, saved);
    expect(readSettings(store).settings.formatting).toEqual(saved.formatting);
    expect(restoreFormatting(readSettings(store).settings, data)).toEqual({ 'q-0': { name: true } });
    expect(restoreFormatting(saved, { ...data, form: { ...data.form, fingerprint: 'changed' } })).toEqual({});
    expect(restoreFormatting(saved, { ...data, form: { ...data.form, fields: [{ ...data.form.fields[0], type: 'date' }] } })).toEqual({});
    const { formatting, ...older } = settings;
    expect(readSettings({ getItem: () => JSON.stringify(older) }).settings.formatting).toEqual({});
  });
  it('reads older settings with no defaults', () => {
    const { defaults, ...older } = settings;
    expect(readSettings({ getItem: () => JSON.stringify(older) }).settings.defaults).toEqual({});
  });
  it('restores explicitly selected Sheets controls only with the same binding, never from header names', () => {
    const sheet = { ...data, source: sourceFromCsv('Kết quả,Gửi lúc\nChưa gửi,') };
    const saved = { ...settings, sheetColumns: { result: 'column-0', sentAt: 'column-1' }, binding: mappingBinding(sheet, settings) };
    expect(restoreSheetColumns(saved, sheet)).toEqual(saved.sheetColumns);
    expect(restoreSheetColumns({ ...saved, binding: undefined }, sheet)).toEqual({});
    expect(restoreSheetColumns({ ...saved, sheetColumns: {} }, sheet)).toEqual({});
    expect(restoreSheetColumns(saved, { ...sheet, source: sourceFromCsv('Gửi lúc,Kết quả\n,Chưa gửi') })).toEqual({});
  });
  it('reports corrupt/unavailable storage and does not pretend a failed save succeeded', () => {
    expect(readSettings({ getItem: () => 'invalid json' }).error).toBeDefined();
    expect(readSettings({ getItem: () => { throw new Error('denied'); } }).error).toBeDefined();
    expect(() => saveSettings({ setItem: () => { throw new Error('quota'); } }, settings)).toThrow('quota');
  });
});
