import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: null) => void) => { callback(null); queueMicrotask(() => current?.emit('exit', 0)); }),
}));
let current: EventEmitter | undefined;
import { execFile } from 'node:child_process';
import { closeLoginBrowser, loginArguments } from '../src/automation/login-browser';

describe('manual Google sign-in', () => {
  it('opens the app-owned profile without automation or remote debugging flags', () => {
    const args = loginArguments('/tmp/profile with spaces', 'https://accounts.google.com/ServiceLogin');
    expect(args).toContain('--user-data-dir=/tmp/profile with spaces');
    expect(args.at(-1)).toBe('https://accounts.google.com/ServiceLogin');
    expect(args.some(arg => /automation|remote-debugging|AutomationControlled/.test(arg))).toBe(false);
  });
  it('waits for the owned login browser to exit before opening automation', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true; }) });
    current = child;
    await closeLoginBrowser(child as unknown as ChildProcess);
    if (process.platform === 'darwin' || process.platform === 'win32') expect(execFile).toHaveBeenCalled();
    else expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
  it('does not signal a browser that already exited', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null, kill: vi.fn() });
    await closeLoginBrowser(child as unknown as ChildProcess);
    expect(child.kill).not.toHaveBeenCalled();
    await expect(closeLoginBrowser(undefined)).resolves.toBeUndefined();
  });
});
