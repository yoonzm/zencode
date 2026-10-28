import type { EventBody, Script, ScriptStep, ZTask } from "./types";
import { fillTemplate } from "@/lib/diff";

import loginRedirect from "./patches/login-redirect.patch";
import loginPage from "./patches/login-page.patch";
import loginTest from "./patches/login-test.patch";
import pagHook from "./patches/pag-hook.patch";
import pagList from "./patches/pag-list.patch";
import exportColumns from "./patches/export-columns.patch";
import exportDialog from "./patches/export-dialog.patch";
import exportMain from "./patches/export-main.patch";
import curFormat from "./patches/cur-format.patch";
import curTest from "./patches/cur-test.patch";
import toHandler from "./patches/to-handler.patch";
import toTest from "./patches/to-test.patch";
import genTs from "./patches/generic-ts.patch";
import genGo from "./patches/generic-go.patch";
import genPy from "./patches/generic-py.patch";

type Patches = Script["patches"];

const st = (ev: EventBody, delay = 1800, extra: Partial<ScriptStep> = {}): ScriptStep => ({ ev, delay, ...extra });
const edit = (patches: Patches, key: string, delay = 2000): ScriptStep => {
  const p = patches[key];
  return st({ kind: "edit", path: p.path, add: 0, del: 0, created: p.status === "added" }, delay, { patch: key });
};
const plan = (title: string, steps: string[], doneCount: number, delay = 600): ScriptStep =>
  st({ kind: "plan", title, steps: steps.map((text, i) => ({ text, done: i < doneCount })) }, delay);

// ───────────────────────────────────────────────────────────
// Bug：登录后丢失跳转地址（完整故事线，终态 review）
// ───────────────────────────────────────────────────────────
const loginPatches: Patches = {
  redirect: { path: "src/auth/redirect.ts", status: "modified", patch: loginRedirect },
  login: { path: "src/pages/login/LoginPage.tsx", status: "modified", patch: loginPage },
  test: { path: "src/auth/redirect.test.ts", status: "added", patch: loginTest },
};
const loginPlan = ["定位 redirect 参数丢失的位置", "修复参数传递并收紧跳转校验", "补充单元测试（含非法跳转地址）", "运行 auth 相关测试与类型检查"];
export const SCRIPT_LOGIN: Script = {
  id: "login",
  branch: "codex/bug-3182-login-redirect",
  patches: loginPatches,
  end: "review",
  steps: [
    st({ kind: "system", text: "已从 `main` 创建分支 `codex/bug-3182-login-redirect`", tone: "info" }, 600),
    st({ kind: "message", text: "我先阅读 Bug 描述和复现步骤。现象是登录成功后总回到首页，`redirect` 参数在某处丢了。我会先看路由守卫和登录页的跳转逻辑。" }, 1400),
    plan("修复计划", loginPlan, 0, 900),
    st({ kind: "read", paths: ["src/router/guards.ts", "src/pages/login/LoginPage.tsx", "src/auth/redirect.ts"] }, 1800),
    st({ kind: "message", text: "原因找到了：`buildLoginUrl` 对地址做了两次 `encodeURIComponent`，登录页读取时又解码了一次，带 `?` 的地址被截断，回退成首页。另外 `redirect` 没有校验，存在开放重定向风险，我一并收紧为只允许站内相对路径。" }, 2600),
    plan("修复计划", loginPlan, 1, 400),
    edit(loginPatches, "redirect", 2200),
    edit(loginPatches, "login", 1500),
    plan("修复计划", loginPlan, 2, 400),
    edit(loginPatches, "test", 2200),
    st(
      {
        kind: "command",
        cmd: "pnpm vitest run src/auth",
        exit: 0,
        ms: 1840,
        output: " ✓ src/auth/redirect.test.ts (5)\n   ✓ safeRedirect (4)\n   ✓ 登录往返 (1)\n ✓ src/auth/session.test.ts (7)\n\n Test Files  2 passed (2)\n      Tests  12 passed (12)\n   Duration  1.84s",
      },
      3200,
    ),
    st({ kind: "command", cmd: "pnpm tsc --noEmit", exit: 0, ms: 6120, output: "" }, 2400),
    st({ kind: "test", name: "src/auth", passed: 12, failed: 0, total: 12, note: "redirect.ts 覆盖率 94%" }, 700),
    plan("修复计划", loginPlan, 4, 400),
    st(
      {
        kind: "message",
        text: "已修复。改动 3 个文件：修正双重编码、新增 `safeRedirect` 白名单校验、补了 5 条用例。建议你重点看 `safeRedirect` 对协议相对地址（`//host`）的处理。可以创建 Merge Request，或继续追加要求。",
      },
      1600,
      { endState: "review" },
    ),
  ],
};

