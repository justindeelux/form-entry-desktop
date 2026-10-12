import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
  listeners: {} as Record<string, (...args: unknown[]) => void>,
  app: { isPackaged: true, quit: vi.fn() },
  updater: { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(), on: vi.fn() },
  exists: vi.fn(),
}));
vi.mock('electron', () => ({ app: fake.app }));
vi.mock('electron-updater', () => ({ autoUpdater: fake.updater }));
vi.mock('node:fs', () => ({ existsSync: fake.exists }));
import { createUpdater } from '../src/main/updater';
const platform = process.platform;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fake.listeners = {};
  Object.defineProperty(process, 'platform', { value: 'win32' });
  fake.app.isPackaged = true; fake.exists.mockReturnValue(true);
  fake.updater.on.mockImplementation((event: string, listener: (...args: unknown[]) => void) => { fake.listeners[event] = listener; });
  fake.updater.checkForUpdates.mockResolvedValue(null);
  fake.updater.downloadUpdate.mockResolvedValue([]);
});
afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }); vi.useRealTimers(); });
describe('installed Windows updater', () => {
  it('checks without downloading and publishes the version changelog', () => {
    const changed = vi.fn();
    const update = createUpdater(() => false, false, changed);
    update.start(); update.check();
    expect(changed).toHaveBeenLastCalledWith({ status: 'checking' });
    expect(fake.updater.checkForUpdates).toHaveBeenCalledOnce();
    fake.listeners['update-available']({ version: '0.5.0', releaseNotes: '<p>New modal</p>' });
    expect(update.state()).toEqual({ status: 'available', version: '0.5.0', releaseNotes: '<p>New modal</p>' });
    expect(fake.updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false });
    expect(fake.updater.downloadUpdate).not.toHaveBeenCalled();
    expect(fake.app.quit).not.toHaveBeenCalled();
    const snapshot = update.state(); snapshot.status = 'error';
    expect(update.state().status).toBe('available');
    update.stop();
  });
  it('downloads only on explicit request and installs through safe shutdown', () => {
    const update = createUpdater(() => false);
    expect(() => update.apply()).toThrow('UPDATE_NOT_READY');
    fake.listeners['update-available']({ version: '0.5.0', releaseNotes: 'Changes' });
    update.apply();
    expect(fake.updater.downloadUpdate).toHaveBeenCalledOnce();
    expect(() => update.apply()).toThrow('UPDATE_NOT_READY');
    update.check(); expect(fake.updater.checkForUpdates).not.toHaveBeenCalled();
    fake.listeners['download-progress']({ percent: 37.5 });
    expect(update.state()).toEqual({ status: 'downloading', version: '0.5.0', releaseNotes: 'Changes', percent: 37.5 });
    fake.listeners['update-downloaded']({ version: '0.5.0' });
    expect(update.state().status).toBe('installing');
    expect(fake.app.quit).toHaveBeenCalledOnce();
    expect(fake.updater.quitAndInstall).not.toHaveBeenCalled();
    update.finishQuit();
    expect(fake.updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
  it('blocks install while busy and waits if work starts during download', async () => {
    let busy = true;
    const update = createUpdater(() => busy);
    fake.listeners['update-available']({ version: '0.5.0' });
    expect(() => update.apply()).toThrow('BUSY');
    expect(fake.updater.downloadUpdate).not.toHaveBeenCalled();
    busy = false; update.apply(); busy = true;
    fake.listeners['update-downloaded']({ version: '0.5.0' });
    expect(update.state().status).toBe('downloaded');
    expect(fake.app.quit).not.toHaveBeenCalled();
    busy = false; update.apply(); busy = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.app.quit).not.toHaveBeenCalled();
    busy = false; update.apply(); await vi.advanceTimersByTimeAsync(0);
    expect(fake.app.quit).toHaveBeenCalledOnce();
  });
  it('never installs a downloaded update on an ordinary quit', () => {
    let busy = false;
    const update = createUpdater(() => busy);
    fake.listeners['update-available']({ version: '0.5.0' }); update.apply(); busy = true;
    fake.listeners['update-downloaded']({ version: '0.5.0' });
    update.finishQuit();
    expect(fake.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(fake.app.quit).toHaveBeenCalledOnce();
  });
  it('handles missing and array changelogs', () => {
    const update = createUpdater(() => false);
    fake.listeners['update-available']({ version: '0.5.0', releaseNotes: [{ version: '0.5.0', note: '<p>Changes</p>' }, { version: '0.4.9', note: null }] });
    expect(update.state().releaseNotes).toBe('0.5.0\n<p>Changes</p>\n\n0.4.9\n');
    fake.listeners['update-available']({ version: '0.5.0' });
    expect(update.state().releaseNotes).toBeUndefined();
  });
  it('clears loading after errors and no-update responses and permits retry', async () => {
    const update = createUpdater(() => false);
    fake.updater.checkForUpdates.mockRejectedValue(new Error('offline'));
    update.check(); await Promise.resolve();
    expect(update.state().status).toBe('error');
    fake.updater.checkForUpdates.mockImplementation(() => { throw new Error('offline'); });
    expect(() => update.check()).not.toThrow();
    expect(update.state().status).toBe('error');
    fake.updater.checkForUpdates.mockResolvedValue(null);
    update.check(); fake.listeners['update-not-available']();
    expect(update.state()).toEqual({ status: 'not-available' });
    expect(fake.app.quit).not.toHaveBeenCalled();
  });
  it('allows a failed download to be checked and retried explicitly', async () => {
    const update = createUpdater(() => false);
    fake.listeners['update-available']({ version: '0.5.0' });
    fake.updater.downloadUpdate.mockRejectedValue(new Error('offline'));
    update.apply(); await Promise.resolve();
    expect(update.state().status).toBe('error');
    update.check(); fake.listeners['update-available']({ version: '0.5.0' });
    fake.updater.downloadUpdate.mockImplementation(() => { throw new Error('offline'); });
    expect(() => update.apply()).not.toThrow();
    expect(update.state().status).toBe('error');
    expect(fake.app.quit).not.toHaveBeenCalled();
  });
  it('bounds download percentages for the progress bar', () => {
    const update = createUpdater(() => true);
    for (const [input, expected] of [[-1, 0], [101, 100], [NaN, 0]]) {
      fake.listeners['download-progress']({ percent: input });
      expect(update.state().percent).toBe(expected);
    }
  });
  it('excludes portable, development and smoke builds', () => {
    fake.exists.mockReturnValue(false);
    expect(createUpdater(() => false).state()).toEqual({ status: 'unsupported' });
    expect(() => createUpdater(() => false).apply()).toThrow('UPDATE_UNAVAILABLE');
    fake.exists.mockReturnValue(true); fake.app.isPackaged = false;
    expect(() => createUpdater(() => false).check()).toThrow('UPDATE_UNAVAILABLE');
    fake.app.isPackaged = true;
    expect(() => createUpdater(() => false, true).check()).toThrow('UPDATE_UNAVAILABLE');
    expect(fake.updater.setFeedURL).not.toHaveBeenCalled();
  });
  it('checks at startup and cancels periodic checks on shutdown', async () => {
    const update = createUpdater(() => false);
    expect(fake.updater.setFeedURL).toHaveBeenCalledWith({ provider: 'github', owner: 'justindeelux', repo: 'form-entry-desktop' });
    update.start();
    expect(fake.updater.checkForUpdates).toHaveBeenCalledOnce();
    fake.listeners['update-not-available']();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fake.updater.checkForUpdates).toHaveBeenCalledTimes(2);
    update.stop(); fake.listeners['update-not-available']();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fake.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
