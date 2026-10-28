import type { AppConfig, DescBlock, Person, Priority, RepoMapping, Run, TaskKind, ZTask } from "./types";
import { SCRIPTS, SCRIPT_CURRENCY, SCRIPT_EXPORT, SCRIPT_LOGIN, SCRIPT_PAGINATION, SCRIPT_TIMEOUT, genericScript } from "./scripts";
import { emptyRun, seedRun, applyStep } from "@/engine/run";
import { ago, inDays } from "@/lib/time";

export const ME = "me";

export const PEOPLE: Person[] = [
  { id: "me", name: "张明" },
  { id: "liqing", name: "李晴" },
  { id: "wanghao", name: "王浩" },
  { id: "chensy", name: "陈思远" },
  { id: "zhoulan", name: "周岚" },
  { id: "zhaoym", name: "赵一鸣" },
];
export const personName = (id: string) => PEOPLE.find((p) => p.id === id)?.name ?? id;

export const DEFAULT_MAPPINGS: RepoMapping[] = [
  { id: "m1", product: "企业管理后台", repo: "acme/web-console", localPath: "~/code/web-console", branch: "main", testCmd: "pnpm vitest run" },
  { id: "m2", product: "支付中心", repo: "acme/payment-service", localPath: "~/code/payment-service", branch: "main", testCmd: "go test ./..." },
  { id: "m3", product: "移动端 App", repo: "acme/mobile-app", localPath: "~/code/mobile-app", branch: "develop", testCmd: "pnpm jest" },
  { id: "m4", product: "开放平台", repo: "acme/open-api", localPath: "~/code/open-api", branch: "main", testCmd: "pytest -q" },
];

export const ZENTAO_PRODUCTS = ["企业管理后台", "支付中心", "移动端 App", "开放平台", "数据看板"];

export const DEFAULT_CONFIG: AppConfig = {
  zentao: { baseUrl: "https://zentao.acme.cn", edition: "biz", auth: "token", account: "zhangming", secret: "zt-demo-token", scope: "mine", connected: true },
  gitlab: { baseUrl: "https://gitlab.acme.cn", token: "glpat-demo-token-0000", targetBranch: "main", mrDraft: true, connected: true },
  codex: { cliPath: "", model: "Codex · 标准", sandbox: "workspace-write", concurrency: 3, connected: true },
  mappings: DEFAULT_MAPPINGS,
};

const repoOf = (product: string) => DEFAULT_MAPPINGS.find((m) => m.product === product)?.repo ?? "acme/web-console";

// ── 描述内容 ──────────────────────────────────────────────

function bugDesc(title: string, o?: { steps?: string[]; expected?: string; actual?: string; env?: string }): DescBlock[] {
  return [
    { type: "steps", title: "重现步骤", items: o?.steps ?? ["打开相关页面并登录", `执行与「${title.slice(0, 14)}」相关的操作`, "观察页面表现与控制台输出"] },
    { type: "p", title: "期望结果", text: o?.expected ?? "页面与数据表现符合预期，没有报错。" },
    { type: "p", title: "实际结果", text: o?.actual ?? `出现与标题一致的问题：${title}。` },
    { type: "kv", title: "环境", rows: [["版本", o?.env ?? "v3.8.2 (build 4172)"], ["浏览器 / 系统", "Chrome 126 / macOS 14"], ["复现率", "必现"]] },
  ];
}
function storyDesc(title: string, criteria?: string[]): DescBlock[] {
  return [
    { type: "p", title: "需求描述", text: `作为业务用户，我希望${title.replace(/^(.*)$/, "$1")}，以减少重复操作并降低出错概率。` },
    { type: "list", title: "验收标准", items: criteria ?? ["入口清晰，新增功能不影响现有流程", "边界条件有明确的提示", "新增逻辑有对应的自动化测试", "不引入新的后端接口（如需新增请先评审）"] },
    { type: "p", title: "备注", text: "已与产品、测试对齐范围，UI 稿见禅道附件。" },
  ];
}

// ── 构造任务 ──────────────────────────────────────────────

interface Seed {
  kind: TaskKind;
  no: number;
  title: string;
  priority: Priority;
  severity?: 1 | 2 | 3 | 4;
  product: string;
  module: string;
  moduleKey: string;
  assignee?: string;
  reporter?: string;
  ztStatus?: string;
  createdAgoMin: number;
  updatedAgoMin: number;
  deadlineDays?: number;
  labels?: string[];
  description?: DescBlock[];
  attachments?: { name: string; size: string }[];
  run?: Run;
}

