import { app, autoUpdater, dialog } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function createUpdater(isBusy: () => boolean, smoke = false) {
  const supported = process.platform === 'win32' && app.isPackaged && !smoke && existsSync(resolve(dirname(process.execPath), '..', 'Update.exe'));
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
    try { autoUpdater.checkForUpdates(); }
    catch { failed(); }
  }
  function failed() {
    checking = false;
    if (manual) void dialog.showMessageBox({ type: 'error', title: 'Cập nhật ứng dụng', message: 'Không kiểm tra được cập nhật. Kiểm tra kết nối rồi thử lại.' });
    manual = false;
  }
  if (supported) {
    const { repository } = require('../../package.json');
    const repo = new URL(repository.url).pathname.replace(/\.git$/, '');
    autoUpdater.setFeedURL({ url: `https://update.electronjs.org${repo}/win32-${process.arch}/${app.getVersion()}` });
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
      if (!process.argv.includes('--squirrel-firstrun')) check();
      timer = setInterval(() => check(), 10 * 60 * 1000);
    },
    stop() { if (timer) clearInterval(timer); },
    finishQuit() { if (install) autoUpdater.quitAndInstall(); else app.quit(); },
  };
}
