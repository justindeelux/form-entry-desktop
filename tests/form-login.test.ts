import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import { requireGoogleSession } from '../src/automation/login-browser';

describe('Google Form login requirement in the private Chrome profile', () => {
  it('requires login for a cleared profile even though Sheets OAuth is connected separately', async () => {
    const cookies = vi.fn(async () => []);
    await expect(requireGoogleSession({ cookies } as unknown as BrowserContext, true)).rejects.toThrow('LOGIN_REQUIRED');
    expect(cookies).toHaveBeenCalledWith('https://accounts.google.com');
  });
  it('reuses an existing Google session and ignores cookies that do not identify a session', async () => {
    for (const name of ['SID', '__Secure-1PSID', '__Secure-3PSID']) {
      await expect(requireGoogleSession({ cookies: async () => [{ name, value: 'fixture' }] } as unknown as BrowserContext, true)).resolves.toBeUndefined();
    }
    for (const cookies of [[{ name: 'NID', value: 'fixture' }], [{ name: 'SID', value: '' }]]) {
      await expect(requireGoogleSession({ cookies: async () => cookies } as unknown as BrowserContext, true)).rejects.toThrow('LOGIN_REQUIRED');
    }
  });
  it('does not force Google login for a public Form when the option is off', async () => {
    const cookies = vi.fn();
    await expect(requireGoogleSession({ cookies } as unknown as BrowserContext, false)).resolves.toBeUndefined();
    expect(cookies).not.toHaveBeenCalled();
  });
});
