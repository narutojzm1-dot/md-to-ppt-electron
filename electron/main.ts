import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { spawn, exec } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { promisify } from "util";
import OpenAI from "openai";
import {
  cleanupMarpContent,
  DEFAULT_MAX_TOKENS,
  formatConvertError,
  MARP_PROMPT,
} from "../shared/marp";

const execAsync = promisify(exec);
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
type ExportFormat = "pdf" | "pptx" | "html";

const EXPORT_FORMATS = new Set<ExportFormat>(["pdf", "pptx", "html"]);
const MARP_THEMES = new Set(["default", "gaia", "uncover"]);
const allowedOutputDirs = new Set<string>();
const allowedFiles = new Set<string>();
// 首次 npx 下载 Marp CLI 可能较慢，给足超时避免界面永久转圈
const MARP_EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;

// 统一规范化路径，后续权限判断都基于绝对路径进行
function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath);
}

// 判断目标路径是否落在用户授权过的目录内，避免渲染进程越权访问任意文件
function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// 记录用户通过系统对话框明确选择过的文件
function rememberFile(filePath: string) {
  allowedFiles.add(normalizeFilePath(filePath));
}

// 记录用户通过系统对话框或本地持久化配置确认过的导出目录
function rememberOutputDir(outputDir: string) {
  allowedOutputDirs.add(normalizeFilePath(outputDir));
}

// 文件读写和系统定位操作都需要先经过授权路径校验
function isAllowedFilePath(filePath: string): boolean {
  const normalizedPath = normalizeFilePath(filePath);
  if (allowedFiles.has(normalizedPath)) return true;
  for (const outputDir of allowedOutputDirs) {
    if (isPathInsideDirectory(normalizedPath, outputDir)) return true;
  }
  return false;
}

function assertAllowedFilePath(filePath: string) {
  if (!isAllowedFilePath(filePath)) {
    throw new Error("文件路径未经过用户授权，请重新选择文件或导出目录");
  }
}

function assertAllowedOutputDir(outputDir: string) {
  const normalizedDir = normalizeFilePath(outputDir);
  if (!allowedOutputDirs.has(normalizedDir)) {
    throw new Error("导出目录未经过用户授权，请重新选择导出目录");
  }
}

// 临时文件清理不能影响主流程，所以这里吞掉清理失败
function cleanupFile(filePath: string) {
  try { fs.unlinkSync(filePath); } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: "#F7F8FA",
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境下从 dist-electron/electron 回退到项目根目录，再定位到 dist/index.html
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: 打开文件对话框 ────────────────────────────────────────────────────
ipcMain.handle("dialog:openFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择 Markdown 文件",
    filters: [
      { name: "Markdown", extensions: ["md", "markdown"] },
      { name: "所有文件", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  rememberFile(filePath);
  const content = fs.readFileSync(filePath, "utf-8");
  return { filePath, fileName: path.basename(filePath), content };
});

// ─── IPC: 保存 Marp 源码文件 ────────────────────────────────────────────────
ipcMain.handle("dialog:saveFile", async (_event, { content, defaultName }: { content: string; defaultName: string }) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "保存 Marp 源码",
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) return null;
  rememberFile(result.filePath);
  fs.writeFileSync(result.filePath, content, "utf-8");
  return result.filePath;
});

// ─── IPC: 选择输出目录 ──────────────────────────────────────────────────────
ipcMain.handle("dialog:selectOutputDir", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: "选择导出目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  rememberOutputDir(result.filePaths[0]);
  return result.filePaths[0];
});

// ─── IPC: 重新登记已保存的导出目录 ──────────────────────────────────────────
ipcMain.handle("fs:authorizeOutputDir", (_event, outputDir: string) => {
  const normalizedDir = normalizeFilePath(outputDir);
  if (!fs.existsSync(normalizedDir) || !fs.statSync(normalizedDir).isDirectory()) {
    return false;
  }
  rememberOutputDir(normalizedDir);
  return true;
});

