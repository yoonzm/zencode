import { toast } from "@/store/toast";

/** 复制文本；沙盒或旧环境可能拒绝，失败时给出明确提示 */
export async function copyText(text: string, label = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: label, desc: text.length > 60 ? text.slice(0, 60) + "…" : text, tone: "success", duration: 2200 });
  } catch {
    toast({ title: "无法写入剪贴板", desc: "请手动选中文字后复制。", tone: "warn", duration: 3000 });
  }
}
