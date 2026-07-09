import { contextBridge, ipcRenderer } from "electron";

// 通过 contextBridge 安全暴露 API 给渲染进程（React 前端）
contextBridge.exposeInMainWorld("electronAPI", {
  // 文件对话框
  openFile: () => ipcRenderer.invoke("dialog:openFile"),
  saveFile: (args: { content: string; defaultName: string }) =>
    ipcRenderer.invoke("dialog:saveFile", args),
  selectOutputDir: () => ipcRenderer.invoke("dialog:selectOutputDir"),

  // 系统检查
  checkNode: () => ipcRenderer.invoke("system:checkNode"),
  authorizeOutputDir: (outputDir: string) =>
    ipcRenderer.invoke("fs:authorizeOutputDir", outputDir),

  // Marp 导出
  generateMarp: (args: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    markdown: string;
  }) => ipcRenderer.invoke("ai:generateMarp", args),
  marpExport: (args: {
    marpFilePath: string;
    outputDir: string;
    format: "pdf" | "pptx" | "html";
    theme?: string;
  }) => ipcRenderer.invoke("marp:export", args),

  // 文件系统
  readFile: (filePath: string) => ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("fs:writeFile", filePath, content),

  // Shell
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke("shell:showItemInFolder", filePath),

  // 应用菜单事件
  onMenuOpenFile: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:openFile", listener);
    return () => ipcRenderer.removeListener("menu:openFile", listener);
  },
  onMenuSaveFile: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("menu:saveFile", listener);
    return () => ipcRenderer.removeListener("menu:saveFile", listener);
  },
});

// TypeScript 类型声明（供渲染进程使用）
export type ElectronAPI = {
  openFile: () => Promise<{ filePath: string; fileName: string; content: string } | null>;
  saveFile: (args: { content: string; defaultName: string }) => Promise<string | null>;
  selectOutputDir: () => Promise<string | null>;
  authorizeOutputDir: (outputDir: string) => Promise<boolean>;
  checkNode: () => Promise<{
    available: boolean;
    version: string | null;
    npxVersion: string | null;
    error?: string;
  }>;
  generateMarp: (args: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    markdown: string;
  }) => Promise<{ success: boolean; content?: string; error?: string }>;
  marpExport: (args: {
    marpFilePath: string;
    outputDir: string;
    format: "pdf" | "pptx" | "html";
    theme?: string;
  }) => Promise<{ success: boolean; outputFile?: string; error?: string }>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  showItemInFolder: (filePath: string) => Promise<void>;
  onMenuOpenFile: (callback: () => void) => () => void;
  onMenuSaveFile: (callback: () => void) => () => void;
};
