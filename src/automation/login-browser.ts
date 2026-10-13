import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { BrowserContext } from 'playwright-core';

export async function requireGoogleSession(context: BrowserContext, required: boolean) {
  if (!required) return;
  const cookies = await context.cookies('https://accounts.google.com');
  if (!cookies.some(cookie => cookie.value && ['SID', '__Secure-1PSID', '__Secure-3PSID'].includes(cookie.name))) throw new Error('LOGIN_REQUIRED');
}

export function loginArguments(profilePath: string, url: string): string[] {
  // Sign-in runs without Playwright, remote debugging or automation flags.
  return [`--user-data-dir=${profilePath}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', url];
}

export async function openLoginBrowser(chromePath: string, profilePath: string, url: string): Promise<ChildProcess> {
  const child = spawn(chromePath, loginArguments(profilePath, url), { stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new Error('BROWSER_NOT_FOUND')));
  });
  return child;
}

export async function closeLoginBrowser(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('LOGIN_BROWSER_OPEN')), 10000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    // Quit only the owned Chrome gracefully so its session cookies reach disk.
    if (process.platform === 'darwin') {
      const script = `ObjC.import("AppKit"); let requested = false; for (let attempt = 0; attempt < 30 && !requested; attempt++) { try { requested = Boolean($.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid}).terminate); } catch (_) {} if (!requested) delay(0.1); }`;
      execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 8000 }, error => {
        if (error) { clearTimeout(timeout); reject(new Error('LOGIN_BROWSER_OPEN')); }
      });
    } else if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(child.pid)], { timeout: 8000 }, error => {
        if (error) { clearTimeout(timeout); reject(new Error('LOGIN_BROWSER_OPEN')); }
      });
    } else child.kill('SIGTERM');
  });
}
