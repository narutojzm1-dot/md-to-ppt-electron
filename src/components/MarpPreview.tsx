import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Marp } from "@marp-team/marp-core";

interface MarpPreviewProps {
  content: string;
}

interface PreviewRenderResult {
  css: string;
  slides: string[];
  error: string | null;
}

function renderMarpPreview(content: string): PreviewRenderResult {
  try {
    const marp = new Marp({ html: true });
    const result = marp.render(content || "---\nmarp: true\n---\n\n# 预览为空");
    // Marp 输出多个 svg 页面，按 svg 分页展示
    const slides = result.html.match(/<svg[\s\S]*?<\/svg>/g) ?? [result.html];
    return { css: result.css, slides, error: null };
  } catch (err: unknown) {
    return {
      css: "",
      slides: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// 使用 marp-core 在应用内渲染幻灯片预览，避免用户只能看源码猜效果
export default function MarpPreview({ content }: MarpPreviewProps) {
  const deferredContent = useDeferredValue(content);
  const [page, setPage] = useState(0);
  const rendered = useMemo(() => renderMarpPreview(deferredContent), [deferredContent]);

  useEffect(() => {
    setPage(0);
  }, [deferredContent]);

  if (rendered.error) {
    return (
      <div style={{
        flex: 1, border: "1px solid rgba(220,38,38,0.25)", borderRadius: "var(--radius)",
        background: "var(--error-bg)", color: "var(--error)",
        padding: 12, fontSize: 12, overflow: "auto",
      }}>
        预览失败：{rendered.error}
      </div>
    );
  }

  if (!rendered.slides.length) {
    return (
      <div style={{
        flex: 1, border: "1px dashed var(--border)", borderRadius: "var(--radius)",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-muted)", fontSize: 12,
      }}>
        暂无预览内容
      </div>
    );
  }

  const safePage = Math.min(page, rendered.slides.length - 1);
  const srcDoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; background: #0f172a; }
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  ${rendered.css}
  svg { max-width: 100%; height: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
</style>
</head>
<body>${rendered.slides[safePage]}</body>
</html>`;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button
          className="btn btn-outline"
          style={{ height: 28, fontSize: 12 }}
          disabled={safePage <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          上一页
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {safePage + 1} / {rendered.slides.length}
        </span>
        <button
          className="btn btn-outline"
          style={{ height: 28, fontSize: 12 }}
          disabled={safePage >= rendered.slides.length - 1}
          onClick={() => setPage((p) => Math.min(rendered.slides.length - 1, p + 1))}
        >
          下一页
        </button>
      </div>
      <iframe
        title="Marp 预览"
        srcDoc={srcDoc}
        style={{
          flex: 1, width: "100%", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", background: "#0f172a",
        }}
      />
    </div>
  );
}
