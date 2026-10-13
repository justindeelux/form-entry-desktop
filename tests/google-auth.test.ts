import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createGoogleAuth, driveFileScope } from '../src/main/google-auth';
const directories: string[] = [];
afterEach(() => { directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
const config = { client_id: 'fixture.apps.googleusercontent.com', client_secret: 'fixture-secret' };
function setup(openExternal: (url: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'google-auth-')); directories.push(directory);
  const path = join(directory, 'token.enc');
  const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ access_token: 'access-fixture', refresh_token: 'refresh-fixture', expires_in: 3600, scope: driveFileScope })));
  const deps = { fetch: request, openExternal, available: () => true, encrypt: (text: string) => Buffer.from(text.split('').reverse().join('')), decrypt: (data: Buffer) => data.toString().split('').reverse().join('') };
  return { path, request, deps, auth: createGoogleAuth(config, path, deps) };
}
describe('desktop Google OAuth', () => {
  it('checks callback state, exchanges PKCE code, stores only an encrypted refresh token and refreshes after restart', async () => {
    let authorization!: URL;
    const fake = setup(async url => {
      authorization = new URL(url);
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({ state: 'forged', code: 'code', picked_file_ids: 'file-fixture' }).toString();
      expect((await fetch(callback)).status).toBe(400);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      expect((await fetch(callback)).status).toBe(200);
    });
    expect(await fake.auth.connect()).toBe('file-fixture');
    expect(authorization.searchParams.get('scope')).toBe(driveFileScope);
    expect(authorization.searchParams.get('trigger_onepick')).toBe('true');
    expect(authorization.searchParams.get('mimetypes')).toBe('application/vnd.google-apps.spreadsheet');
    const body = fake.request.mock.calls[0][1]!.body as URLSearchParams;
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'));
    expect(readFileSync(fake.path, 'utf8')).not.toContain('refresh-fixture');
    expect(readFileSync(fake.path, 'utf8')).not.toContain('access-fixture');
    expect(fake.auth.status()).toEqual({ configured: true, connected: true });
    expect(await fake.auth.accessToken()).toBe('access-fixture'); expect(fake.request).toHaveBeenCalledTimes(1);
    const restarted = createGoogleAuth(config, fake.path, fake.deps);
    expect(await restarted.accessToken()).toBe('access-fixture');
    expect((fake.request.mock.calls[1][1]!.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
    await restarted.disconnect(); expect(existsSync(fake.path)).toBe(false);
  });
  it('clears both stored and cached credentials locally even if no revocation request can run', async () => {
    const fake = setup(async () => {});
    writeFileSync(fake.path, fake.deps.encrypt(JSON.stringify({ clientId: config.client_id, refreshToken: 'refresh-fixture' })));
    writeFileSync(`${fake.path}.tmp`, 'unfinished token file');
    expect(await fake.auth.accessToken()).toBe('access-fixture');
    fake.auth.clearLocal();
    expect(fake.auth.status().connected).toBe(false);
    expect(existsSync(fake.path)).toBe(false); expect(existsSync(`${fake.path}.tmp`)).toBe(false);
    await expect(fake.auth.accessToken()).rejects.toThrow('GOOGLE_CONNECT_REQUIRED');
    expect(fake.request).toHaveBeenCalledTimes(1);
  });
  it('cancels without saving credentials or exchanging a code', async () => {
    const fake = setup(async () => { fake.auth.cancel(); });
    await expect(fake.auth.connect()).rejects.toThrow('GOOGLE_CONNECT_CANCELLED');
    expect(fake.request).not.toHaveBeenCalled(); expect(existsSync(fake.path)).toBe(false);
  });
  it('requires configuration and encrypted storage before opening the browser', async () => {
    const open = vi.fn(async () => {}), fake = setup(open);
    await expect(createGoogleAuth(undefined, fake.path, fake.deps).connect()).rejects.toThrow('GOOGLE_NOT_CONFIGURED');
    await expect(createGoogleAuth(config, fake.path, { ...fake.deps, available: () => false }).connect()).rejects.toThrow('GOOGLE_TOKEN_STORAGE_UNAVAILABLE');
    expect(open).not.toHaveBeenCalled();
  });
});
