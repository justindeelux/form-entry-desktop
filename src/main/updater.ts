import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { UpdateState } from '../shared/contracts';

export function createUpdater(isBusy: () => boolean, smoke = false, onChange: (state: UpdateState) => void = () => {}) {
  const supported = process.platform === 'win32' && app.isPackaged && !smoke && existsSync(resolve(dirname(process.execPath), 'Uninstall FormEntryDesktop.exe'));
  let checking = false, manual = false, downloaded = false, prompting = false, prompted = false, install = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let state: UpdateState = { status: supported ? 'idle' : 'unsupported' };
  function publish(next: UpdateState) { state = next; onChange({ ...state }); }
  async function notify() {
    if (!downloaded || prompting || prompted || isBusy()) return;
    prompting = true;
    try {
      const result = await dialog.showMessageBox({ type: 'info', title: 'Cập nhật ứng dụng', message: `Phiên bản mới${state.version ? ` ${state.version}` : ''} đã tải xong.`, detail: 'Khởi động lại để cài cập nhật. Cửa sổ cài đặt sẽ hiển thị tiến độ; hoàn tất để mở lại app. Cấu hình, lịch sử gửi và phiên Chrome được giữ.', buttons: ['Khởi động lại', 'Để sau'], defaultId: 1, cancelId: 1 });
      prompted = !isBusy();
      if (result.response === 0 && !isBusy()) { install = true; publish({ ...state, status: 'installing' }); app.quit(); }
    } catch { console.error('UPDATE_PROMPT_FAILED'); }
    finally { prompting = false; }
  }
  function check(userRequested = false) {
    if (!supported) throw new Error('UPDATE_UNAVAILABLE');
    if (downloaded) { if (userRequested) prompted = false; setImmediate(() => { void notify(); }); return; }
    manual ||= userRequested;
    if (checking) return;
    checking = true;
    publish({ status: 'checking' });
    try { void autoUpdater.checkForUpdates().catch(failed); }
    catch { failed(); }
  }
  function failed() {
    checking = false;
    publish({ status: 'error' });
    if (manual) void dialog.showMessageBox({ type: 'error', title: 'Cập nhật ứng dụng', message: 'Không kiểm tra được cập nhật. Kiểm tra kết nối rồi thử lại.' });
    manual = false;
  }
  if (supported) {
    const { repository } = require('../../package.json');
    const [owner, repo] = new URL(repository.url).pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.setFeedURL({ provider: 'github', owner, repo });
    autoUpdater.on('error', failed);
    autoUpdater.on('update-available', info => publish({ status: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', info => publish({ ...state, status: 'downloading', percent: Number.isFinite(info.percent) ? Math.min(100, Math.max(0, info.percent)) : 0 }));
    autoUpdater.on('update-not-available', () => {
      checking = false;
      publish({ status: 'not-available' });
      if (manual) void dialog.showMessageBox({ type: 'info', title: 'Cập nhật ứng dụng', message: 'Bạn đang dùng phiên bản mới nhất.' });
      manual = false;
    });
    autoUpdater.on('update-downloaded', info => { checking = false; manual = false; downloaded = true; publish({ status: 'downloaded', version: info?.version ?? state.version, percent: 100 }); void notify(); });
  }
  return {
    check,
    state: () => ({ ...state }),
    start() {
      if (!supported) return;
      check();
      timer = setInterval(() => check(), 10 * 60 * 1000);
    },
    stop() { if (timer) clearInterval(timer); },
    finishQuit() { if (install) autoUpdater.quitAndInstall(false, true); else app.quit(); },
  };
}
