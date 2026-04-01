# MD to PPT — 桌面版 (Electron)

> 基于 React + Electron + TypeScript 构建的 Markdown 一键转 Marp PPT 桌面应用。

## 功能特性

- **本地文件系统访问**：通过原生文件对话框打开 Markdown 文件，无需浏览器限制
- **任意 AI Hub 支持**：填写 Base URL + API Key + Model ID，兼容所有 OpenAI 格式的供应商
- **一键导出 PDF / PPTX / HTML**：应用内直接调用 Marp CLI，无需手动输入命令行
- **配置持久化**：API 配置自动保存到本地，下次启动无需重新填写
- **跨平台**：可打包为 Windows (.exe)、macOS (.dmg)、Linux (.AppImage)

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 41 |
| UI 框架 | React 19 + TypeScript |
| 构建工具 | Vite 8 |
| 样式 | Tailwind CSS v4 |
| AI 调用 | openai npm 包 |
| PPT 渲染 | Marp CLI (npx) |

## 本地开发

### 前置要求

- Node.js >= 18
- pnpm >= 8

### 安装依赖

```bash
pnpm install
```

### 启动开发模式（仅 Web 预览）

```bash
pnpm dev
# 访问 http://localhost:5173
```

### 启动完整 Electron 开发模式

```bash
# 终端 1：启动 Vite 开发服务器
pnpm dev

# 终端 2：启动 Electron（等待 Vite 启动后）
npx tsc -p tsconfig.electron.json && electron .
```

## 打包发布

### 构建生产版本

```bash
pnpm electron:build
```

打包产物位于 `release/` 目录：
- Windows：`release/MD to PPT Setup x.x.x.exe`
- macOS：`release/MD to PPT-x.x.x.dmg`
- Linux：`release/MD to PPT-x.x.x.AppImage`

## 使用说明

1. **配置供应商**：在左侧面板填写 API Key、Base URL 和模型 ID（或点击快捷供应商按钮）
2. **选择导出目录**：点击"选择输出目录"按钮，指定 PDF/PPTX/HTML 的保存位置
3. **打开文件**：点击"打开文件"按钮，选择本地 Markdown 文件
4. **一键转换**：点击"一键转换为 Marp PPT"，等待 AI 生成 Marp 源码
5. **导出文件**：在右侧点击 PDF / PPTX / HTML 按钮，应用自动调用 Marp CLI 完成渲染

## 注意事项

- 导出功能需要本地安装 Node.js（应用启动时会自动检测）
- 首次导出时，npx 会自动下载 Marp CLI，需要网络连接
- API Key 仅保存在本地 localStorage，不会上传到任何服务器

## 项目结构

```
md-to-ppt-electron/
├── electron/
│   ├── main.ts          # Electron 主进程（文件系统、Marp CLI、IPC）
│   └── preload.ts       # 预加载脚本（安全暴露 API）
├── src/
│   ├── App.tsx          # 主界面（三栏布局）
│   ├── lib/
│   │   └── electronAPI.ts  # Electron API 封装
│   ├── main.tsx         # React 入口
│   └── index.css        # 全局样式
├── dist/                # Vite 构建产物
├── dist-electron/       # Electron 主进程编译产物
├── release/             # electron-builder 打包产物
├── vite.config.ts
├── tsconfig.json        # React 渲染进程 TypeScript 配置
└── tsconfig.electron.json  # Electron 主进程 TypeScript 配置
```
