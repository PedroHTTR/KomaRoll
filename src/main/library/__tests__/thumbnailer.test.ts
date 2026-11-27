import { describe, expect, it } from 'vitest';
import { TINY_PNG_BUFFER } from '@main/formats/__tests__/testZipHelper';
import { optimizeCoverThumbnail } from '../thumbnailer';

describe('optimizeCoverThumbnail', () => {
  it('returns empty buffers untouched and falls back safely outside Electron', () => {
    const empty = Buffer.alloc(0);
    expect(optimizeCoverThumbnail(empty)).toBe(empty);

    // In Node-only Vitest environment (no Electron nativeImage), safely passes through original bytes
    const out = optimizeCoverThumbnail(TINY_PNG_BUFFER);
    expect(out.equals(TINY_PNG_BUFFER)).toBe(true);
  });
});
