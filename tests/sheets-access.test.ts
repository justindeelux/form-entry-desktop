import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { loadSheets } from '../src/sources/google-sheets';

const url = 'https://docs.google.com/spreadsheets/d/abc/edit?gid=5';
function setup(signedIn: boolean, responses: { status: number; headers?: Record<string, string>; body?: string }[]) {
  const get = vi.fn(async () => {
    const data = responses.shift(); if (!data) throw new Error('UNEXPECTED_REQUEST');
    return { status: () => data.status, ok: () => data.status === 200, headers: () => data.headers ?? {}, body: async () => Buffer.from(data.body ?? ''), dispose: async () => {} };
  });
  const context = { request: { get }, cookies: vi.fn(async () => signedIn ? [{ name: 'SID', value: 'fixture-only' }] : []) } as unknown as BrowserContext;
  const page = { goto: vi.fn(), url: () => signedIn ? url : 'https://accounts.google.com/signin', bringToFront: vi.fn() } as unknown as Page;
  return { context, page, get };
}
describe('Sheets browser session access', () => {
  it('reads public data without checking login when the option is off', async () => {
    const fake = setup(false, [{ status: 200, body: 'Tên\nÁnh' }]);
    expect((await loadSheets(fake.context, fake.page, url)).rows).toHaveLength(1);
    expect(fake.context.cookies).not.toHaveBeenCalled();
    expect(fake.page.goto).not.toHaveBeenCalled();
  });
  it('asks for login before reading/exporting data', async () => {
    const fake = setup(false, []);
    await expect(loadSheets(fake.context, fake.page, url, true)).rejects.toThrow('LOGIN_REQUIRED');
    expect(fake.get).not.toHaveBeenCalled();
    expect(fake.page.goto).not.toHaveBeenCalled();
  });
  it('uses the existing browser request context and selected tab', async () => {
    const fake = setup(true, [{ status: 200, headers: { 'content-type': 'text/csv' }, body: 'Tên\nÁnh' }]);
    const source = await loadSheets(fake.context, fake.page, url, true);
    expect(source.rows[0].values).toEqual(['Ánh']);
    expect(fake.page.goto).toHaveBeenCalledWith(url, expect.anything());
    expect(fake.get).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=5', expect.objectContaining({ maxRedirects: 0 }));
  });
  it('accepts Google export redirects and blocks login or unrelated redirects', async () => {
    const allowed = setup(true, [{ status: 302, headers: { location: 'https://doc-abc.googleusercontent.com/export' } }, { status: 200, body: 'Tên\nÁnh' }]);
    expect((await loadSheets(allowed.context, allowed.page, url, true)).rows).toHaveLength(1);
    for (const [location, error] of [['https://evil.test/export', 'SHEETS_ACCESS_DENIED'], ['http://docs.google.com/export', 'SHEETS_ACCESS_DENIED'], ['https://accounts.google.com/signin', 'LOGIN_REQUIRED']]) {
      const fake = setup(true, [{ status: 302, headers: { location } }]);
      await expect(loadSheets(fake.context, fake.page, url, true)).rejects.toThrow(error);
      expect(fake.get).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects permission pages and oversized responses', async () => {
    for (const response of [{ status: 403 }, { status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>Permission</h1>' }]) {
      const fake = setup(true, [response]);
      await expect(loadSheets(fake.context, fake.page, url, true)).rejects.toThrow('SHEETS_ACCESS_DENIED');
    }
    const fake = setup(true, [{ status: 200, headers: { 'content-length': '10485761' } }]);
    await expect(loadSheets(fake.context, fake.page, url, true)).rejects.toThrow('SHEETS_TOO_LARGE');
  });
});
