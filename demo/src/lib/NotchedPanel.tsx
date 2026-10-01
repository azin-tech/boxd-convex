import { useEffect, useRef, useState, type ReactNode } from "react";
import { boxPath, notchedPath } from "./box.js";

/** The boxd logo mark: a filled container glyph. */
export function BoxMark({
  size = 22,
  fill = "currentColor",
  className,
}: {
  size?: number;
  fill?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill={fill}
      className={className}
      aria-hidden="true"
    >
      <path d={boxPath(size)} />
    </svg>
  );
}

/**
 * A panel with the boxd notch cut from the bottom-left. The clip removes the
 * CSS border along the cut, so the border is drawn as an SVG stroke of the
 * same path — the site's own technique, so the geometry never drifts.
 */
export function NotchedPanel({
  children,
  className = "",
  radius = 12,
  notch = 28,
  stroke = "var(--border)",
  background,
  style,
}: {
  children: ReactNode;
  className?: string;
  radius?: number;
  notch?: number;
  stroke?: string;
  background?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const clip = size ? notchedPath(size.w, size.h, radius, notch) : undefined;
  const border = size ? notchedPath(size.w, size.h, radius, notch, 0.5) : null;

  return (
    <div
      ref={ref}
      className={`notched ${className}`}
      style={{
        ...style,
        background,
        clipPath: clip ? `path('${clip}')` : undefined,
      }}
    >
      {children}
      {border && size && (
        <svg
          aria-hidden="true"
          className="notched-border"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
        >
          <path d={border} fill="none" stroke={stroke} strokeWidth="1" />
        </svg>
      )}
    </div>
  );
}
