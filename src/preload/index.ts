import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS, type MangaApi } from '@shared/ipc';
import type { LibrarySnapshot, ReaderSettings, ReadingProgress } from '@shared/types';

const mangaApi: MangaApi = {
  openFileDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE_DIALOG),
  openFolderDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FOLDER_DIALOG),
  openBook: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_BOOK, filePath),
  closeBook: (bookId: string) => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_BOOK, bookId),
  getLibrary: () => ipcRenderer.invoke(IPC_CHANNELS.GET_LIBRARY),
  addLibraryFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_LIBRARY_FOLDER, folderPath),
  removeLibraryFolder: (folderPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.REMOVE_LIBRARY_FOLDER, folderPath),
  rescanLibrary: () => ipcRenderer.invoke(IPC_CHANNELS.RESCAN_LIBRARY),
  removeBook: (bookId: string) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_BOOK, bookId),
  saveProgress: (bookId: string, progress: ReadingProgress) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_PROGRESS, bookId, progress),
  addBookmark: (bookId: string, pageIndex: number, label?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_BOOKMARK, bookId, pageIndex, label),
  removeBookmark: (bookId: string, bookmarkId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.REMOVE_BOOKMARK, bookId, bookmarkId),
  savePdfThumbnail: (bookId: string, pageCount: number, imageBytes: Uint8Array) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_PDF_THUMBNAIL, bookId, pageCount, imageBytes),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS),
  updateSettings: (partial: Partial<ReaderSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, partial),
  toggleFullscreen: () => ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_FULLSCREEN),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onLibraryUpdated: (callback: (snapshot: LibrarySnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: LibrarySnapshot) => {
      callback(snapshot);
    };
    ipcRenderer.on(IPC_CHANNELS.LIBRARY_UPDATED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.LIBRARY_UPDATED, listener);
    };
  },
  onOpenFileFromOs: (callback: (filePath: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, filePath: string) => {
      callback(filePath);
    };
    ipcRenderer.on(IPC_CHANNELS.OPEN_FILE_FROM_OS, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.OPEN_FILE_FROM_OS, listener);
    };
  },
};

contextBridge.exposeInMainWorld('mangaApi', mangaApi);
