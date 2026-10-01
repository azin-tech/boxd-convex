import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/_-.<>";

/**
 * Decode: the value scrambles through random glyphs, then resolves character
 * by character — the readout-decode gesture from the launch reels. Respects
 * reduced-motion by rendering the text as-is.
 */
export function Decode({
  text,
  className,
  durationMs = 600,
}: {
  text: string;
  className?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(text);
  const raf = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setShown(text);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const settled = Math.floor(p * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        if (i < settled || text[i] === " ") out += text[i];
        else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setShown(out);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setShown(text);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [text, durationMs]);

  return (
    <span className={className} aria-label={text}>
      {shown}
    </span>
  );
}

/** A live timecode HH:MM:SS counting up from a start instant (machine uptime). */
export function useUptime(sinceMs: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - sinceMs) / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
