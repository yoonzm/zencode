import { useEffect, useMemo, useRef, useState } from "react";
import Lightbox, { type SlideImage, type ZoomRef } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

export interface PreviewImage {
  id: string;
  label: string;
  src?: string;
  failed?: boolean;
  load?: () => Promise<string>;
}

type Loaded = { src?: string; error?: string };
type PreviewSlide = SlideImage & { previewId: string };

/** Shared viewer; callers retain ownership of authenticated image loading. */
export function ImagePreview({ images, index, onIndexChange, onClose, title = "图片预览" }: {
  images: PreviewImage[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  title?: string;
}) {
  const zoom = useRef<ZoomRef>(null);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const pending = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (index === null || !images.length) return;
    for (const offset of [-1, 0, 1]) {
      const image = images[(index + offset + images.length) % images.length];
      if (image.src || loaded[image.id] || pending.current.has(image.id) || !image.load) continue;
      pending.current.add(image.id);
      Promise.resolve().then(image.load).then(src => {
        if (!src) throw new Error("图片内容为空");
        if (alive.current) setLoaded(state => ({ ...state, [image.id]: { src } }));
      }).catch(error => {
        if (alive.current) setLoaded(state => ({ ...state, [image.id]: { error: String(error instanceof Error ? error.message : error) } }));
      }).finally(() => pending.current.delete(image.id));
    }
  }, [images, index, loaded]);
  const slides = useMemo<PreviewSlide[]>(() => images.map(image => ({
    src: image.src || loaded[image.id]?.src || "", alt: image.label, previewId: image.id,
  })), [images, loaded]);
  const selected = index === null ? undefined : images[index];
  return <Lightbox
    open={index !== null && images.length > 0}
    close={onClose}
    index={index ?? 0}
    slides={slides}
    plugins={[Zoom]}
    className="image-preview"
    styles={{ root: { zIndex: 100 } }}
    portal={{ container: { onKeyDown: event => event.stopPropagation() } }}
    controller={{ aria: true, closeOnBackdropClick: true }}
    carousel={{ preload: 1, padding: 64 }}
    zoom={{ ref: zoom, scrollToZoom: true, maxZoomPixelRatio: 4 }}
    on={{ view: ({ index: next }) => onIndexChange(next), zoom: ({ zoom: value }) => setScale(value) }}
    labels={{ Lightbox: title, Close: "关闭", Previous: "上一张", Next: "下一张", "Zoom in": "放大", "Zoom out": "缩小", "Photo gallery": "图片集", "{index} of {total}": "第 {index} 张，共 {total} 张" }}
    toolbar={{ buttons: [
      <span key="scale" className="image-preview-scale" aria-label="缩放比例">{Math.round(scale * 100)}%</span>,
      <button key="fit" type="button" className="yarl__button image-preview-fit" onClick={() => zoom.current?.changeZoom(1)}>适应窗口</button>,
      "close",
    ] }}
    render={{
      ...(images.length < 2 ? { buttonPrev: () => null, buttonNext: () => null } : {}),
      iconError: () => <span role="status">图片无法显示</span>,
      slide: ({ slide }) => {
        const item = slide as PreviewSlide;
        if (item.src) return undefined;
        const error = loaded[item.previewId]?.error;
        return <div className="image-preview-status" role="status">{error ? <>
          <p>图片加载失败：{error}</p>
          <button type="button" className="yarl__button image-preview-fit" onClick={() => setLoaded(state => {
            const next = { ...state }; delete next[item.previewId]; return next;
          })}>重试图片</button>
        </> : "正在加载图片…"}</div>;
      },
      controls: () => <div className="image-preview-caption">
        <span title={selected?.label}>{selected?.label}</span>
        {selected?.failed && <strong>未达预期</strong>}
        <span aria-live="polite">第 {(index ?? 0) + 1} 张，共 {images.length} 张</span>
      </div>,
    }}
  />;
}
