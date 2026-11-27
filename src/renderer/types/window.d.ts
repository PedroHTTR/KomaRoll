/// <reference types="vite/client" />

import type { MangaApi } from '@shared/ipc';

declare global {
  interface Window {
    mangaApi: MangaApi;
  }
}

export {};
