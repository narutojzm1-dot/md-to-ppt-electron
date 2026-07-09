export type ExportFormat = "pdf" | "pptx" | "html";

export interface OpenFileResult {
  filePath: string;
  fileName: string;
  content: string;
}

export interface MarpExportResult {
  success: boolean;
  outputFile?: string;
  error?: string;
}

export interface GenerateMarpResult {
  success: boolean;
  content?: string;
  error?: string;
}

export interface RuntimeCheckResult {
  available: boolean;
  version: string | null;
  npxVersion: string | null;
  error?: string;
}

// 与 preload 暴露的 window.electronAPI 保持一致，集中约束渲染进程调用面
export interface ElectronAPI {
  openFile: () => Promise<OpenFileResult | null>;
  saveFile: (args: { content: string; defaultName: string }) => Promise<string | null>;
  selectOutputDir: () => Promise<string | null>;
  authorizeOutputDir: (outputDir: string) => Promise<boolean>;
  checkNode: () => Promise<RuntimeCheckResult>;
  generateMarp: (args: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    markdown: string;
  }) => Promise<GenerateMarpResult>;
  marpExport: (args: {
    marpFilePath: string;
    outputDir: string;
    format: ExportFormat;
    theme?: string;
  }) => Promise<MarpExportResult>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  showItemInFolder: (filePath: string) => Promise<void>;
  onMenuOpenFile: (callback: () => void) => () => void;
  onMenuSaveFile: (callback: () => void) => () => void;
}

// 检测是否在 Electron 环境中运行
export const isElectron =
  typeof window !== "undefined" && !!(window as unknown as { electronAPI?: ElectronAPI }).electronAPI;

// 类型安全的 Electron API 访问
export const electronAPI = isElectron
  ? (window as unknown as { electronAPI: ElectronAPI }).electronAPI
  : null;
