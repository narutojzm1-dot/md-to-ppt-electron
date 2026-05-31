import { chromium } from "playwright";

const appUrl = "http://localhost:5173/";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 用无头浏览器模拟用户操作，覆盖页面加载、上传文件、转换错误反馈等关键体验
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleMessages = [];
page.on("console", (msg) => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => consoleMessages.push(`pageerror: ${err.message}`));

await page.goto(appUrl, { waitUntil: "networkidle" });

await assertText("MD to PPT");
await assertText("供应商配置");
await assertText("Markdown 输入");
await assertText("Marp 源码输出");

await page.locator('input[type="file"]').setInputFiles({
  name: "qa-smoke.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(`# 测试文档

## 背景
- 这是一次 UI 冒烟测试
- 目标是验证转换过程的状态反馈

## 结论
- 页面需要展示进度
- 失败需要展示可读错误
`),
});

await assertText("qa-smoke.md");

await page.locator('input[type="password"]').fill("sk-test-invalid-key");
const textInputs = page.locator('input[type="text"]');
await textInputs.nth(0).fill("https://example.invalid/v1");
await textInputs.nth(1).fill("test-model");

await page.getByRole("button", { name: /一键转换为 Marp PPT/ }).click();
await assertText("转换进度");
await assertText(/正在通过浏览器请求 AI|正在通过 Electron 主进程请求 AI/);

await page.waitForFunction(() => document.body.innerText.includes("转换失败"), null, { timeout: 20000 });
await assertText("转换失败");

const bodyText = await page.locator("body").innerText();
const hasReadableFailure = /CORS|浏览器|Failed to fetch|转换失败|供应商/.test(bodyText);
assert(hasReadableFailure, "转换失败后没有显示可读的错误原因");

await page.screenshot({ path: "/tmp/md-to-ppt-ui-smoke-test.png", fullPage: true });

console.log(JSON.stringify({
  ok: true,
  checked: [
    "页面可加载",
    "三栏核心 UI 可见",
    "Markdown 文件可上传",
    "转换进度面板可见",
    "转换失败详情可见",
  ],
  consoleMessages,
}, null, 2));

await browser.close();

async function assertText(textOrRegex) {
  const locator = typeof textOrRegex === "string"
    ? page.getByText(textOrRegex, { exact: false })
    : page.getByText(textOrRegex);
  await locator.first().waitFor({ state: "visible", timeout: 10000 });
}
