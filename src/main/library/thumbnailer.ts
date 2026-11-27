interface NativeImageLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width?: number; height?: number; quality?: 'good' | 'better' | 'best' }): NativeImageLike;
  toJPEG(quality: number): Buffer;
}

interface ElectronNativeImageModule {
  createFromBuffer(buffer: Buffer): NativeImageLike;
}

let cachedNativeImage: ElectronNativeImageModule | null | undefined;

function getNativeImage(): ElectronNativeImageModule | null {
  if (cachedNativeImage !== undefined) return cachedNativeImage;
  if (!process.versions?.electron) {
    cachedNativeImage = null;
    return null;
  }
  try {
    // Dynamically resolve Electron's built-in nativeImage without breaking Node-only unit tests
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { nativeImage?: ElectronNativeImageModule };
    cachedNativeImage = electron?.nativeImage ?? null;
  } catch {
    cachedNativeImage = null;
  }
  return cachedNativeImage;
}

/**
 * Downscales high-resolution manga cover scans (often 2–8 MB) into compact 320px JPEG
 * thumbnails (~20–35 KB) using Electron's zero-dependency built-in `nativeImage`.
 * Gracefully returns the original buffer if running outside Electron or for unsupported formats (e.g. AVIF).
 */
export function optimizeCoverThumbnail(
  rawBytes: Buffer,
  maxWidth = 320,
  jpegQuality = 80,
): Buffer {
  if (!rawBytes || rawBytes.byteLength === 0) return rawBytes;

  const nativeImage = getNativeImage();
  if (!nativeImage) return rawBytes;

  try {
    const img = nativeImage.createFromBuffer(rawBytes);
    if (img.isEmpty()) return rawBytes;

    const { width } = img.getSize();
    const target =
      width > maxWidth ? img.resize({ width: maxWidth, quality: 'good' }) : img;
    const encoded = target.toJPEG(jpegQuality);

    // Only replace if encoded output is valid and actually smaller than the source
    if (encoded.byteLength > 0 && encoded.byteLength < rawBytes.byteLength) {
      return encoded;
    }
    return rawBytes;
  } catch {
    return rawBytes;
  }
}