// ───────────────────────────────────────────────────────────
// Bug：订单列表最后一页重复（用于「执行中」）
// ───────────────────────────────────────────────────────────
const pagPatches: Patches = {
  hook: { path: "src/hooks/usePagination.ts", status: "modified", patch: pagHook },
  list: { path: "src/modules/order/OrderList.tsx", status: "modified", patch: pagList },
};
const pagPlan = ["复现最后一页重复的请求参数", "修正页数与偏移计算", "运行订单模块测试"];
export const SCRIPT_PAGINATION: Script = {
  id: "pagination",
  branch: "codex/bug-3190-order-pagination",
  patches: pagPatches,
  end: "review",
  steps: [
    st({ kind: "system", text: "已从 `main` 创建分支 `codex/bug-3190-order-pagination`", tone: "info" }, 600),
    st({ kind: "message", text: "Bug 说的是翻到最后一页会看到和上一页重复的订单。我先对比最后一页和倒数第二页的请求参数。" }, 1400),
    plan("修复计划", pagPlan, 0, 800),
    st({ kind: "read", paths: ["src/modules/order/OrderList.tsx", "src/hooks/usePagination.ts", "src/api/order.ts"] }, 1700),
    st({ kind: "message", text: "两处叠加造成的：`usePagination` 用 `Math.floor` 算页数，不整除时少算一页；`OrderList` 为了避免空白页，把最后一页的 offset 往前回退，于是和上一页重叠。两处都要改。" }, 2400),
    plan("修复计划", pagPlan, 1, 400),
    edit(pagPatches, "hook", 2000),
    edit(pagPatches, "list", 1600),
    plan("修复计划", pagPlan, 2, 400),
    st(
      {
        kind: "command",
        cmd: "pnpm vitest run src/modules/order src/hooks",
        exit: 0,
        ms: 2310,
        output: " ✓ src/hooks/usePagination.test.ts (6)\n ✓ src/modules/order/OrderList.test.tsx (9)\n\n Test Files  2 passed (2)\n      Tests  15 passed (15)\n   Duration  2.31s",
      },
      3000,
    ),
    st({ kind: "test", name: "src/modules/order · src/hooks", passed: 15, failed: 0, total: 15 }, 600),
    plan("修复计划", pagPlan, 3, 400),
    st({ kind: "message", text: "已修复最后一页重复的问题：页数改为向上取整，并去掉了 offset 回退。两个文件共改动 11 行，订单模块测试全部通过。" }, 1500, { endState: "review" }),
  ],
};

