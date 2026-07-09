import { spawn } from "node:child_process";
import http from "node:http";

const VITE_URL = "http://localhost:5173";
const WAIT_TIMEOUT_MS = 30000;
const WAIT_INTERVAL_MS = 300;

const children = new Set();
let shuttingDown = false;

// 统一启动子进程，便于在退出时集中清理 Vite 和 Electron
function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

// 退出开发模式时同步结束所有子进程，避免残留端口占用
function cleanup(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(exitCode);
}

// 通过 HTTP 探测 Vite 是否已经可以响应请求
function isViteReady() {
  return new Promise((resolve) => {
    const req = http.get(VITE_URL, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 等待开发服务器就绪，避免 Electron 过早加载导致空白页
async function waitForVite() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < WAIT_TIMEOUT_MS) {
    if (await isViteReady()) return;
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }
  throw new Error(`等待 Vite 服务超时：${VITE_URL}`);
}

process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

// 先编译 Electron 主进程，再启动 Vite；否则 electron . 会找不到 dist-electron
function compileElectron() {
  return new Promise((resolve, reject) => {
    const tsc = run("pnpm", ["exec", "tsc", "-p", "tsconfig.electron.json"]);
    tsc.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Electron 主进程编译失败，退出码 ${code}`));
    });
    tsc.once("error", reject);
  });
}

try {
  await compileElectron();

  // 开发模式下先启动 Vite 服务，等待端口就绪后再启动 Electron，避免白屏或连接失败
  const vite = run("pnpm", ["dev"]);
  vite.once("exit", (code) => {
    if (!shuttingDown) cleanup(code ?? 1);
  });

  await waitForVite();
  const electron = run("electron", ["."], {
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });
  electron.once("exit", (code) => cleanup(code ?? 0));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  cleanup(1);
}
