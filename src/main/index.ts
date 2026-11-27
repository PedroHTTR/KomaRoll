import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { LibrarySnapshot, ReaderSettings, ReadingProgress } from '@shared/types';
import { isSupportedBookExtension } from './formats/detectFormat';
import { BookSessionManager, createBookAdapter } from './formats/sessionManager';
import { LibraryScanner } from './library/scanner';
import { registerMangaScheme, setupMangaProtocol } from './protocol';
import { AppPersistence } from './storage/persistence';

// Must be called before app.whenReady()
registerMangaScheme();

let mainWindow: BrowserWindow | null = null;
let persistence: AppPersistence;
let sessionManager: BookSessionManager;
let scanner: LibraryScanner;
let pendingOsFilePath: string | null = null;

function findBookArg(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg.startsWith('-') && isSupportedBookExtension(arg)) {
      return arg;
    }
  }
  return null;
}

function broadcastLibraryUpdate(snapshot: LibrarySnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.LIBRARY_UPDATED, snapshot);
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 920,
    minHeight: 620,
    show: false,
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#0d0e12',
    title: 'KomaRoll — Manga Reader',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  Menu.setApplicationMenu(null);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.webContents.on('did-finish-load', () => {
    if (pendingOsFilePath) {
      const target = pendingOsFilePath;
      pendingOsFilePath = null;
      win.webContents.send(IPC_CHANNELS.OPEN_FILE_FROM_OS, target);
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.OPEN_FILE_DIALOG, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Open Manga File',
      properties: ['openFile'],
      filters: [
        { name: 'Manga & Books', extensions: ['cbz', 'cbr', 'epub', 'pdf'] },
        { name: 'Comic Archives', extensions: ['cbz', 'cbr'] },
        { name: 'EPUB & PDF', extensions: ['epub', 'pdf'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: 'Select Manga Library Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_BOOK, async (_event, filePath: string) => {
    const session = await sessionManager.openBook(filePath);
    broadcastLibraryUpdate(persistence.getLibrarySnapshot(scanner.isScanning()));
    return session;
  });

  ipcMain.handle(IPC_CHANNELS.CLOSE_BOOK, async (_event, bookId: string) => {
    await sessionManager.closeBook(bookId);
  });

  ipcMain.handle(IPC_CHANNELS.GET_LIBRARY, async () => {
    return persistence.getLibrarySnapshot(scanner.isScanning());
  });

  ipcMain.handle(IPC_CHANNELS.ADD_LIBRARY_FOLDER, async (_event, folderPath: string) => {
    persistence.addFolder(folderPath);
    return scanner.scanFolder(folderPath);
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_LIBRARY_FOLDER, async (_event, folderPath: string) => {
    persistence.removeFolder(folderPath);
    const snapshot = persistence.getLibrarySnapshot(scanner.isScanning());
    broadcastLibraryUpdate(snapshot);
    return snapshot;
  });

  ipcMain.handle(IPC_CHANNELS.RESCAN_LIBRARY, async () => {
    return scanner.scanAllFolders();
  });

  ipcMain.handle(IPC_CHANNELS.REMOVE_BOOK, async (_event, bookId: string) => {
    persistence.removeBook(bookId);
    const snapshot = persistence.getLibrarySnapshot(scanner.isScanning());
    broadcastLibraryUpdate(snapshot);
    return snapshot;
  });

  ipcMain.handle(
    IPC_CHANNELS.SAVE_PROGRESS,
    async (_event, bookId: string, progress: ReadingProgress) => {
      persistence.saveProgress(bookId, progress);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ADD_BOOKMARK,
    async (_event, bookId: string, pageIndex: number, label?: string) => {
      const bookmarks = persistence.addBookmark(bookId, pageIndex, label);
      broadcastLibraryUpdate(persistence.getLibrarySnapshot(scanner.isScanning()));
      return bookmarks;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.REMOVE_BOOKMARK,
    async (_event, bookId: string, bookmarkId: string) => {
      const bookmarks = persistence.removeBookmark(bookId, bookmarkId);
      broadcastLibraryUpdate(persistence.getLibrarySnapshot(scanner.isScanning()));
      return bookmarks;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SAVE_PDF_THUMBNAIL,
    async (_event, bookId: string, pageCount: number, imageBytes: Uint8Array) => {
      return scanner.savePdfThumbnail(bookId, pageCount, imageBytes);
    },
  );

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    return persistence.getSettings();
  });

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_SETTINGS,
    async (_event, partial: Partial<ReaderSettings>) => {
      return persistence.updateSettings(partial);
    },
  );

  ipcMain.handle(IPC_CHANNELS.TOGGLE_FULLSCREEN, async () => {
    if (!mainWindow) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  pendingOsFilePath = findBookArg(process.argv);

  app.on('second-instance', (_event, argv) => {
    const fileArg = findBookArg(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (fileArg) {
        mainWindow.webContents.send(IPC_CHANNELS.OPEN_FILE_FROM_OS, fileArg);
      }
    }
  });

  void app.whenReady().then(async () => {
    persistence = new AppPersistence(app.getPath('userData'));
    await persistence.init();

    sessionManager = new BookSessionManager(persistence);
    scanner = new LibraryScanner(persistence, createBookAdapter, broadcastLibraryUpdate);

    setupMangaProtocol(sessionManager, persistence);
    registerIpcHandlers();

    mainWindow = createWindow();

    // Trigger background library rescan on startup if folders exist
    if (persistence.getFolders().length > 0) {
      void scanner.scanAllFolders();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    void sessionManager?.closeAll();
    void persistence?.flushNow();
  });
}
