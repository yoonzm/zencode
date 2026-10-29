<div align="center">

<img src="docs/screenshots/logo.png" width="96" alt="ZenCode logo" />

# ZenCode

**从禅道 Bug 到 GitLab 合并请求：Codex 写代码，你来把关。**

[English](README.md) · 简体中文

[下载安装](https://github.com/yoonzm/zencode/releases) · [技术说明](docs/technical-notes.md) · [反馈问题](https://github.com/yoonzm/zencode/issues)

![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-core-000000?logo=rust)
![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS-supported-555)

</div>

ZenCode 是一款桌面应用，把分配给你的[禅道](https://www.zentao.net/) Bug 和需求变成经过你审核的 GitLab 合并请求（MR）。它自动同步任务，交给 [Codex CLI](https://github.com/openai/codex) 在隔离的代码副本中处理，全程可见：命令由你审批，改动由你审阅，确认后才提交 MR。

<p align="center">
  <img src="docs/screenshots/execution.png" alt="任务列表与 Codex 实时执行时间线" width="880" />
</p>

> 截图为演示数据。

## 功能特性

- **自动同步**：定时拉取分配给你（或整个产品）的禅道 Bug 与需求，新任务可自动开始执行。
- **隔离执行**：每个任务独立克隆到专属目录和分支，不会碰你本地的工作副本。
- **实时时间线**：查看 Codex 的计划、读取文件、命令、修改与测试结果；可随时暂停、继续或追加指令。
- **人在回路**：命令与文件操作由你选择「允许一次 / 始终允许 / 拒绝」；点击**创建 Merge Request** 之前不会推送任何代码。
- **真实 Diff 审阅**：统一或并排视图，逐文件标记「已查看」，不满意可要求修改。
- **自动验证**：Codex 生成测试计划并执行（界面、API 或命令行检查），证据附在任务上。
- **多仓库映射**：一个产品可对应多个 GitLab 项目（前端、后端、微服务），各自拥有分支、测试命令、审阅和 MR。
- **AI 匹配**：依据真实的任务与提交记录，推荐禅道产品与 GitLab 仓库的对应关系。
- **手动新增需求**：粘贴任意文本，由 Codex 整理成任务后导入。
- **安全可靠**：凭据存放在系统钥匙串，禅道只读，更新包经签名校验。

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/review.png" alt="变更审阅" /></td>
    <td width="50%"><img src="docs/screenshots/verification.png" alt="自动验证" /></td>
  </tr>
  <tr>
    <td align="center"><b>审阅变更</b></td>
    <td align="center"><b>验证修复</b></td>
  </tr>
</table>

## 工作流程

```
禅道  ──同步──▶  ZenCode  ──隔离克隆──▶  Codex CLI
                    │                        │
                    │◀──── 事件 · 审批 ──────┘
                    ▼
             你审阅 Diff  ──▶  GitLab Merge Request
```

## 快速开始

**安装**：在 [Releases](https://github.com/yoonzm/zencode/releases) 下载 Windows `.exe` 或 macOS `.dmg`（Apple 芯片 / Intel），macOS 需 13.3 及以上。

**配置**

1. 安装 [Codex CLI](https://github.com/openai/codex) 并执行 `codex login`。
2. 打开 ZenCode，连接禅道（REST v1，令牌或密码）和 GitLab（个人访问令牌）。
3. 将每个禅道产品映射到一个或多个 GitLab 项目及目标分支。
4. 同步后任务出现在列表中，Codex 开始工作。

Git 推送使用你本机的 SSH 密钥 / 凭据助手。

## 从源码构建

需要 Node.js 24、稳定版 Rust、Git 以及 [Tauri 依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm ci
npm start          # 开发模式运行桌面应用
npm test           # Rust 核心与前端测试
npm run package    # 构建安装包
```

## 项目状态

ZenCode 仍在积极开发中。真实禅道/GitLab 环境及 Windows/macOS 原生交互仍需进一步验证；暂不支持 Linux 凭据存储。运行细节、发布流程与验证范围见[技术说明](docs/technical-notes.md)。

## 致谢

界面基于 [yoonzm/zencode-ui](https://github.com/yoonzm/zencode-ui)，使用 [Tauri](https://tauri.app/)、[React](https://react.dev/)、[Tailwind CSS](https://tailwindcss.com/)、[Radix UI](https://www.radix-ui.com/) 和 [HeroUI](https://www.heroui.com/) 构建。