// ───────────────────────────────────────────────────────────
// 需求：订单导出支持自定义列
// ───────────────────────────────────────────────────────────
const exportPatches: Patches = {
  columns: { path: "src/modules/order/exportColumns.ts", status: "added", patch: exportColumns },
  dialog: { path: "src/modules/order/components/ExportTemplateDialog.tsx", status: "added", patch: exportDialog },
  main: { path: "src/modules/order/OrderExport.ts", status: "modified", patch: exportMain },
};
const exportPlan = ["梳理现有导出流程与列定义", "抽出列配置并支持按需选择", "新增「自定义导出列」对话框", "保存与复用导出模板", "补充测试并运行检查"];
export const SCRIPT_EXPORT: Script = {
  id: "export",
  branch: "codex/story-2041-order-export-columns",
  patches: exportPatches,
  end: "review",
  steps: [
    st({ kind: "system", text: "已从 `main` 创建分支 `codex/story-2041-order-export-columns`", tone: "info" }, 600),
    st({ kind: "message", text: "我先读需求。验收标准有 4 条：可选择导出列、可保存为模板、下次导出默认使用上次模板、列为空时不允许导出。" }, 1400),
    plan("实现计划", exportPlan, 0, 900),
    st({ kind: "read", paths: ["src/modules/order/OrderExport.ts", "src/modules/order/OrderToolbar.tsx", "src/components/ui/dialog.tsx"] }, 1800),
    st({ kind: "message", text: "方案：把列定义抽到 `exportColumns.ts`，导出函数按列 key 取值；新增一个对话框用复选框选择列。模板先保存在用户偏好里，复用现有的偏好接口，不新增后端字段。" }, 2600),
    plan("实现计划", exportPlan, 1, 400),
    edit(exportPatches, "columns", 2200),
    plan("实现计划", exportPlan, 2, 400),
    edit(exportPatches, "dialog", 2800),
    edit(exportPatches, "main", 1600),
    plan("实现计划", exportPlan, 4, 400),
    st({ kind: "command", cmd: "pnpm eslint src/modules/order --max-warnings 0", exit: 0, ms: 3480, output: "" }, 2800),
    st(
      {
        kind: "command",
        cmd: "pnpm vitest run src/modules/order",
        exit: 0,
        ms: 2650,
        output: " ✓ src/modules/order/exportColumns.test.ts (4)\n ✓ src/modules/order/OrderExport.test.ts (3)\n\n Test Files  2 passed (2)\n      Tests  7 passed (7)",
      },
      2600,
    ),
    st({ kind: "test", name: "src/modules/order", passed: 7, failed: 0, total: 7 }, 600),
    plan("实现计划", exportPlan, 5, 400),
    st({ kind: "message", text: "已实现自定义导出列：新增列配置与对话框，导出函数支持按列输出。「保存为模板」目前写入用户偏好，验收标准第 3 条的“默认使用上次模板”还需要在工具栏初始化时读取，我留了 `TODO`，需要你确认是否放进本需求。" }, 1800, { endState: "review" }),
  ],
};

// ───────────────────────────────────────────────────────────
// Bug：金额格式化（含一次审批）
// ───────────────────────────────────────────────────────────
const curPatches: Patches = {
  format: { path: "internal/billing/format.go", status: "modified", patch: curFormat },
  test: { path: "internal/billing/format_test.go", status: "modified", patch: curTest },
};
export const SCRIPT_CURRENCY: Script = {
  id: "currency",
  branch: "codex/bug-3203-money-format",
  patches: curPatches,
  end: "review",
  steps: [
    st({ kind: "system", text: "已从 `main` 创建分支 `codex/bug-3203-money-format`", tone: "info" }, 600),
    st({ kind: "message", text: "现象是 `¥1,0.5` 这类金额：逗号位置不对，小数位也没补零。先看格式化函数和已有测试。" }, 1300),
    st({ kind: "read", paths: ["internal/billing/format.go", "internal/billing/format_test.go"] }, 1500),
    st({ kind: "message", text: "`FormatYuan` 直接把元和分用逗号拼起来了，而且分没有补零，负数也会出错。我会改成千分位分组加固定两位小数，并补上边界用例（0、个位分、百万级、负数）。" }, 2200),
    edit(curPatches, "format", 2200),
    edit(curPatches, "test", 1600),
    st({ kind: "approval", cmd: "go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest", reason: "仓库的 CI 使用 golangci-lint，本机没有安装。需要联网下载并安装；沙盒默认禁止网络访问。" }, 1500),
    st(
      { kind: "command", cmd: "golangci-lint run ./internal/billing/...", exit: 0, ms: 4200, output: "" },
      2600,
      { onlyIfApproved: true },
    ),
    st({ kind: "command", cmd: "go test ./internal/billing/... -count=1", exit: 0, ms: 980, output: "ok  \tacme/payment-service/internal/billing\t0.412s" }, 2200),
    st({ kind: "test", name: "internal/billing", passed: 11, failed: 0, total: 11 }, 600),
    st({ kind: "message", text: "已修复金额格式化，并补了 5 条边界用例，`internal/billing` 测试全部通过。如果上面没有 lint 记录，说明安装被拒绝，lint 没有运行，合并前请让 CI 补跑。" }, 1500, { endState: "review" }),
  ],
};

