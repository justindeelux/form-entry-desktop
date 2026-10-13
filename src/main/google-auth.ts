import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { z } from 'zod';
import type { GoogleConnection } from '../shared/contracts';

export const driveFileScope = 'https://www.googleapis.com/auth/drive.file';
const configSchema = z.object({ client_id: z.string().regex(/^[\w.-]+\.apps\.googleusercontent\.com$/), client_secret: z.string().min(1) });
const tokenSchema = z.object({ clientId: z.string(), refreshToken: z.string().min(1) });
const tokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().positive(), refresh_token: z.string().min(1).optional(), scope: z.string().optional() });
export type GoogleConfig = z.infer<typeof configSchema>;
export function readGoogleConfig(path: string): GoogleConfig | undefined {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (id || secret) { try { return configSchema.parse({ client_id: id, client_secret: secret }); } catch { throw new Error('GOOGLE_CONFIG_INVALID'); } }
  if (!existsSync(path)) return;
  try { const json = JSON.parse(readFileSync(path, 'utf8')); return configSchema.parse(json.installed ?? json); }
  catch { throw new Error('GOOGLE_CONFIG_INVALID'); }
}

type Dependencies = {
  openExternal(url: string): Promise<void>;
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
  fetch: typeof fetch;
};
export function createGoogleAuth(config: GoogleConfig | undefined, path: string, deps: Dependencies) {
  let access: { token: string; expiresAt: number } | undefined;
  let cancel: (() => void) | undefined;
  function stored() {
    if (!existsSync(path)) return;
    if (!deps.available()) throw new Error('GOOGLE_TOKEN_STORAGE_UNAVAILABLE');
    try {
      const token = tokenSchema.parse(JSON.parse(deps.decrypt(readFileSync(path))));
      return token.clientId === config?.client_id ? token : undefined;
    } catch { throw new Error('GOOGLE_RECONNECT_REQUIRED'); }
  }
  const status = (): GoogleConnection => ({ configured: !!config, connected: !!stored() });
  async function exchange(parameters: Record<string, string>, signal?: AbortSignal) {
    if (!config) throw new Error('GOOGLE_NOT_CONFIGURED');
    let response: Response;
    try {
      response = await deps.fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        body: new URLSearchParams({ client_id: config.client_id, client_secret: config.client_secret, ...parameters }) });
    } catch { throw new Error(signal?.aborted ? 'GOOGLE_CONNECT_CANCELLED' : 'GOOGLE_CONNECTION_FAILED'); }
    if (!response.ok) throw new Error(response.status === 400 ? 'GOOGLE_RECONNECT_REQUIRED' : 'GOOGLE_CONNECTION_FAILED');
    const token = tokenResponse.parse(await response.json());
    if (token.scope && token.scope.split(' ').some(scope => scope !== driveFileScope)) throw new Error('GOOGLE_SCOPE_INVALID');
    return token;
  }
  async function accessToken() {
    if (access && access.expiresAt > Date.now() + 60000) return access.token;
    const token = stored(); if (!token) throw new Error('GOOGLE_CONNECT_REQUIRED');
    const fresh = await exchange({ grant_type: 'refresh_token', refresh_token: token.refreshToken });
    access = { token: fresh.access_token, expiresAt: Date.now() + fresh.expires_in * 1000 };
    return access.token;
  }
  async function connect(): Promise<string> {
    if (!config) throw new Error('GOOGLE_NOT_CONFIGURED');
    if (!deps.available()) throw new Error('GOOGLE_TOKEN_STORAGE_UNAVAILABLE');
    if (cancel) throw new Error('BUSY');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    let resolve!: (url: URL) => void, reject!: (error: Error) => void;
    const callback = new Promise<URL>((done, fail) => { resolve = done; reject = fail; });
    // Attach a handler before opening the browser, including early cancellation.
    void callback.catch(() => {});
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Content-Type-Options', 'nosniff');
      if (request.method !== 'GET' || request.headers.host !== address.host || url.pathname !== '/oauth/callback' || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
        response.writeHead(400); response.end('Yêu cầu không hợp lệ.'); return;
      }
      response.end('Đã nhận kết quả. Bạn có thể đóng tab và quay lại ứng dụng.'); resolve(url);
    });
    let address: URL;
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); done(); }); });
    address = new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}/oauth/callback`);
    const controller = new AbortController();
    cancel = () => { controller.abort(); reject(new Error('GOOGLE_CONNECT_CANCELLED')); };
    const timer = setTimeout(() => reject(new Error('GOOGLE_CONNECT_TIMEOUT')), 300000);
    try {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: config.client_id, redirect_uri: address.href, response_type: 'code', access_type: 'offline',
        scope: driveFileScope, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
        prompt: 'consent', trigger_onepick: 'true', mimetypes: 'application/vnd.google-apps.spreadsheet', allow_multiple: 'false' }).toString();
      await deps.openExternal(url.href);
      const returned = await callback;
      if (returned.searchParams.has('error')) throw new Error('GOOGLE_CONNECT_CANCELLED');
      const code = returned.searchParams.get('code'), file = returned.searchParams.get('picked_file_ids');
      if (!code || !file || !/^[\w-]+$/.test(file)) throw new Error('GOOGLE_PICK_FAILED');
      const token = await exchange({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: address.href }, controller.signal);
      if (controller.signal.aborted) throw new Error('GOOGLE_CONNECT_CANCELLED');
      if (!token.refresh_token) throw new Error('GOOGLE_RECONNECT_REQUIRED');
      const encrypted = deps.encrypt(JSON.stringify({ clientId: config.client_id, refreshToken: token.refresh_token }));
      writeFileSync(`${path}.tmp`, encrypted, { mode: 0o600 }); renameSync(`${path}.tmp`, path);
      access = { token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
      return file;
    } finally { clearTimeout(timer); cancel = undefined; server.closeAllConnections(); server.close(); }
  }
  async function disconnect() {
    const token = stored();
    if (token) {
      let response: Response;
      try { response = await deps.fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: token.refreshToken }), redirect: 'error', signal: AbortSignal.timeout(15000) }); }
      catch { throw new Error('GOOGLE_CONNECTION_FAILED'); }
      if (!response.ok && response.status !== 400) throw new Error('GOOGLE_CONNECTION_FAILED');
    }
    rmSync(path, { force: true }); access = undefined;
  }
  return { status, connect, disconnect, accessToken, invalidate: () => { access = undefined; }, cancel: () => cancel?.() };
}
