import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { X } from "@/lib/icons";
import { ImagePreview } from "./image-preview";

const LIMIT = 4;
const MAX_SIZE = 5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function readImage(file: File): Promise<string> {
  if (!TYPES.includes(file.type)) return Promise.reject(new Error("仅支持 PNG、JPEG、WebP 和 GIF 图片"));
  if (!file.size || file.size > MAX_SIZE) return Promise.reject(new Error("每张图片需小于 5 MB，且不能为空"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败，请重新粘贴"));
    reader.onabort = () => reject(new Error("图片读取已取消"));
    reader.readAsDataURL(file);
  });
}

export function useImagePaste(scope: string | boolean) {
  const [images, setImages] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(Promise.resolve());
  const current = useRef<string[]>([]);
  const clear = () => {
    generation.current++;
    current.current = [];
    pending.current = Promise.resolve();
    setImages([]); setError(""); setReading(false);
  };
  useEffect(() => { clear(); return () => { generation.current++; }; }, [scope]);
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    const token = generation.current;
    setReading(true); setError("");
    pending.current = pending.current.then(async () => {
      if (token !== generation.current) return;
      try {
        if (current.current.length + files.length > LIMIT) throw new Error("每次最多附加 4 张图片，请先移除部分图片");
        const urls = await Promise.all(files.map(readImage));
        if (token !== generation.current) return;
        current.current = [...current.current, ...urls];
        setImages(current.current);
      } catch (error) {
        if (token === generation.current) setError(String(error instanceof Error ? error.message : error));
      }
    });
    const latest = pending.current;
    void latest.then(() => { if (token === generation.current && pending.current === latest) setReading(false); });
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    // Leave the default text paste intact when the clipboard contains both text and images.
    addFiles(Array.from(event.clipboardData.items)
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile()).filter((file): file is File => file !== null));
  };
  const remove = (index: number) => {
    current.current = current.current.filter((_, i) => i !== index);
    setImages(current.current); setError("");
  };
  return { images, reading, error, onPaste, addFiles, clear, remove };
}

export function ImagePreviews({ images, remove, disabled }: { images: string[]; remove?: (index: number) => void; disabled?: boolean }) {
  const [preview, setPreview] = useState<number | null>(null);
  const slides = useMemo(() => images.map((src, i) => ({ id: `attachment-${i}`, src, label: `附加图片 ${i + 1}` })), [images]);
  if (!images.length) return null;
  return <><ul aria-label="附加图片" className="flex flex-wrap gap-2">
    {images.map((url, i) => <li key={i} className="relative rounded-lg border border-border bg-muted p-1">
      <button type="button" onClick={() => setPreview(i)} aria-label={`查看图片 ${i + 1}`} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"><img src={url} alt={`附加图片 ${i + 1}`} className="size-20 rounded-md object-contain" /></button>
      {remove && <button type="button" disabled={disabled} onClick={() => remove(i)} aria-label={`移除图片 ${i + 1}`} className="absolute -right-1 -top-1 grid size-6 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50"><X className="size-3.5" /></button>}
    </li>)}
  </ul><ImagePreview images={slides} index={preview} onIndexChange={setPreview} onClose={() => setPreview(null)} /></>;
}
