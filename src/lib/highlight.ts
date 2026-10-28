import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import go from "highlight.js/lib/languages/go";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("go", go);
hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);

export function langOf(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs"].includes(ext)) return "typescript";
  if (ext === "go") return "go";
  if (ext === "py") return "python";
  if (ext === "json") return "json";
  if (ext === "css") return "css";
  if (["sh", "bash"].includes(ext)) return "bash";
  if (["yml", "yaml"].includes(ext)) return "yaml";
  return null;
}

const cache = new Map<string, string>();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 单行高亮，返回已转义的 HTML。结果缓存，避免重复计算。 */
export function highlightLine(lang: string | null, text: string): string {
  if (!lang || !text.trim()) return esc(text);
  const key = lang + "\u0000" + text;
  const hit = cache.get(key);
  if (hit != null) return hit;
  let out: string;
  try {
    out = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    out = esc(text);
  }
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}
