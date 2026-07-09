import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// 纯 Web 构建配置（不依赖 vite-plugin-electron，方便打包和分发）
export default defineConfig({
  // Electron 生产环境通过 file:// 加载，必须使用相对资源路径，否则会白屏
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // 在 Electron 中运行时，允许 Node.js 内置模块
  optimizeDeps: {
    exclude: ["electron"],
  },
});