// ───────────────────────────────────────────────────────────
// Bug：支付回调超时（失败 → 可重试）
// ───────────────────────────────────────────────────────────
const toPatches: Patches = {
  handler: { path: "internal/callback/handler.go", status: "modified", patch: toHandler },
  test: { path: "internal/callback/handler_test.go", status: "modified", patch: toTest },
};
export const SCRIPT_TIMEOUT: Script = {
  id: "timeout",
  branch: "codex/bug-3197-callback-timeout",
  patches: toPatches,
  end: "failed",
  steps: [
    st({ kind: "system", text: "已从 `main` 创建分支 `codex/bug-3197-callback-timeout`", tone: "info" }, 600),
    st({ kind: "message", text: "银行侧查询超时后订单被直接置为失败，应该保持「待确认」交给对账任务补偿。先看回调处理和现有测试替身。" }, 1300),
    st({ kind: "read", paths: ["internal/callback/handler.go", "internal/callback/handler_test.go", "internal/testutil/fakebank.go"] }, 1700),
    st({ kind: "message", text: "`HandleCallback` 没有给银行查询加超时，也没有区分超时和其他错误。我给查询加 `context.WithTimeout`，超时则把订单置为待确认并记录告警。" }, 2300),
    edit(toPatches, "handler", 2200),
    st(
      {
        kind: "command",
        cmd: "go test ./internal/callback/... -run TestHandleCallback -count=1",
        exit: 1,
        ms: 2134,
        output:
          "--- FAIL: TestHandleCallbackTimeout (2.01s)\n    handler_test.go:58:\n        Error:      Not equal:\n                    expected: \"PENDING_CONFIRM\"\n                    actual  : \"PAID\"\n        Messages:   超时后订单应保持待确认\nFAIL\nFAIL\tacme/payment-service/internal/callback\t2.134s\nFAIL",
      },
      3000,
    ),
    st({ kind: "error", text: "测试未通过：TestHandleCallbackTimeout", detail: "超时后订单状态是 PAID，期望 PENDING_CONFIRM。测试替身 FakeBank.Query 忽略了 context 取消。" }, 600),
    st(
      {
        kind: "message",
        text: "失败原因在测试替身：`internal/testutil/fakebank.go` 的 `Query` 不响应 ctx 取消，所以超时分支走不到。这个目录在仓库映射里被标记为受保护路径，我无权修改。建议在测试内注入一个可取消的 fake，不动 testutil。点「重试」我就按这个方案继续。",
      },
      1600,
      { endState: "failed" },
    ),
  ],
  retry: [
    st({ kind: "system", text: "已重试：沿用分支 `codex/bug-3197-callback-timeout`", tone: "info" }, 600),
    st({ kind: "message", text: "按建议在测试里注入会响应 ctx 取消的 `slowBank`，不改 `internal/testutil`。" }, 1300),
    edit(toPatches, "test", 2400),
    st({ kind: "command", cmd: "go test ./internal/callback/... -count=1", exit: 0, ms: 1260, output: "ok  \tacme/payment-service/internal/callback\t0.538s" }, 2800),
    st({ kind: "test", name: "internal/callback", passed: 9, failed: 0, total: 9 }, 600),
    st({ kind: "message", text: "已修复：银行查询超时后订单保持待确认，不再误判为失败。新增 1 条超时用例，回调包测试全部通过。" }, 1500, { endState: "review" }),
  ],
};

// ───────────────────────────────────────────────────────────
// 通用脚本：其余任务按语言与模块生成
// ───────────────────────────────────────────────────────────
export type Lang = "ts" | "go" | "py";

export function langOfRepo(repoId: string): Lang {
  if (repoId.includes("payment")) return "go";
  if (repoId.includes("open-api")) return "py";
  return "ts";
}

