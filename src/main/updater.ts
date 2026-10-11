import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function createUpdater(isBusy: () => boolean, smoke = false) {
  const supported = process.platform === 'win32' && app.isPackaged && !smoke && existsSync(resolve(dirname(process.execPath), 'Uninstall FormEntryDesktop.exe'));
  let checking = false, manual = false, downloaded = false, prompting = false, prompted = false, install = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function notify() {
    if (!downloaded || prompting || prompted || isBusy()) return;
    prompting = true;
    try {
      const result = await dialog.showMessageBox({ type: 'info', title: 'Cập nhật ứng dụng', message: 'Phiên bản mới đã sẵn sàng.', detail: 'Khởi động lại để cài cập nhật. Cấu hình, lịch sử gửi và phiên Chrome được giữ.', buttons: ['Khởi động lại', 'Để sau'], defaultId: 1, cancelId: 1 });
      prompted = !isBusy();
      if (result.response === 0 && !isBusy()) { install = true; app.quit(); }
    } catch { console.error('UPDATE_PROMPT_FAILED'); }
    finally { prompting = false; }
  }
  function check(userRequested = false) {
    if (!supported) throw new Error('UPDATE_UNAVAILABLE');
    if (downloaded) { if (userRequested) prompted = false; setImmediate(() => { void notify(); }); return; }
    manual ||= userRequested;
    if (checking) return;
    checking = true;
    try { void autoUpdater.checkForUpdates().catch(failed); }
    catch { failed(); }
  }
  function failed() {
    checking = false;
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
    autoUpdater.on('update-not-available', () => {
      checking = false;
      if (manual) void dialog.showMessageBox({ type: 'info', title: 'Cập nhật ứng dụng', message: 'Bạn đang dùng phiên bản mới nhất.' });
      manual = false;
    });
    autoUpdater.on('update-downloaded', () => { checking = false; manual = false; downloaded = true; void notify(); });
  }
  return {
    check,
    start() {
      if (!supported) return;
      check();
      timer = setInterval(() => check(), 10 * 60 * 1000);
    },
    stop() { if (timer) clearInterval(timer); },
    finishQuit() { if (install) autoUpdater.quitAndInstall(true, true); else app.quit(); },
  };
}
