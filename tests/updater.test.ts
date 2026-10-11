import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  listeners: {} as Record<string, (...args: unknown[]) => void>,
  app: { isPackaged: true, getVersion: () => '0.3.0', quit: vi.fn() },
  updater: { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn(), on: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  exists: vi.fn(),
}));
vi.mock('electron', () => ({ app: fake.app, autoUpdater: fake.updater, dialog: fake.dialog }));
vi.mock('node:fs', () => ({ existsSync: fake.exists }));
import { createUpdater } from '../src/main/updater';
const platform = process.platform;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fake.listeners = {};
  Object.defineProperty(process, 'platform', { value: 'win32' });
  fake.app.isPackaged = true; fake.exists.mockReturnValue(true);
  fake.updater.on.mockImplementation((event: string, listener: (...args: unknown[]) => void) => { fake.listeners[event] = listener; });
  fake.updater.checkForUpdates.mockImplementation(() => {});
  fake.dialog.showMessageBox.mockResolvedValue({ response: 1 });
});
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }); vi.useRealTimers(); });
describe('installed Windows updater', () => {
  it('excludes portable, development and smoke builds', () => {
    fake.exists.mockReturnValue(false);
    expect(() => createUpdater(() => false).check(true)).toThrow('UPDATE_UNAVAILABLE');
    fake.exists.mockReturnValue(true); fake.app.isPackaged = false;
    expect(() => createUpdater(() => false).check()).toThrow('UPDATE_UNAVAILABLE');
    fake.app.isPackaged = true;
    expect(() => createUpdater(() => false, true).check()).toThrow('UPDATE_UNAVAILABLE');
    expect(fake.updater.setFeedURL).not.toHaveBeenCalled();
  });
  it('uses the public release feed and avoids overlapping downloads', () => {
    const update = createUpdater(() => false);
    expect(fake.updater.setFeedURL.mock.calls[0][0].url).toMatch(/https:\/\/update\.electronjs\.org\/justindeelux\/form-entry-desktop\/win32-\w+\/0\.3\.0/);
    update.start(); update.check(true);
    expect(fake.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    fake.listeners['error'](); update.check();
    expect(fake.updater.checkForUpdates).toHaveBeenCalledTimes(2);
    update.stop();
  });
  it('does not prompt or restart during a batch or active schedule', async () => {
    let busy = true;
    const update = createUpdater(() => busy);
    fake.listeners['update-downloaded']();
    expect(fake.dialog.showMessageBox).not.toHaveBeenCalled();
    busy = false; fake.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    update.check(); await vi.advanceTimersByTimeAsync(0);
    expect(fake.app.quit).toHaveBeenCalledOnce();
    expect(fake.updater.quitAndInstall).not.toHaveBeenCalled();
    update.finishQuit();
    expect(fake.updater.quitAndInstall).toHaveBeenCalledOnce();
  });
  it('rechecks busy state after the user accepts the update dialog', async () => {
    let busy = false;
    fake.dialog.showMessageBox.mockImplementation(async () => { busy = true; return { response: 0 }; });
    const update = createUpdater(() => busy);
    fake.listeners['update-downloaded'](); await Promise.resolve();
    expect(fake.app.quit).not.toHaveBeenCalled();
    update.finishQuit();
    expect(fake.updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it('handles synchronous update errors without crashing or restarting', () => {
    fake.updater.checkForUpdates.mockImplementation(() => { throw new Error('offline'); });
    const update = createUpdater(() => false);
    expect(() => update.check(true)).not.toThrow();
    expect(fake.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(fake.app.quit).not.toHaveBeenCalled();
  });
  it('respects Later and allows a manual prompt again', async () => {
    const update = createUpdater(() => false);
    fake.listeners['update-downloaded'](); await Promise.resolve();
    update.check(); await vi.advanceTimersByTimeAsync(0);
    expect(fake.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    update.check(true); await vi.advanceTimersByTimeAsync(0);
    expect(fake.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(fake.app.quit).not.toHaveBeenCalled();
  });
  it('defers first-run checks and cancels periodic checks on shutdown', async () => {
    process.argv.push('--squirrel-firstrun');
    try {
      const update = createUpdater(() => false);
      update.start();
      expect(fake.updater.checkForUpdates).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(fake.updater.checkForUpdates).toHaveBeenCalledOnce();
      update.stop(); fake.listeners['update-not-available']();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(fake.updater.checkForUpdates).toHaveBeenCalledOnce();
    } finally { process.argv.pop(); }
  });
});