// ─── IPC: 检查 Node.js / npx 是否可用 ──────────────────────────────────────
ipcMain.handle("system:checkNode", async () => {
  try {
    const [{ stdout: nodeStdout }, { stdout: npxStdout }] = await Promise.all([
      execAsync("node --version"),
      execAsync("npx --version"),
    ]);
    return {
      available: true,
      version: nodeStdout.trim(),
      npxVersion: npxStdout.trim(),
    };
  } catch (err: unknown) {
    return {
      available: false,
      version: null,
      npxVersion: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// ─── IPC: AI 转换 Markdown 为 Marp ──────────────────────────────────────────
ipcMain.handle(
  "ai:generateMarp",
  async (
    _event,
    {
      apiKey,
      baseUrl,
      model,
      markdown,
    }: {
      apiKey: string;
      baseUrl?: string;
      model: string;
      markdown: string;
    }
  ) => {
    try {
      const clientOpts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
      if (baseUrl?.trim()) clientOpts.baseURL = baseUrl.trim().replace(/\/$/, "");

      const client = new OpenAI(clientOpts);
      const resp = await client.chat.completions.create({
        model: model.trim(),
        messages: [
          { role: "system", content: MARP_PROMPT },
          { role: "user", content: markdown },
        ],
        temperature: 0.7,
        max_tokens: DEFAULT_MAX_TOKENS,
      });

      const content = cleanupMarpContent(resp.choices[0]?.message?.content ?? "");
      if (!content.trim()) {
        return { success: false, error: "模型返回内容为空，请检查模型 ID 或调整输入内容后重试" };
      }
      return { success: true, content };
    } catch (err: unknown) {
      return { success: false, error: formatConvertError(err) };
    }
  }
);

// ─── IPC: 调用 Marp CLI 导出 ────────────────────────────────────────────────
ipcMain.handle(
  "marp:export",
  async (
    _event,
    {
      marpFilePath,
      outputDir,
      format,
      theme,
    }: {
      marpFilePath: string;
      outputDir: string;
      format: ExportFormat;
      theme?: string;
    }
  ) => {
    if (!EXPORT_FORMATS.has(format)) {
      throw new Error(`不支持的导出格式：${format}`);
    }
    if (theme && !MARP_THEMES.has(theme)) {
      throw new Error(`不支持的 Marp 主题：${theme}`);
    }
    assertAllowedOutputDir(outputDir);
    assertAllowedFilePath(marpFilePath);

    // 写入临时文件
    const tmpFile = path.join(os.tmpdir(), `marp_input_${Date.now()}.md`);
    fs.copyFileSync(marpFilePath, tmpFile);

    const baseName = path.basename(marpFilePath, path.extname(marpFilePath));
    const outputFile = path.join(outputDir, `${baseName}.${format}`);

    const args = [
      "@marp-team/marp-cli@latest",
      tmpFile,
      `--${format}`,
      "--output",
      outputFile,
      "--allow-local-files",
    ];

    if (theme) {
      args.push("--theme", theme);
    }

    return new Promise<{ success: boolean; outputFile?: string; error?: string }>(
      (resolve) => {
        const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
        // 使用参数化 spawn，避免路径或文件名中的特殊字符被 shell 解释
        const proc = spawn(npxCommand, args, { shell: false });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (result: { success: boolean; outputFile?: string; error?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          cleanupFile(tmpFile);
          resolve(result);
        };

        // 超时后主动结束进程，避免首次下载或卡死时界面永久等待
        const timeout = setTimeout(() => {
          proc.kill();
          finish({
            success: false,
            error: `导出超时（${Math.round(MARP_EXPORT_TIMEOUT_MS / 1000)} 秒）。请检查网络，或手动执行一次 npx @marp-team/marp-cli@latest --version 预热缓存。`,
          });
        }, MARP_EXPORT_TIMEOUT_MS);

        proc.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          if (code === 0) {
            rememberFile(outputFile);
            finish({ success: true, outputFile });
          } else {
            finish({ success: false, error: stderr || stdout || `退出码 ${code}` });
          }
        });

        proc.on("error", (err) => {
          finish({ success: false, error: err.message });
        });
      }
    );
  }
);

// ─── IPC: 在系统文件管理器中打开目录 ──────────────────────────────────────
ipcMain.handle("shell:showItemInFolder", (_event, filePath: string) => {
  assertAllowedFilePath(filePath);
  shell.showItemInFolder(filePath);
});

// ─── IPC: 读取文件内容 ──────────────────────────────────────────────────────
ipcMain.handle("fs:readFile", (_event, filePath: string) => {
  assertAllowedFilePath(filePath);
  return fs.readFileSync(filePath, "utf-8");
});

// ─── IPC: 写入文件内容 ──────────────────────────────────────────────────────
ipcMain.handle("fs:writeFile", (_event, filePath: string, content: string) => {
  assertAllowedFilePath(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  rememberFile(filePath);
  return true;
});
