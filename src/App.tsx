import { useState, useRef, useCallback, useEffect, useId } from "react";
import OpenAI from "openai";
import { electronAPI, isElectron, type ExportFormat, type RuntimeCheckResult } from "./lib/electronAPI";
import os from "os";

// ─── Marp 转换 Prompt ────────────────────────────────────────────────────────
const MARP_PROMPT = `你是一个专业的 PPT 演示文稿策划专家和 Markdown 工程师。
将用户提供的 Markdown 文档转换为可以直接使用 Marp 渲染的高质量演示文稿源码。

【Marp 基础语法】
- 文件头部必须包含 YAML frontmatter（marp: true, theme: default, paginate: true）
- 使用 --- 分隔每一页幻灯片

【内容转换策略】
1. 结构化重构：H1/H2 作为幻灯片标题；标题必须是洞察或结论；每页 3-5 个核心要点；总页数 10-15 页
2. 精准可视化：流程/架构关系用 Mermaid 代码块；数据对比保留 Markdown 表格
3. 代码展示：保留关键代码片段，过长时保留核心逻辑并用注释省略
4. 视觉节奏：首页封面（大标题+副标题）；第二页目录；最后一页 Q&A

【输出要求】只输出 Marp Markdown 源码，不要包含任何解释性文字，不要用代码块包裹。`;

// ─── 本地存储 ────────────────────────────────────────────────────────────────
const STORAGE_KEY = "md2ppt_electron_config";

interface Config {
  apiKey: string;
  baseUrl: string;
  model: string;
  outputDir: string;
  theme: string;
}

// 统一生成 Marp 源文件名，兼容 .md / .markdown / 无扩展名场景
function getMarpFileName(sourceFileName: string): string {
  const safeName = sourceFileName.trim() || "presentation.md";
  if (/\.(md|markdown)$/i.test(safeName)) {
    return safeName.replace(/\.(md|markdown)$/i, "_marp.md");
  }
  return `${safeName}_marp.md`;
}

// 统一拼接输出目录下的临时 Marp 文件路径，避免目录尾部斜杠导致双斜杠
function buildOutputMarpPath(outputDir: string, sourceFileName: string): string {
  const normalizedDir = outputDir.replace(/[\\/]+$/, "");
  return `${normalizedDir}/${getMarpFileName(sourceFileName)}`;
}

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {}
  return defaultConfig();
}

function defaultConfig(): Config {
  return { apiKey: "", baseUrl: "", model: "gpt-4o", outputDir: "", theme: "default" };
}

// ─── 图标组件（内联 SVG，避免额外依赖）─────────────────────────────────────
const Icon = {
  Zap: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Settings: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  Upload: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  Wand: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/>
    </svg>
  ),
  Code: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  Download: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Copy: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  Folder: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Alert: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  File: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  Spin: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg>
  ),
  Eye: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
};