function make(s: Seed): ZTask {
  const assignee = s.assignee ?? ME;
  const reporter = s.reporter ?? "liqing";
  return {
    id: `${s.kind}-${s.no}`,
    no: s.no,
    kind: s.kind,
    title: s.title,
    priority: s.priority,
    severity: s.severity,
    ztStatus: s.ztStatus ?? (s.kind === "bug" ? "激活" : "开发中"),
    product: s.product,
    module: s.module,
    moduleKey: s.moduleKey,
    sprint: "迭代 2026.10-B",
    assignee,
    reporter,
    createdAt: ago(s.createdAgoMin),
    updatedAt: ago(s.updatedAgoMin),
    deadline: s.deadlineDays != null ? inDays(s.deadlineDays) : undefined,
    repoId: repoOf(s.product),
    labels: s.labels ?? [],
    description: s.description ?? (s.kind === "bug" ? bugDesc(s.title) : storyDesc(s.title)),
    attachments: s.attachments ?? [],
    history: [
      { at: ago(s.createdAgoMin), who: personName(reporter), text: s.kind === "bug" ? "创建了 Bug" : "创建了需求" },
      { at: ago(s.createdAgoMin - 30), who: personName(reporter), text: `指派给 ${personName(assignee)}` },
    ],
    run: s.run ?? emptyRun(),
  };
}

function genericRun(task: Pick<ZTask, "kind" | "no" | "title" | "moduleKey" | "repoId">, upTo: number, state: Run["state"], extra?: Partial<Run>) {
  const script = genericScript(task);
  const run = seedRun(script, upTo, state);
  return { ...run, ...extra };
}

function withMr(run: Run, iid: number, ztTo: string, repo: string): Run {
  const at = (run.finishedAt ?? Date.now()) + 90_000;
  let r = applyStep(run, { delay: 0, ev: { kind: "system", text: `已创建 Merge Request !${iid}（草稿）`, tone: "success" } }, at);
  r = applyStep(r, { delay: 0, ev: { kind: "system", text: `已回写禅道：状态 → ${ztTo}`, tone: "success" } }, at + 4000);
  return { ...r, state: "done", mr: { iid, url: `https://gitlab.acme.cn/${repo}/-/merge_requests/${iid}` }, finishedAt: at + 4000 };
}

