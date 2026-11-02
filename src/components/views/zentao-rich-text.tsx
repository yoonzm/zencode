import { createElement, useEffect, useMemo, useState, type ReactNode } from "react";
import { desktopCall } from "@/lib/desktop";
import { store, useApp } from "@/store/state";
import { openExternal } from "@/store/actions";
import { Modal } from "@/components/ui/dialog";

function ZentaoImage({ taskId, source, alt }: { taskId: string; source: string; alt: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    let active = true;
    setUrl(""); setError(""); setPreview(false);
    void desktopCall("zentaoImage", { id: taskId, src: source, config: store.get().config }).then(result => {
      if (typeof result !== "string" || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(result)) throw new Error("图片响应无效");
      if (active) setUrl(result);
    }).catch(error => { if (active) setError(String(error instanceof Error ? error.message : error)); });
    return () => { active = false; };
  }, [taskId, source, attempt]);
  return <span className="my-2 block min-w-0 max-w-full">
    {error ? <span className="block rounded-md border border-border bg-muted/40 p-2 text-xs">
      <span role="alert" className="block break-words text-danger">图片加载失败：{error}</span>
      <button type="button" onClick={() => setAttempt(n => n + 1)} className="mt-1 rounded-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">重试图片</button>
    </span> : url ? <button type="button" onClick={() => setPreview(true)} aria-label={`放大图片：${alt}`} className="block max-w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      <img src={url} alt={alt} onError={() => setError("图片内容无法显示")} className="max-h-80 max-w-full rounded-md border border-border object-contain" />
    </button> : <span role="status" className="grid min-h-20 place-items-center rounded-md border border-border bg-muted/40 px-3 text-xs text-muted-foreground">正在加载图片…</span>}
    <Modal open={preview} onClose={() => setPreview(false)} title="禅道图片" size="lg" className="sm:max-w-4xl">{url && <img src={url} alt={alt} className="mx-auto max-h-[75vh] max-w-full object-contain" />}</Modal>
  </span>;
}

const CLASSES: Record<string, string> = {
  p: "my-1 min-h-[1em]", div: "my-1", ul: "my-2 list-disc space-y-1 pl-5", ol: "my-2 list-decimal space-y-1 pl-5",
  blockquote: "my-2 border-l-2 border-border pl-3 text-muted-foreground", pre: "my-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap", code: "rounded-sm bg-muted px-1 font-mono text-[0.92em]",
  table: "w-full border-collapse text-left", th: "border border-border p-2 font-semibold", td: "border border-border p-2 align-top",
  h1: "my-2 text-base font-semibold", h2: "my-2 text-base font-semibold", h3: "my-2 font-semibold", h4: "my-2 font-semibold", h5: "my-2 font-semibold", h6: "my-2 font-semibold",
};
const ALLOWED = new Set(["p", "div", "span", "br", "strong", "b", "em", "i", "u", "s", "del", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "sub", "sup"]);
const OMIT = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "form", "input", "textarea", "select", "button", "link", "meta", "base", "audio", "video"]);

/** Rebuild a small HTML subset as React elements; never insert source HTML or its attributes. */
export function ZentaoRichText({ html, taskId }: { html: string; taskId: string }) {
  const baseUrl = useApp(s => s.config.zentao.baseUrl);
  const content = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const render = (node: Node, key: string): ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const element = node as Element, tag = element.tagName.toLowerCase();
      if (OMIT.has(tag)) return null;
      if (tag === "img") {
        const source = element.getAttribute("src");
        return source ? <ZentaoImage key={key} taskId={taskId} source={source} alt={element.getAttribute("alt") || "禅道原文图片"} /> : null;
      }
      const children = Array.from(element.childNodes).map((child, i) => render(child, `${key}-${i}`));
      if (tag === "a") {
        if (element.querySelector("img")) return children;
        try {
          const url = new URL(element.getAttribute("href") || "", `${baseUrl.replace(/\/$/, "")}/`);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return children;
          return <button key={key} type="button" onClick={() => openExternal(url.href)} className="inline break-all text-left text-accent underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{children}</button>;
        } catch { return children; }
      }
      if (!ALLOWED.has(tag)) return children;
      const result = createElement(tag, { key, className: CLASSES[tag] }, ...(tag === "br" || tag === "hr" ? [] : children));
      return tag === "table" ? <div key={key} className="my-2 max-w-full overflow-x-auto">{result}</div> : result;
    };
    return Array.from(template.content.childNodes).map((node, i) => render(node, String(i)));
  }, [html, taskId, baseUrl]);
  return <div className="min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{content}</div>;
}
