import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { UpdateState } from '../shared/contracts';

export function createUpdater(isBusy: () => boolean, smoke = false, onChange: (state: UpdateState) => void = () => {}) {
  const supported = process.platform === 'win32' && app.isPackaged && !smoke && existsSync(resolve(dirname(process.execPath), 'Uninstall FormEntryDesktop.exe'));
  let install = false, requested = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: UpdateState = { status: supported ? 'idle' : 'unsupported' };
  function publish(next: UpdateState) { state = next; onChange({ ...state }); }
  function restart() {
    if (!requested || isBusy()) return;
    install = true;
    publish({ ...state, status: 'installing' });
    app.quit();
  }
  function failed() { requested = false; publish({ ...state, status: 'error' }); }
  function check() {
    if (!supported) throw new Error('UPDATE_UNAVAILABLE');
    if (['checking', 'downloading', 'downloaded', 'installing'].includes(state.status)) return;
    publish({ status: 'checking' });
    try { void autoUpdater.checkForUpdates().catch(failed); }
    catch { failed(); }
  }
  function apply() {
    if (!supported) throw new Error('UPDATE_UNAVAILABLE');
    if (isBusy()) throw new Error('BUSY');
    if (state.status === 'downloaded') { requested = true; setImmediate(restart); return; }
    if (state.status !== 'available') throw new Error('UPDATE_NOT_READY');
    requested = true;
    publish({ ...state, status: 'downloading', percent: 0 });
    try { void autoUpdater.downloadUpdate().catch(failed); }
    catch { failed(); }
  }
  if (supported) {
    const { repository } = require('../../package.json');
    const [owner, repo] = new URL(repository.url).pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.setFeedURL({ provider: 'github', owner, repo });
    autoUpdater.on('error', failed);
    autoUpdater.on('update-available', info => publish({ status: 'available', version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : info.releaseNotes?.map(note => `${note.version}\n${note.note ?? ''}`).join('\n\n') }));
    autoUpdater.on('download-progress', info => publish({ ...state, status: 'downloading', percent: Number.isFinite(info.percent) ? Math.min(100, Math.max(0, info.percent)) : 0 }));
    autoUpdater.on('update-not-available', () => publish({ status: 'not-available' }));
    autoUpdater.on('update-downloaded', info => { publish({ ...state, status: 'downloaded', version: info?.version ?? state.version, percent: 100 }); restart(); });
  }
  return {
    check,
    apply,
    state: () => ({ ...state }),
    start() {
      if (!supported) return;
      check();
      timer = setInterval(() => { if (state.status !== 'available') check(); }, 10 * 60 * 1000);
    },
    stop() { if (timer) clearInterval(timer); },
    finishQuit() { if (install) autoUpdater.quitAndInstall(false, true); else app.quit(); },
  };
}