export function createInitialTasks(): ZTask[] {
  const tasks: ZTask[] = [];

  // 1. 登录跳转（待审核，完整故事线）
  tasks.push(
    make({
      kind: "bug", no: 3182, priority: 1, severity: 2, product: "企业管理后台", module: "认证", moduleKey: "auth",
      title: "登录成功后未跳转到原访问页面，始终回到首页",
      createdAgoMin: 60 * 26, updatedAgoMin: 9, deadlineDays: 1, labels: ["线上问题", "回归"],
      description: bugDesc("登录后丢失跳转", {
        steps: ["未登录状态下直接访问 /orders?page=3&status=paid", "被重定向到登录页，输入账号密码登录", "登录成功后观察跳转的地址"],
        expected: "登录后回到 /orders?page=3&status=paid，筛选条件保留。",
        actual: "登录后总是回到首页 /，需要手动重新进入订单列表并设置筛选。",
      }),
      attachments: [{ name: "登录后跳转.mov", size: "3.2 MB" }, { name: "network-redirect.har", size: "86 KB" }],
      run: seedRun(SCRIPT_LOGIN, SCRIPT_LOGIN.steps.length, "review"),
    }),
  );

  // 2. 订单分页（执行中）
  tasks.push(
    make({
      kind: "bug", no: 3190, priority: 2, severity: 2, product: "企业管理后台", module: "订单", moduleKey: "order",
      title: "订单列表翻到最后一页时出现重复数据",
      createdAgoMin: 60 * 20, updatedAgoMin: 1, deadlineDays: 2, labels: ["体验"],
      description: bugDesc("订单列表分页", {
        steps: ["进入「订单管理」，保持默认每页 20 条", "共 47 条数据时，翻到第 3 页", "对比第 2 页与第 3 页的前几条订单"],
        expected: "第 3 页只显示最后 7 条订单。",
        actual: "第 3 页显示 20 条，其中 13 条与第 2 页重复。",
      }),
      run: seedRun(SCRIPT_PAGINATION, 5, "running"),
    }),
  );

  // 3. 回调超时（失败）
  tasks.push(
    make({
      kind: "bug", no: 3197, priority: 1, severity: 1, product: "支付中心", module: "回调", moduleKey: "callback",
      title: "支付回调超时后订单状态未更新为「待确认」",
      createdAgoMin: 60 * 30, updatedAgoMin: 38, deadlineDays: 0, labels: ["线上问题", "资金"],
      description: bugDesc("支付回调超时", {
        steps: ["在预发环境把银行查询接口延迟调到 > 3s", "发起一笔支付并触发异步回调", "查看订单状态与对账任务日志"],
        expected: "订单保持「待确认」，由对账任务补偿。",
        actual: "订单被直接标记为「支付失败」，用户重复支付。",
        env: "payment-service v2.14.0",
      }),
      run: seedRun(SCRIPT_TIMEOUT, SCRIPT_TIMEOUT.steps.length, "failed"),
    }),
  );

  // 4. 金额格式（等待审批）
  tasks.push(
    make({
      kind: "bug", no: 3203, priority: 3, severity: 3, product: "支付中心", module: "账单", moduleKey: "billing",
      title: "金额在千分位与小数位显示不一致（¥1,0.5）",
      createdAgoMin: 60 * 14, updatedAgoMin: 3, deadlineDays: 4,
      description: bugDesc("金额显示", {
        steps: ["打开账单详情，金额为 ¥10.50 的一笔", "查看金额展示列", "再查看金额为 ¥1,234.56 的一笔"],
        expected: "¥10.50 与 ¥1,234.56。",
        actual: "显示为 ¥10,50 与 ¥1234,56。",
      }),
      run: seedRun(SCRIPT_CURRENCY, 7, "waiting"),
    }),
  );

  // 5. 订单导出（需求 · 执行中）
  tasks.push(
    make({
      kind: "story", no: 2041, priority: 2, product: "企业管理后台", module: "订单", moduleKey: "order",
      title: "订单导出支持自定义列与导出模板",
      createdAgoMin: 60 * 24 * 6, updatedAgoMin: 2, deadlineDays: 5, labels: ["运营诉求"], ztStatus: "开发中",
      description: storyDesc("在导出订单时自定义导出的列，并保存为模板", [
        "导出前可勾选需要的列，默认列为订单号、客户、金额、状态、下单时间",
        "可把当前选择保存为模板，下次导出默认使用上次的模板",
        "未选择任何列时不允许导出，并给出明确提示",
        "导出结果的表头与所选列一致",
      ]),
      attachments: [{ name: "导出列交互稿.fig", size: "1.1 MB" }],
      run: seedRun(SCRIPT_EXPORT, 4, "running"),
    }),
  );

  // 6. 暂停（移动端）
  {
    const base = { kind: "bug" as const, no: 3175, title: "移动端：下拉刷新后列表滚动位置丢失", moduleKey: "list", repoId: repoOf("移动端 App") };
    tasks.push(
      make({
        kind: "bug", no: 3175, priority: 3, severity: 3, product: "移动端 App", module: "列表", moduleKey: "list",
        title: base.title, createdAgoMin: 60 * 40, updatedAgoMin: 17, deadlineDays: 6,
        run: genericRun(base, 6, "paused"),
      }),
    );
  }

  // 7. 待审核（需求）
  {
    const base = { kind: "story" as const, no: 2038, title: "Webhook 事件支持按租户配置重试策略", moduleKey: "webhook", repoId: repoOf("开放平台") };
    tasks.push(
      make({
        kind: "story", no: 2038, priority: 2, product: "开放平台", module: "Webhook", moduleKey: "webhook",
        title: base.title, createdAgoMin: 60 * 24 * 9, updatedAgoMin: 55, deadlineDays: 3, labels: ["大客户"],
        run: genericRun(base, 12, "review"),
      }),
    );
  }

  // 8. 排队中
  {
    const base = { kind: "story" as const, no: 2057, title: "API 密钥支持过期时间与轮换提醒", moduleKey: "apikey", repoId: repoOf("开放平台") };
    const script = genericScript(base);
    tasks.push(
      make({
        kind: "story", no: 2057, priority: 2, product: "开放平台", module: "密钥", moduleKey: "apikey",
        title: base.title, createdAgoMin: 60 * 24 * 4, updatedAgoMin: 0, deadlineDays: 7,
        run: { ...emptyRun(), state: "queued", branch: script.branch, scriptId: script.id, patchKeys: script.patches, queue: script.steps, end: script.end, startedAt: Date.now() },
      }),
    );
  }

  // 9~11. 已提交
  {
    const b1 = { kind: "bug" as const, no: 3159, title: "退款金额超过原订单金额时未拦截", moduleKey: "refund", repoId: repoOf("支付中心") };
    tasks.push(
      make({
        kind: "bug", no: 3159, priority: 1, severity: 1, product: "支付中心", module: "退款", moduleKey: "refund",
        title: b1.title, assignee: "chensy", createdAgoMin: 60 * 24 * 3, updatedAgoMin: 60 * 5, ztStatus: "已解决",
        run: withMr(genericRun(b1, 12, "review"), 471, "已解决", b1.repoId),
      }),
    );
    const b2 = { kind: "bug" as const, no: 3149, title: "修改手机号后旧设备仍保持登录", moduleKey: "account", repoId: repoOf("企业管理后台") };
    tasks.push(
      make({
        kind: "bug", no: 3149, priority: 2, severity: 2, product: "企业管理后台", module: "账号", moduleKey: "account",
        title: b2.title, createdAgoMin: 60 * 24 * 5, updatedAgoMin: 60 * 22, ztStatus: "已解决",
        run: withMr(genericRun(b2, 12, "review"), 468, "已解决", b2.repoId),
      }),
    );
    const s1 = { kind: "story" as const, no: 2029, title: "对账单增加 CSV 下载", moduleKey: "statement", repoId: repoOf("支付中心") };
    tasks.push(
      make({
        kind: "story", no: 2029, priority: 3, product: "支付中心", module: "对账", moduleKey: "statement",
        title: s1.title, createdAgoMin: 60 * 24 * 12, updatedAgoMin: 60 * 24 * 2, ztStatus: "已完成",
        run: withMr(genericRun(s1, 12, "review"), 462, "已完成", s1.repoId),
      }),
    );
  }

  // 其余：待处理
  const idle: Seed[] = [
    { kind: "bug", no: 3211, priority: 2, severity: 3, product: "开放平台", module: "网关", moduleKey: "gateway", title: "开放平台 API 返回 429 时缺少 Retry-After 响应头", createdAgoMin: 60 * 8, updatedAgoMin: 60 * 3, deadlineDays: 3, labels: ["开发者反馈"] },
    { kind: "bug", no: 3168, priority: 3, severity: 3, product: "企业管理后台", module: "导出", moduleKey: "export", title: "导出 Excel 的中文文件名在 Safari 下乱码", assignee: "wanghao", createdAgoMin: 60 * 24 * 2, updatedAgoMin: 60 * 9 },
    { kind: "bug", no: 3216, priority: 4, severity: 4, product: "企业管理后台", module: "界面", moduleKey: "ui", title: "深色模式下表格选中行的文字对比度不足", createdAgoMin: 60 * 5, updatedAgoMin: 60 * 5, labels: ["无障碍"] },
    { kind: "bug", no: 3222, priority: 3, severity: 3, product: "企业管理后台", module: "用户", moduleKey: "user", title: "批量导入用户时，出现空行会导致整批失败", createdAgoMin: 60 * 7, updatedAgoMin: 60 * 4, deadlineDays: 5 },
    { kind: "bug", no: 3225, priority: 2, severity: 2, product: "移动端 App", module: "启动", moduleKey: "launch", title: "Android 8 以下设备启动白屏", assignee: "zhoulan", createdAgoMin: 60 * 24, updatedAgoMin: 60 * 12 },
    { kind: "bug", no: 3230, priority: 2, severity: 3, product: "支付中心", module: "营销", moduleKey: "coupon", title: "优惠券叠加规则在边界金额下计算错误", createdAgoMin: 60 * 3, updatedAgoMin: 60 * 2, deadlineDays: 2, labels: ["资金"] },
    { kind: "story", no: 2046, priority: 3, product: "支付中心", module: "收银台", moduleKey: "checkout", title: "支付结果页新增分期手续费明细", createdAgoMin: 60 * 24 * 5, updatedAgoMin: 60 * 26, ztStatus: "评审通过" },
    { kind: "story", no: 2052, priority: 4, product: "移动端 App", module: "设置", moduleKey: "settings", title: "设置页新增「通知偏好」分组", createdAgoMin: 60 * 24 * 7, updatedAgoMin: 60 * 24 * 2, ztStatus: "评审通过" },
    { kind: "story", no: 2033, priority: 3, product: "企业管理后台", module: "审计", moduleKey: "audit", title: "审计日志支持按操作人和时间范围筛选", assignee: "zhaoym", createdAgoMin: 60 * 24 * 10, updatedAgoMin: 60 * 24 * 3 },
    { kind: "story", no: 2060, priority: 4, product: "移动端 App", module: "订单", moduleKey: "share", title: "移动端订单详情支持分享海报", assignee: "liqing", createdAgoMin: 60 * 24 * 3, updatedAgoMin: 60 * 24 },
    { kind: "story", no: 2063, priority: 3, product: "企业管理后台", module: "首页", moduleKey: "home", title: "后台首页聚合展示待办入口", createdAgoMin: 60 * 24 * 2, updatedAgoMin: 60 * 15, ztStatus: "评审通过" },
  ];
  for (const s of idle) tasks.push(make(s));

  // 为尚未执行的任务预置脚本引用（点击「交给 Codex」时使用）
  return tasks.map((t) => {
    if (t.run.state === "idle") {
      const script = genericScript(t);
      return { ...t, run: { ...t.run, scriptId: script.id, branch: script.branch, patchKeys: script.patches, queue: script.steps, end: script.end } };
    }
    return t;
  });
}

export { SCRIPTS };
