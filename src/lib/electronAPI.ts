// 检测是否在 Electron 环境中运行
export const isElectron = typeof window !== "undefined" && !!(window as any).electronAPI;

// 类型安全的 Electron API 访问
export const electronAPI = isElectron ? (window as any).electronAPI : null;

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
