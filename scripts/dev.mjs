import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const devUrl = 'http://localhost:5173';
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function main() {
  // Initial electron main/preload build
  await new Promise((resolve, reject) => {
    const initBuild = spawn(process.execPath, [path.join(rootDir, 'scripts/build-electron.mjs')], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    initBuild.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Initial electron build exited with code ${code}`));
    });
  });

  const children = [];
  const cleanup = () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill();
      }
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  const viteProc = spawn(npmCmd, ['exec', '--', 'vite'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWin,
  });
  children.push(viteProc);

  const watchProc = spawn(process.execPath, [path.join(rootDir, 'scripts/build-electron.mjs'), '--watch'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  children.push(watchProc);

  await waitForServer(devUrl);

  const electronProc = spawn(npxCmd, ['electron', '.'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: isWin,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl,
    },
  });
  children.push(electronProc);

  electronProc.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
