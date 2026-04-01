import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { spawn, exec } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { promisify } from "util";

const execAsync = promisify(exec);
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

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
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
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
  return result.filePaths[0];
});

// ─── IPC: 检查 Node.js / npx 是否可用 ──────────────────────────────────────
ipcMain.handle("system:checkNode", async () => {
  try {
    const { stdout } = await execAsync("node --version");
    return { available: true, version: stdout.trim() };
  } catch {
    return { available: false, version: null };
  }
});

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
      format: "pdf" | "pptx" | "html";
      theme?: string;
    }
  ) => {
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
        const proc = spawn("npx", args, { shell: true });
        let stderr = "";

        proc.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          // 清理临时文件
          try { fs.unlinkSync(tmpFile); } catch {}

          if (code === 0) {
            resolve({ success: true, outputFile });
          } else {
            resolve({ success: false, error: stderr || `退出码 ${code}` });
          }
        });

        proc.on("error", (err) => {
          resolve({ success: false, error: err.message });
        });
      }
    );
  }
);

// ─── IPC: 在系统文件管理器中打开目录 ──────────────────────────────────────
ipcMain.handle("shell:showItemInFolder", (_event, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// ─── IPC: 读取文件内容 ──────────────────────────────────────────────────────
ipcMain.handle("fs:readFile", (_event, filePath: string) => {
  return fs.readFileSync(filePath, "utf-8");
});

// ─── IPC: 写入文件内容 ──────────────────────────────────────────────────────
ipcMain.handle("fs:writeFile", (_event, filePath: string, content: string) => {
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
});
