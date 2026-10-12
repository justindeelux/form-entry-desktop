import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, Progress, ScheduleState, UpdateState } from '../shared/contracts';

const api: DesktopApi = {
  checkForUpdates: () => ipcRenderer.invoke('update.check', {}),
  installUpdate: () => ipcRenderer.invoke('update.install', {}),
  updateState: () => ipcRenderer.invoke('update.state', {}),
  onUpdate(callback) {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state);
    ipcRenderer.on('update.changed', listener);
    return () => ipcRenderer.removeListener('update.changed', listener);
  },
  startSchedule: request => ipcRenderer.invoke('schedule.start', request),
  stopSchedule: () => ipcRenderer.invoke('schedule.stop', {}),
  scheduleState: () => ipcRenderer.invoke('schedule.state', {}),
  onSchedule(callback) {
    const listener = (_event: Electron.IpcRendererEvent, state: ScheduleState) => callback(state);
    ipcRenderer.on('schedule.changed', listener);
    return () => ipcRenderer.removeListener('schedule.changed', listener);
  },
  viewForm: query => ipcRenderer.invoke('data.viewForm', query),
  deleteProfile: () => ipcRenderer.invoke('profile.delete', {}),
  reloadSheets: request => ipcRenderer.invoke('data.reloadSheets', request),
  load: request => ipcRenderer.invoke('data.load', request),
  send: (mapping, defaults = {}, aliases = {}, formatting = {}) => ipcRenderer.invoke('data.send', { mapping, defaults, aliases, formatting }),
  history: query => ipcRenderer.invoke('data.history', query),
  deleteHistory: id => ipcRenderer.invoke('data.deleteHistory', { id }),
  preferences: () => ipcRenderer.invoke('settings.read'),
  savePreferences: preferences => ipcRenderer.invoke('settings.save', preferences),
  pendingSubmissions: () => ipcRenderer.invoke('data.pending'),
  confirmNotSent: request => ipcRenderer.invoke('data.confirmNotSent', request),
  onProgress(callback) {
    const listener = (_event: Electron.IpcRendererEvent, progress: Progress) => callback(progress);
    ipcRenderer.on('data.progress', listener);
    return () => { ipcRenderer.removeListener('data.progress', listener); };
  },
};
contextBridge.exposeInMainWorld('desktop', api);
