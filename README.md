# ZenCode 桌面应用 UI（Mock 原型）

React + TypeScript + Tailwind CSS 4。所有数据为本地模拟，没有后端。

## 构建
`node build.mjs` → `dist/index.html`（单文件，可直接打开或托管）。
构建脚本用 Tailwind 4 的 JS `compile()` 加 esbuild，不依赖 CLI。

## 路由（hash）
`#tasks` · `#task-<id>` · `#setup` · `#prefs` · `#prefs-<zentao|gitlab|codex|repos|notifications|shortcuts|advanced|about>`

## 快捷键
⌘/Ctrl+K 命令面板 · ⌘/Ctrl+B 侧边栏 · ⌘/Ctrl+, 设置 · ⌘/Ctrl+Shift+L 切换主题 · ? 快捷键列表

## 与需求栈的差异（构建环境无法访问 npm）
| 需求 | 实际使用 | 换回方式 |
|---|---|---|
| shadcn/ui、HeroUI | Headless UI + cva 手写的 shadcn 风格组件（`src/components/ui`） | 用 shadcn CLI 生成同名组件替换 |
| Magic UI | `src/components/magic/effects.tsx` 手写的 Beam / Shimmer / DotPattern | 换成 Magic UI 同名组件 |
| Motion | CSS 动画与过渡 | 在需要的地方换 `motion.div` |
| lucide-react | `react-icons/lu`（同一套 Lucide 字形），统一从 `src/lib/icons.ts` 导出 | 改写该文件为 `export {...} from "lucide-react"` |
| zustand / cmdk | `useSyncExternalStore` 小 store、自写命令面板 | 按需替换 |
