export type Platform = "mac" | "win";
export type PlatformPref = "auto" | Platform;

export function detectPlatform(): Platform {
  try {
    const nav = navigator as any;
    const p = String(nav.userAgentData?.platform || nav.platform || nav.userAgent || "").toLowerCase();
    return /mac|iphone|ipad|ipod/.test(p) ? "mac" : "win";
  } catch {
    return "win";
  }
}

export function resolvePlatform(pref: PlatformPref): Platform {
  return pref === "auto" ? detectPlatform() : pref;
}

const MAC_KEYS: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", enter: "↵", esc: "Esc", up: "↑", down: "↓", left: "←", right: "→", backspace: "⌫" };
const WIN_KEYS: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", enter: "Enter", esc: "Esc", up: "↑", down: "↓", left: "←", right: "→", backspace: "Backspace" };

export function keyLabel(key: string, platform: Platform) {
  const map = platform === "mac" ? MAC_KEYS : WIN_KEYS;
  return map[key.toLowerCase()] ?? key.toUpperCase();
}

/** 事件是否按下了平台的主修饰键（⌘ 或 Ctrl） */
export function hasMod(e: KeyboardEvent) {
  return e.metaKey || e.ctrlKey;
}
