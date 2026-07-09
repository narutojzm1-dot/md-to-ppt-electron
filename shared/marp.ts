// 共享 Marp 转换 Prompt 与校验逻辑，供渲染进程和 Electron 主进程复用

export const MARP_PROMPT = `你是一个专业的 PPT 演示文稿策划专家和 Markdown 工程师。
将用户提供的 Markdown 文档转换为可以直接使用 Marp 渲染的高质量演示文稿源码。

【Marp 基础语法】
- 文件头部必须包含 YAML frontmatter（marp: true, theme: default, paginate: true）
- 使用 --- 分隔每一页幻灯片
- Mermaid 必须写成 \`\`\`mermaid 代码块，不能直接输出裸 graph/flowchart 文本

【内容转换策略】
1. 结构化重构：H1/H2 作为幻灯片标题；标题必须是洞察或结论；每页 3-5 个核心要点；总页数 10-15 页
2. 精准可视化：流程/架构关系用 Mermaid 代码块；数据对比保留 Markdown 表格
3. 代码展示：保留关键代码片段，过长时保留核心逻辑并用注释省略
4. 视觉节奏：首页封面（大标题+副标题）；第二页目录；最后一页 Q&A

【输出要求】
- 只输出 Marp Markdown 源码，不要包含任何解释性文字，不要用代码块包裹整个文档
- 必须生成完整幻灯片，而不是摘要、提纲或单个 Mermaid 图
- 每页必须有标题，至少 8 页，使用 --- 分页。`;

// AI 生成时的默认最大 token，避免长文档被截断成不完整幻灯片
export const DEFAULT_MAX_TOKENS = 8192;

// 统一生成 Marp 源文件名，兼容 .md / .markdown / 无扩展名场景
export function getMarpFileName(sourceFileName: string): string {
  const safeName = sourceFileName.trim() || "presentation.md";
  if (/\.(md|markdown)$/i.test(safeName)) {
    return safeName.replace(/\.(md|markdown)$/i, "_marp.md");
  }
  return `${safeName}_marp.md`;
}

// 统一拼接输出目录下的临时 Marp 文件路径，避免目录尾部斜杠导致双斜杠
export function buildOutputMarpPath(outputDir: string, sourceFileName: string): string {
  const normalizedDir = outputDir.replace(/[\\/]+$/, "");
  return `${normalizedDir}/${getMarpFileName(sourceFileName)}`;
}

export function cleanupMarpContent(content: string): string {
  let result = content.trim();
  // 兼容模型把结果夹在解释文本中的情况，优先提取第一个 Markdown/Marp 代码块
  const fenced = result.match(/```(?:markdown|md|marp)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) result = fenced[1].trim();
  // 兼容不同模型返回的代码块包裹格式，统一提取纯 Marp 文本
  result = result.replace(/^```(?:markdown|md|marp)?\s*/i, "");
  if (result.endsWith("```")) result = result.slice(0, -3).trimEnd();
  return result;
}

export function countMarpSlides(content: string): number {
  // frontmatter 会贡献开头的 --- 分隔，真正幻灯片页数按后续 --- 分页估算
  const separators = content.match(/^---\s*$/gm)?.length ?? 0;
  if (separators <= 1) return separators === 0 ? 0 : 1;
  return Math.max(1, separators - 1);
}

export function normalizeMarpContent(
  content: string,
  theme: string
): { content: string; warnings: string[]; errors: string[] } {
  let result = cleanupMarpContent(content);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!/^---\s*\n[\s\S]*?marp:\s*true/im.test(result)) {
    // 模型偶尔会漏掉 Marp frontmatter，这里自动补齐，避免导出阶段才失败
    result = `---\nmarp: true\ntheme: ${theme || "default"}\npaginate: true\n---\n\n${result}`;
    warnings.push("模型返回缺少 Marp 文件头，已自动补齐 frontmatter。");
  }

  const slideCount = countMarpSlides(result);
  if (slideCount < 4) {
    errors.push("模型没有生成完整幻灯片分页，只返回了零散内容；请重新转换或更换模型。");
  } else if (slideCount < 8) {
    warnings.push(`当前约 ${slideCount} 页，建议重新转换以获得更完整的演示文稿。`);
  }

  if (!/^#\s+/m.test(result)) {
    errors.push("模型返回内容缺少幻灯片标题，不像可直接导出的 PPT 源码。");
  }

  // 仅在代码块外出现裸 Mermaid 关键字时判定为错误，避免正文误伤
  const withoutFences = result.replace(/```[\s\S]*?```/g, "");
  if (
    /\b(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram)\b/i.test(withoutFences) &&
    !/```mermaid/i.test(result)
  ) {
    errors.push("检测到裸 Mermaid 图内容，但没有使用 ```mermaid 代码块包裹，Marp 渲染可能失败。");
  }

  return { content: result, warnings, errors };
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function getApiErrorField(err: unknown, field: string): unknown {
  if (!err || typeof err !== "object") return undefined;
  const record = err as Record<string, unknown>;
  if (record[field] !== undefined) return record[field];
  const nested = record.error;
  if (nested && typeof nested === "object") {
    return (nested as Record<string, unknown>)[field];
  }
  return undefined;
}

export function formatConvertError(err: unknown): string {
  const message = getErrorMessage(err);
  const status = getApiErrorField(err, "status") ?? getApiErrorField(err, "statusCode");
  const code = getApiErrorField(err, "code");
  const type = getApiErrorField(err, "type");
  const statusText = typeof status === "number" || typeof status === "string" ? String(status) : "";
  const codeText = typeof code === "string" ? code : "";
  const typeText = typeof type === "string" ? type : "";
  const meta = [statusText && `HTTP ${statusText}`, codeText && `code=${codeText}`, typeText && `type=${typeText}`]
    .filter(Boolean)
    .join(", ");
  const haystack = `${statusText} ${codeText} ${typeText} ${message}`;

  // 429 通常来自供应商侧限流或额度不足，优先提示用户检查账号和模型配额
  if (/429|rate.?limit|quota|insufficient_quota|too many requests/i.test(haystack)) {
    return `供应商返回 429：请求被限流或额度不足。请检查 API 余额/免费额度、模型权限、请求频率，或切换模型/供应商。原始错误：${message}${meta ? `（${meta}）` : ""}`;
  }
  if (/401|unauthorized|invalid.?api.?key/i.test(haystack)) {
    return `供应商认证失败：请检查 API Key、Base URL 和模型所属供应商是否匹配。原始错误：${message}${meta ? `（${meta}）` : ""}`;
  }
  if (/403|forbidden|permission/i.test(haystack)) {
    return `供应商拒绝访问：当前 API Key 可能没有该模型权限，或账号未开通对应服务。原始错误：${message}${meta ? `（${meta}）` : ""}`;
  }
  if (/failed to fetch|networkerror|cors|load failed/i.test(message)) {
    return `${message}。当前 Web 预览是浏览器直连接口，可能被供应商 CORS 策略拦截；请使用桌面 Electron 模式，或确认供应商允许浏览器跨域调用。`;
  }
  return meta ? `${message}（${meta}）` : message;
}
