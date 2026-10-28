// ZenCode 构建脚本：Tailwind CSS 4（JS 编译 API）+ esbuild → 单文件 HTML。
// 用法：node build.mjs            生产构建，输出 dist/index.html
//       node build.mjs --watch    监听（仅重建，不带服务器）
import { compile } from "tailwindcss";
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "src");
const twRoot = path.join(root, "node_modules", "tailwindcss");

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(tsx?|html|css)$/.test(f.name)) out.push(p);
  }
  return out;
}

async function buildCss() {
  const dark = fs.readFileSync(path.join(src, "styles/dark.css"), "utf8");
  let css = fs.readFileSync(path.join(src, "styles/app.css"), "utf8");
  // 深色令牌在三处复用：系统深色、显式深色、强制预览作用域
  css = css
    .replace("/*@DARK_MEDIA@*/", `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}color-scheme:dark;}}`)
    .replace("/*@DARK_ATTR@*/", `:root[data-theme="dark"]{${dark}color-scheme:dark;}`)
    .replace("/*@DARK_SCOPE@*/", `.theme-dark{${dark}color-scheme:dark;}`);

  const compiler = await compile(css, {
    base: root,
    loadStylesheet: async (id, base) => {
      let p;
      if (id === "tailwindcss") p = path.join(twRoot, "index.css");
      else if (id.startsWith("tailwindcss/")) p = path.join(twRoot, id.slice("tailwindcss/".length));
      else p = path.resolve(base, id);
      return { path: p, base: path.dirname(p), content: fs.readFileSync(p, "utf8") };
    },
  });

  // 宽松提取候选类名；无效候选会被 Tailwind 忽略
  const cands = new Set();
  for (const f of walk(src)) {
    if (f.endsWith(".css")) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/[^\s"'`;{}<>,]+/g)) cands.add(m[0]);
  }
  const raw = compiler.build([...cands]);
  const min = await esbuild.transform(raw, { loader: "css", minify: true, target: ["chrome111","safari16.4","firefox115"] });
  return min.code;
}

async function buildJs() {
  const r = await esbuild.build({
    entryPoints: [path.join(src, "main.tsx")],
    bundle: true,
    write: false,
    minify: true,
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    loader: { ".patch": "text" },
    alias: { "@": src },
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
    metafile: true,
  });
  return { code: r.outputFiles[0].text, meta: r.metafile };
}

async function main() {
  const t0 = Date.now();
  const [css, js] = await Promise.all([buildCss(), buildJs()]);
  const tpl = fs.readFileSync(path.join(src, "index.html"), "utf8");
  const html = tpl
    .replace("/*@CSS@*/", () => css)
    .replace("/*@JS@*/", () => js.code.replace(/<\/script/gi, "<\\/script"));
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/index.html"), html);
  const kb = (n) => (n / 1024).toFixed(1) + " KB";
  console.log(`built in ${Date.now() - t0}ms · css ${kb(css.length)} · js ${kb(js.code.length)} · html ${kb(html.length)}`);
}

await main();
