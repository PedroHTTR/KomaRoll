import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBookAdapter } from '../sessionManager';
import { detectBookFormat } from '../detectFormat';
import { CbrAdapter } from '../cbrAdapter';
import { TINY_PNG_BUFFER, writeZipFile } from './testZipHelper';

describe('CbrAdapter & CBR routing', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manga-cbr-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('routes misnamed ZIP-based .cbr files to CbzAdapter cleanly via magic-byte detection', async () => {
    const misnamedCbr = path.join(tmpDir, 'zip_inside.cbr');
    await writeZipFile(misnamedCbr, [
      { name: '002.png', content: TINY_PNG_BUFFER },
      { name: '001.png', content: TINY_PNG_BUFFER },
    ]);

    const format = await detectBookFormat(misnamedCbr);
    expect(format).toBe('cbz');

    const adapter = createBookAdapter(misnamedCbr, format);
    try {
      const opened = await adapter.open();
      expect(opened.pages).toHaveLength(2);
      expect(opened.pages[0].sourceRef).toBe('001.png');
    } finally {
      await adapter.close();
    }
  });

  it('handles invalid and truncated RAR payloads cleanly without crashing or leaking resources', async () => {
    const invalidRar = path.join(tmpDir, 'not_a_rar.cbr');
    await fs.writeFile(invalidRar, Buffer.from('not a valid rar archive at all'));

    const invalidAdapter = new CbrAdapter(invalidRar);
    await expect(invalidAdapter.open()).rejects.toThrow();

    const truncatedRar = path.join(tmpDir, 'truncated.cbr');
    await fs.writeFile(
      truncatedRar,
      Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]),
    );

    const truncatedAdapter = new CbrAdapter(truncatedRar);
    try {
      const opened = await truncatedAdapter.open();
      expect(opened.pages).toEqual([]);
    } finally {
      await truncatedAdapter.close();
    }
  });

  it('serializes concurrent CbrAdapter open calls safely through the WASM lock', async () => {
    const rar1 = path.join(tmpDir, 'concurrent1.cbr');
    const rar2 = path.join(tmpDir, 'concurrent2.cbr');
    const minimalHeader = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    await Promise.all([fs.writeFile(rar1, minimalHeader), fs.writeFile(rar2, minimalHeader)]);

    const a1 = new CbrAdapter(rar1);
    const a2 = new CbrAdapter(rar2);
    try {
      const [res1, res2] = await Promise.all([a1.open(), a2.open()]);
      expect(res1.pages).toEqual([]);
      expect(res2.pages).toEqual([]);
    } finally {
      await Promise.all([a1.close(), a2.close()]);
    }
  });
});