// ─── Toast 简易实现 ──────────────────────────────────────────────────────────
type ToastType = "success" | "error" | "info";
interface Toast { id: number; msg: string; type: ToastType; }
let toastId = 0;

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((msg: string, type: ToastType = "info") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return { toasts, show };
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig] = useState<Config>(loadConfig);
  const [mdContent, setMdContent] = useState("");
  const [marpContent, setMarpContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [savedMarpPath, setSavedMarpPath] = useState("");
  const [converting, setConverting] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [nodeInfo, setNodeInfo] = useState<RuntimeCheckResult | null>(null);
  const [exportResults, setExportResults] = useState<Record<string, { success: boolean; file?: string }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toasts, show: toast } = useToast();

  // 持久化配置
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); }, [config]);

  // 检查 Node.js / npx 环境，并重新登记本地保存的导出目录
  useEffect(() => {
    if (isElectron && electronAPI) {
      electronAPI.checkNode().then(setNodeInfo);
      if (config.outputDir) {
        electronAPI.authorizeOutputDir(config.outputDir).then((ok) => {
          if (!ok) toast("已保存的导出目录不可用，请重新选择", "error");
        });
      }
    }
  }, [config.outputDir, toast]);

  // 处理文件（来自 Electron 对话框或拖拽）
  const loadFile = useCallback((content: string, name: string) => {
    setMdContent(content);
    setFileName(name);
    setMarpContent("");
    setSavedMarpPath("");
    setExportResults({});
    toast(`已加载：${name}`, "success");
  }, [toast]);

  // Electron 文件打开对话框
  const handleOpenFile = async () => {
    if (isElectron && electronAPI) {
      const result = await electronAPI.openFile();
      if (result) loadFile(result.content, result.fileName);
    } else {
      fileInputRef.current?.click();
    }
  };

  // 浏览器文件输入
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadFile(ev.target?.result as string, file.name);
    reader.readAsText(file, "utf-8");
  };

  // 拖拽处理
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.(md|markdown)$/i.test(file.name)) {
      toast("请拖入 .md 或 .markdown 文件", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => loadFile(ev.target?.result as string, file.name);
    reader.readAsText(file, "utf-8");
  };

  // 选择输出目录
  const handleSelectOutputDir = async () => {
    if (isElectron && electronAPI) {
      const dir = await electronAPI.selectOutputDir();
      if (dir) setConfig((c) => ({ ...c, outputDir: dir }));
    }
  };

  // AI 转换
  const handleConvert = async () => {
    if (!config.apiKey.trim()) { toast("请先填写 API Key", "error"); return; }
    if (!config.model.trim()) { toast("请填写模型 ID", "error"); return; }
    if (!mdContent.trim()) { toast("请先加载 Markdown 文件", "error"); return; }

    setConverting(true);
    setMarpContent("");
    setSavedMarpPath("");
    setExportResults({});

    try {
      const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
        apiKey: config.apiKey,
        dangerouslyAllowBrowser: true,
      };
      if (config.baseUrl.trim()) clientOpts.baseURL = config.baseUrl.trim().replace(/\/$/, "");

      const client = new OpenAI(clientOpts);
      const resp = await client.chat.completions.create({
        model: config.model.trim(),
        messages: [
          { role: "system", content: MARP_PROMPT },
          { role: "user", content: mdContent },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      });

      let result = resp.choices[0]?.message?.content?.trim() ?? "";
      // 兼容不同模型返回的代码块包裹格式，统一提取纯 Marp 文本
      result = result.replace(/^```(?:markdown|md|marp)?\s*/i, "");
      if (result.endsWith("```")) result = result.slice(0, -3).trimEnd();
      if (!result.trim()) {
        throw new Error("模型返回内容为空，请调整提示词或模型后重试");
      }

      setMarpContent(result);
      toast("转换成功！", "success");

      // 在 Electron 中自动保存临时文件供导出使用
      if (isElectron && electronAPI && config.outputDir) {
        const tmpPath = buildOutputMarpPath(config.outputDir, fileName);
        await electronAPI.writeFile(tmpPath, result);
        setSavedMarpPath(tmpPath);
      }
    } catch (err: unknown) {
      toast(`转换失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setConverting(false);
    }
  };

  // 保存 Marp 源码
  const handleSave = async () => {
    if (!marpContent) return;
    try {
      if (isElectron && electronAPI) {
        const defaultName = getMarpFileName(fileName);
        const saved = await electronAPI.saveFile({ content: marpContent, defaultName });
        if (saved) {
          setSavedMarpPath(saved);
          toast(`已保存：${saved}`, "success");
        }
      } else {
        const blob = new Blob([marpContent], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = getMarpFileName(fileName);
        a.click();
        URL.revokeObjectURL(url);
        toast("文件已下载", "success");
      }
    } catch (err: unknown) {
      toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  // 复制到剪贴板
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(marpContent);
      toast("已复制到剪贴板", "success");
    } catch {
      toast("复制失败，请检查系统剪贴板权限", "error");
    }
  };

  // Marp 导出（仅 Electron）
  const handleExport = async (format: ExportFormat) => {
    if (!isElectron || !electronAPI) { toast("导出功能仅在桌面版中可用", "info"); return; }
    if (!marpContent) { toast("请先完成转换", "error"); return; }
    if (!config.outputDir) { toast("请先选择输出目录", "error"); return; }
    if (!nodeInfo?.available) { toast("未检测到 Node.js 或 npx，请先安装 Node.js", "error"); return; }

    setExporting(format);
    try {
      // 确保有保存的临时文件，写入失败时会进入统一错误提示
      let marpPath = savedMarpPath;
      if (!marpPath) {
        const tmpPath = buildOutputMarpPath(config.outputDir, fileName);
        await electronAPI.writeFile(tmpPath, marpContent);
        setSavedMarpPath(tmpPath);
        marpPath = tmpPath;
      }

      const result = await electronAPI.marpExport({
        marpFilePath: marpPath,
        outputDir: config.outputDir,
        format,
        theme: config.theme !== "default" ? config.theme : undefined,
      });

      if (result.success) {
        setExportResults((r) => ({ ...r, [format]: { success: true, file: result.outputFile } }));
        toast(`${format.toUpperCase()} 导出成功！`, "success");
      } else {
        toast(`导出失败：${result.error}`, "error");
      }
    } catch (err: unknown) {
      toast(`导出失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setExporting(null);
    }
  };

  const configOk = config.apiKey.trim() && config.model.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── 顶部标题栏 ── */}
      <header
        className="electron-drag-region"
        style={{
        height: 44,
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 10,
        flexShrink: 0,
      }}
      >
        <div className="electron-no-drag" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 6,
            background: "var(--primary)", display: "flex",
            alignItems: "center", justifyContent: "center", color: "#fff",
          }}>
            <Icon.Zap />
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>MD to PPT</span>
          <span className="badge badge-blue">Desktop v1.0</span>
        </div>
        <div style={{ flex: 1 }} />
        {isElectron && nodeInfo && (
          <div className="electron-no-drag" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: nodeInfo.available ? "var(--success)" : "var(--error)",
            }} />
            {nodeInfo.available ? `Node.js ${nodeInfo.version} / npx ${nodeInfo.npxVersion}` : "未检测到 Node.js 或 npx"}
          </div>
        )}
      </header>

      {/* ── 主体三栏 ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── 左栏：配置面板 ── */}
        <aside style={{
          width: 260,
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          flexShrink: 0,
        }}>
          {/* 配置头部 */}
          <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <Icon.Settings />
              <span style={{ fontWeight: 600, fontSize: 13 }}>供应商配置</span>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>配置 AI Hub 地址和密钥</p>
          </div>

          <div style={{ padding: "12px 14px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* API Key */}
            <div>
              <label className="label" style={{ display: "block", marginBottom: 5 }}>API Key</label>
              <input
                className="input"
                type="password"
                placeholder="sk-xxxxxxxxxxxxxxxx"
                value={config.apiKey}
                onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
              />
            </div>

            {/* Base URL */}
            <div>
              <label className="label" style={{ display: "block", marginBottom: 5 }}>供应商地址 (Base URL)</label>
              <input
                className="input"
                type="text"
                placeholder="https://your-hub.com/v1"
                value={config.baseUrl}
                onChange={(e) => setConfig((c) => ({ ...c, baseUrl: e.target.value }))}
              />
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>留空则使用 OpenAI 官方地址</p>
            </div>

            {/* Model ID */}
            <div>
              <label className="label" style={{ display: "block", marginBottom: 5 }}>模型 ID</label>
              <input
                className="input"
                type="text"
                placeholder="gpt-4o / deepseek-chat / ..."
                value={config.model}
                onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              />
            </div>

            <hr className="divider" />

            {/* 快捷供应商 */}
            <div>
              <label className="label" style={{ display: "block", marginBottom: 8 }}>常见供应商快捷填入</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { name: "DeepSeek", url: "https://api.deepseek.com", model: "deepseek-chat" },
                  { name: "智谱 GLM", url: "https://open.bigmodel.cn/api/paas/v4/", model: "glm-4-flash" },
                  { name: "月之暗面", url: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
                  { name: "阿里百炼", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-max" },
                  { name: "字节豆包", url: "https://ark.cn-beijing.volces.com/api/v3", model: "" },
                ].map((p) => (
                  <button
                    key={p.name}
                    onClick={() => setConfig((c) => ({ ...c, baseUrl: p.url, model: p.model || c.model }))}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)",
                      background: "transparent", cursor: "pointer", fontSize: 12,
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ fontWeight: 600, color: "var(--primary)" }}>{p.name}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-muted)" }}>
                      {p.model || "自定义 ID"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <hr className="divider" />

            {/* Marp 主题 */}
            <div>
              <label className="label" style={{ display: "block", marginBottom: 5 }}>Marp 主题</label>
              <select
                style={{
                  width: "100%", padding: "6px 10px",
                  border: "1px solid var(--border)", borderRadius: "var(--radius)",
                  fontSize: 12.5, fontFamily: "var(--font-sans)",
                  background: "var(--surface)", color: "var(--text)", outline: "none",
                }}
                value={config.theme}
                onChange={(e) => setConfig((c) => ({ ...c, theme: e.target.value }))}
              >
                <option value="default">Default</option>
                <option value="gaia">Gaia</option>
                <option value="uncover">Uncover</option>
              </select>
            </div>

            {/* 输出目录（仅 Electron） */}
            {isElectron && (
              <div>
                <label className="label" style={{ display: "block", marginBottom: 5 }}>导出目录</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder="选择输出目录..."
                    value={config.outputDir}
                    readOnly
                    style={{ flex: 1, cursor: "pointer" }}
                    onClick={handleSelectOutputDir}
                  />
                  <button className="btn btn-outline" style={{ padding: "6px 10px" }} onClick={handleSelectOutputDir}>
                    <Icon.Folder />
                  </button>
                </div>
              </div>
            )}

            {/* 配置状态 */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 10px", borderRadius: 6, fontSize: 11.5,
              background: configOk ? "var(--success-bg)" : "var(--warning-bg)",
              color: configOk ? "var(--success)" : "var(--warning)",
            }}>
              {configOk ? <Icon.Check /> : <Icon.Alert />}
              {configOk ? "配置完成，可以开始转换" : "请填写 API Key 和模型 ID"}
            </div>
          </div>
        </aside>

        {/* ── 中栏：Markdown 编辑器 ── */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          borderRight: "1px solid var(--border)", overflow: "hidden", minWidth: 0,
        }}>
          {/* 工具栏 */}
          <div style={{
            height: 40, padding: "0 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
            display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
          }}>
            <Icon.File />
            <span style={{ fontWeight: 600, fontSize: 13 }}>Markdown 输入</span>
            {fileName && (
              <span className="badge badge-gray" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {fileName}
              </span>
            )}
            <div style={{ flex: 1 }} />
            <input ref={fileInputRef} type="file" accept=".md,.markdown" onChange={onFileChange} style={{ display: "none" }} />
            <button className="btn btn-outline" style={{ height: 28, fontSize: 12 }} onClick={handleOpenFile}>
              <Icon.Upload />
              {isElectron ? "打开文件" : "上传文件"}
            </button>
          </div>

          {/* 编辑区 */}
          <div style={{ flex: 1, padding: 10, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8 }}>
            {!mdContent ? (
              <div
                className={isDragOver ? "drop-active" : ""}
                style={{
                  flex: 1, border: "2px dashed var(--border)", borderRadius: "var(--radius)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 10, cursor: "pointer", transition: "all 0.15s",
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={onDrop}
                onClick={handleOpenFile}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: "50%",
                  background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontWeight: 600, fontSize: 13 }}>
                    {isElectron ? "点击打开 Markdown 文件" : "拖拽 Markdown 文件到此处"}
                  </p>
                  <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                    支持 .md / .markdown 格式
                  </p>
                </div>
              </div>
            ) : (
              <textarea
                className="code-editor"
                value={mdContent}
                onChange={(e) => setMdContent(e.target.value)}
                spellCheck={false}
              />
            )}

            {/* 转换按钮 */}
            <button
              className="btn btn-primary"
              style={{ width: "100%", height: 36, fontSize: 13 }}
              onClick={handleConvert}
              disabled={!configOk || !mdContent || converting}
            >
              {converting ? <><Icon.Spin />正在转换，请稍候...</> : <><Icon.Wand />一键转换为 Marp PPT</>}
            </button>
          </div>
        </div>

        {/* ── 右栏：Marp 源码 + 导出 ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* 工具栏 */}
          <div style={{
            height: 40, padding: "0 12px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
            display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
          }}>
            <Icon.Code />
            <span style={{ fontWeight: 600, fontSize: 13 }}>Marp 源码输出</span>
            {marpContent && <span className="badge badge-green">已生成</span>}
            <div style={{ flex: 1 }} />
            {marpContent && (
              <>
                <button className="btn btn-outline" style={{ height: 28, fontSize: 12 }} onClick={handleCopy}>
                  <Icon.Copy />复制
                </button>
                <button className="btn btn-outline" style={{ height: 28, fontSize: 12 }} onClick={handleSave}>
                  <Icon.Download />保存 .md
                </button>
              </>
            )}
          </div>

          <div style={{ flex: 1, padding: 10, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8 }}>
            {!marpContent ? (
              <div style={{
                flex: 1, border: "1px dashed var(--border)", borderRadius: "var(--radius)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <Icon.Eye />
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>等待转换结果</p>
                  <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>配置 API 并加载 Markdown 后点击转换</p>
                </div>
              </div>
            ) : (
              <textarea
                className="code-editor"
                value={marpContent}
                onChange={(e) => setMarpContent(e.target.value)}
                spellCheck={false}
              />
            )}

            {/* 导出面板 */}
            {marpContent && (
              <div style={{
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: "var(--radius)", padding: "10px 12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Icon.Download />
                  <span style={{ fontWeight: 600, fontSize: 12 }}>
                    {isElectron ? "一键导出" : "渲染命令"}
                  </span>
                  {isElectron && !config.outputDir && (
                    <span style={{ fontSize: 11, color: "var(--warning)", marginLeft: 4 }}>
                      ⚠ 请先在左侧选择导出目录
                    </span>
                  )}
                </div>

                {isElectron ? (
                  // Electron：直接导出按钮
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["pdf", "pptx", "html"] as ExportFormat[]).map((fmt) => {
                      const result = exportResults[fmt];
                      return (
                        <div key={fmt} style={{ flex: 1 }}>
                          <button
                            className="btn btn-outline"
                            style={{
                              width: "100%", height: 32, fontSize: 12,
                              background: result?.success ? "var(--success-bg)" : undefined,
                              borderColor: result?.success ? "var(--success)" : undefined,
                              color: result?.success ? "var(--success)" : undefined,
                            }}
                            onClick={() => handleExport(fmt)}
                            disabled={exporting !== null || !config.outputDir}
                          >
                            {exporting === fmt ? <Icon.Spin /> : result?.success ? <Icon.Check /> : <Icon.Download />}
                            {fmt.toUpperCase()}
                          </button>
                          {result?.success && result.file && (
                            <button
                              style={{
                                width: "100%", marginTop: 3, fontSize: 10.5,
                                color: "var(--primary)", background: "none", border: "none",
                                cursor: "pointer", textDecoration: "underline",
                              }}
                              onClick={() => electronAPI?.showItemInFolder(result.file!)}
                            >
                              在文件夹中显示
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // Web：显示命令行提示
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {[
                      { label: "PDF", cmd: "npx @marp-team/marp-cli@latest 输出.md --pdf" },
                      { label: "PPTX", cmd: "npx @marp-team/marp-cli@latest 输出.md --pptx" },
                      { label: "HTML", cmd: "npx @marp-team/marp-cli@latest 输出.md --html" },
                    ].map((item) => (
                      <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", width: 36, flexShrink: 0 }}>{item.label}</span>
                        <code
                          style={{
                            flex: 1, fontSize: 11, fontFamily: "var(--font-mono)",
                            background: "var(--surface)", border: "1px solid var(--border)",
                            borderRadius: 4, padding: "3px 8px", cursor: "pointer",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                          onClick={() => { navigator.clipboard.writeText(item.cmd); toast(`已复制 ${item.label} 命令`, "success"); }}
                          title="点击复制"
                        >
                          {item.cmd}
                        </code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Toast 通知 ── */}
      <div style={{ position: "fixed", bottom: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 9999 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{
            padding: "8px 14px", borderRadius: "var(--radius)", fontSize: 12.5, fontWeight: 500,
            background: t.type === "success" ? "var(--success)" : t.type === "error" ? "var(--error)" : "var(--text)",
            color: "#fff", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            animation: "fadeIn 0.2s ease",
          }}>
            {t.msg}
          </div>
        ))}
      </div>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