export function genericScript(task: Pick<ZTask, "kind" | "no" | "title" | "moduleKey" | "repoId">): Script {
  const mk = task.moduleKey;
  const Mod = mk.charAt(0).toUpperCase() + mk.slice(1);
  const lang = langOfRepo(task.repoId);
  const slug = `${task.kind === "bug" ? "bug" : "story"}-${task.no}-${mk}`;
  const cfg = {
    ts: { read: [`src/modules/${mk}/index.ts`, `src/modules/${mk}/use${Mod}List.ts`], path: `src/modules/${mk}/use${Mod}List.ts`, cmd: `pnpm vitest run src/modules/${mk}`, patch: genTs, out: ` ✓ src/modules/${mk}/use${Mod}List.test.ts (6)\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)` },
    go: { read: [`internal/${mk}/service.go`, `internal/${mk}/service_test.go`], path: `internal/${mk}/service.go`, cmd: `go test ./internal/${mk}/... -count=1`, patch: genGo, out: `ok  \tacme/payment-service/internal/${mk}\t0.388s` },
    py: { read: [`app/${mk}/handler.py`, `tests/test_${mk}.py`], path: `app/${mk}/handler.py`, cmd: `pytest tests/test_${mk}.py -q`, patch: genPy, out: `.......                                                                  [100%]\n7 passed in 0.41s` },
  }[lang];
  const patches: Patches = { main: { path: cfg.path, status: "modified", patch: fillTemplate(cfg.patch, mk) } };
  const p = ["定位相关代码", "实现修改", "运行测试"];
  const intro =
    task.kind === "bug"
      ? `我先阅读「${task.title}」的描述与复现步骤，然后在 \`${mk}\` 模块里定位相关代码。`
      : `我先阅读需求「${task.title}」的验收标准，然后梳理 \`${mk}\` 模块的改动范围。`;
  return {
    id: `generic-${slug}`,
    branch: `codex/${slug}`,
    patches,
    end: "review",
    steps: [
      st({ kind: "system", text: `已从 \`main\` 创建分支 \`codex/${slug}\``, tone: "info" }, 600),
      st({ kind: "message", text: intro }, 1400),
      plan("执行计划", p, 0, 700),
      st({ kind: "read", paths: cfg.read }, 1700),
      st({ kind: "message", text: `找到相关逻辑了，改动集中在 \`${cfg.path}\`，范围不大，不需要动公共接口。` }, 2200),
      plan("执行计划", p, 1, 400),
      edit(patches, "main", 2200),
      plan("执行计划", p, 2, 400),
      st({ kind: "command", cmd: cfg.cmd, exit: 0, ms: 2100, output: cfg.out }, 2800),
      st({ kind: "test", name: `${mk}`, passed: 6, failed: 0, total: 6 }, 600),
      plan("执行计划", p, 3, 400),
      st({ kind: "message", text: "已完成修改并通过相关测试，改动范围见「变更」。可以创建 Merge Request，或继续追加要求。" }, 1500, { endState: "review" }),
    ],
  };
}

export const SCRIPTS: Record<string, Script> = {
  login: SCRIPT_LOGIN,
  pagination: SCRIPT_PAGINATION,
  export: SCRIPT_EXPORT,
  currency: SCRIPT_CURRENCY,
  timeout: SCRIPT_TIMEOUT,
};

/** 追加指令后插入的步骤 */
export function followupSteps(text: string, basePath: string | undefined): { steps: ScriptStep[]; patches: Patches } {
  const short = text.length > 28 ? text.slice(0, 28) + "…" : text;
  const testPath = basePath ? basePath.replace(/\.(\w+)$/, ".extra.$1") : "src/followup.test.ts";
  const patches: Patches = {
    followup: {
      path: testPath,
      status: "added",
      patch: `@@ -0,0 +1,9 @@\n+// 追加指令：${short.replace(/\n/g, " ")}\n+import { describe, expect, it } from "vitest";\n+\n+describe("追加用例", () => {\n+  it("覆盖追加指令里提到的边界情况", () => {\n+    expect(true).toBe(true);\n+  });\n+});\n`,
    },
  };
  return {
    patches,
    steps: [
      st({ kind: "message", text: `收到追加指令：「${short}」。我会在当前步骤完成后处理。` }, 900),
      st({ kind: "plan", title: "追加处理", steps: [{ text: "按追加指令调整实现", done: false }, { text: "重新运行相关测试", done: false }] }, 700),
      edit(patches, "followup", 2200),
      st({ kind: "plan", title: "追加处理", steps: [{ text: "按追加指令调整实现", done: true }, { text: "重新运行相关测试", done: false }] }, 400),
      st({ kind: "command", cmd: "pnpm vitest run --changed", exit: 0, ms: 1520, output: " ✓ 3 个测试文件，共 14 个用例通过\n   Duration  1.52s" }, 2400),
      st({ kind: "plan", title: "追加处理", steps: [{ text: "按追加指令调整实现", done: true }, { text: "重新运行相关测试", done: true }] }, 400),
      st({ kind: "message", text: "已按追加指令处理，并重新跑了受影响的测试，全部通过。" }, 1300, { endState: "review" }),
    ],
  };
}
