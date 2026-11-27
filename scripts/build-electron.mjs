import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-electron');
const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: !isWatch,
  treeShaking: true,
  sourcemap: isWatch,
};

/** @type {import('esbuild').BuildOptions} */
const mainOptions = {
  ...sharedOptions,
  entryPoints: [path.join(rootDir, 'src/main/index.ts')],
  outfile: path.join(outDir, 'main.cjs'),
  external: ['electron', 'node-unrar-js'],
  alias: {
    '@shared': path.join(rootDir, 'src/shared'),
    '@main': path.join(rootDir, 'src/main'),
  },
};

/** @type {import('esbuild').BuildOptions} */
const preloadOptions = {
  ...sharedOptions,
  entryPoints: [path.join(rootDir, 'src/preload/index.ts')],
  outfile: path.join(outDir, 'preload.cjs'),
  external: ['electron'],
  alias: {
    '@shared': path.join(rootDir, 'src/shared'),
  },
};

async function run() {
  if (isWatch) {
    const [mainCtx, preloadCtx] = await Promise.all([
      esbuild.context(mainOptions),
      esbuild.context(preloadOptions),
    ]);
    await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
    console.log('[electron-build] Watching main & preload...');
  } else {
    await fs.rm(outDir, { recursive: true, force: true });
    await Promise.all([esbuild.build(mainOptions), esbuild.build(preloadOptions)]);
    console.log('[electron-build] Built minified main & preload.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
