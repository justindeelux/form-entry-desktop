import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { sourceFromCsv } from '../src/sources/sheets';
import { writeSheetRow } from '../src/sources/google-sheets';
import { submissionUpdates } from '../src/shared/sheet-state';

afterEach(() => vi.restoreAllMocks());
const url = 'https://docs.google.com/spreadsheets/d/fixture/edit?gid=5';
const source = sourceFromCsv('Name,Times,Days,Count,State,Time\nÁnh,2,1,,Chưa gửi,');
const columns = { repeat: 'column-1', repeatDays: 'column-2', repeated: 'column-3', result: 'column-4', sentAt: 'column-5' };
const updates = submissionUpdates(source, source.rows[0].values, columns, false, new Date(2026, 9, 13, 14, 30, 42));
const request = { sheetsUrl: url, source, row: 2, sheetColumns: columns, updates };
function browser(readOnly = false, editorUrl = url) {
  let stored = structuredClone(source), clipboard = 'Previous clipboard', selected = '', clock = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const nameBox = { first() { return this; }, waitFor: vi.fn(async () => {}), fill: vi.fn(async (value: string) => { selected = value; }), press: vi.fn() };
  const keyboard = { press: vi.fn(async (key: string) => {
    if (readOnly) return;
    const index = selected.charCodeAt(0) - 65;
    if (key === 'Backspace') stored.rows[0].values[index] = '';
    if (key.endsWith('+V')) {
      const formula = clipboard.match(/^=(\d+)\+(\d+)\/86400$/);
      stored.rows[0].values[index] = formula ? String(Number(formula[1]) + Number(formula[2]) / 86400) : clipboard;
    }
  }) };
  const context = { grantPermissions: vi.fn(async () => {}), clearPermissions: vi.fn(async () => {}) } as unknown as BrowserContext;
  const page = { goto: vi.fn(), url: () => editorUrl, bringToFront: vi.fn(), locator: () => nameBox, keyboard,
    waitForURL: vi.fn(async predicate => { if (!predicate(new URL(editorUrl))) throw new Error('TIMEOUT'); }),
    evaluateHandle: vi.fn(async () => ({ saved: clipboard, dispose: async () => {} })),
    evaluate: vi.fn(async (_callback, value?: string | { saved: string }) => { if (value === undefined) return clipboard; clipboard = typeof value === 'string' ? value : value.saved; }),
    waitForTimeout: vi.fn(async (milliseconds: number) => { clock += milliseconds; }),
  } as unknown as Page;
  return { context, page, read: async () => structuredClone(stored), clipboard: () => clipboard, setStored: (value: typeof source) => { stored = value; }, nameBox };
}

describe('verified writes through the existing Google browser session', () => {
  it('accepts an account-specific editor URL and the active tab in the fragment', async () => {
    const fake = browser(false, 'https://docs.google.com/spreadsheets/u/0/d/fixture/edit?gid=0#gid=5');
    const written = await writeSheetRow(fake.context, fake.page, request, fake.read);
    expect(written.rows[0].values[4]).toBe('Đã gửi');
    expect(fake.page.goto).toHaveBeenCalledWith(`${url}#gid=5`, expect.anything());
  });
  it('refuses a different file or active tab before touching the grid', async () => {
    for (const editorUrl of ['https://docs.google.com/spreadsheets/d/other/edit#gid=5', `${url}#gid=0`]) {
      const fake = browser(false, editorUrl);
      await expect(writeSheetRow(fake.context, fake.page, request, fake.read)).rejects.toThrow('SHEETS_TAB_CHANGED');
      expect(fake.page.keyboard.press).not.toHaveBeenCalled();
      expect(fake.context.grantPermissions).not.toHaveBeenCalled();
    }
  });
  it('reports an unavailable editor separately from export permission failures', async () => {
    const fake = browser(); fake.nameBox.waitFor.mockRejectedValue(new Error('TIMEOUT'));
    await expect(writeSheetRow(fake.context, fake.page, request, fake.read)).rejects.toThrow('SHEETS_EDITOR_UNAVAILABLE');
    expect(fake.page.keyboard.press).not.toHaveBeenCalled();
  });
  it('writes only the mapped cells, keeps other data intact, and restores the clipboard/permissions', async () => {
    const fake = browser();
    const written = await writeSheetRow(fake.context, fake.page, request, fake.read);
    expect(written.rows[0].values.slice(0, 3)).toEqual(source.rows[0].values.slice(0, 3));
    expect(written.rows[0].values[3]).toBe('0'); expect(written.rows[0].values[4]).toBe('Đã gửi');
    expect(fake.nameBox.fill.mock.calls.map(args => args[0])).toEqual(['D2', 'F2', 'E2']);
    expect(fake.clipboard()).toBe('Previous clipboard');
    expect(fake.context.clearPermissions).toHaveBeenCalledOnce();
  });
  it('stops on denied writes and restores browser permissions even on failure', async () => {
    const fake = browser(true);
    await expect(writeSheetRow(fake.context, fake.page, request, fake.read)).rejects.toThrow('SHEETS_WRITE_FAILED');
    expect((await fake.read()).rows[0].values).toEqual(source.rows[0].values);
    expect(fake.clipboard()).toBe('Previous clipboard'); expect(fake.context.clearPermissions).toHaveBeenCalledOnce();
  });
  it('does not touch the grid if the row changed after preparation', async () => {
    const fake = browser();
    const changed = structuredClone(source); changed.rows[0].values[0] = 'Bình'; fake.setStored(changed);
    await expect(writeSheetRow(fake.context, fake.page, request, fake.read)).rejects.toThrow('SHEET_ROW_CHANGED');
    expect(fake.page.goto).not.toHaveBeenCalled(); expect(fake.page.keyboard.press).not.toHaveBeenCalled();
  });
});
