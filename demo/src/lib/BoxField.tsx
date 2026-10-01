import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* BoxField — the boxd isometric box city, ported from boxd/website. A grid of
   machines rendered as rose boxes, faded into the dark at the edges. The box
   nearest the cursor rises and glows; its neighbours ripple. Infrastructure
   that responds to your presence. Atmosphere only: rose is the one place the
   brand allows colour, and this never touches type, buttons or chrome. */

const GRID = 22;
const BW = 34;
const BD = 20;
const SVG_W = 1400;
const SVG_H = 760;
const WARM = "224, 90, 109";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function edgeFade(x: number, y: number): number {
  let f = 1;
  const left = 0.22,
    right = 0.22,
    bottom = 0.5,
    top = 0.12;
  if (x < SVG_W * left) f *= clamp01(x / (SVG_W * left)) ** 2;
  if (x > SVG_W * (1 - right)) f *= clamp01((SVG_W - x) / (SVG_W * right)) ** 2;
  if (y > SVG_H * (1 - bottom))
    f *= clamp01((SVG_H - y) / (SVG_H * bottom)) ** 2;
  if (y < SVG_H * top) f *= clamp01(y / (SVG_H * top)) ** 2;
  return f;
}

function seed(n: number) {
  const x = Math.sin(n * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const isoX = (c: number, r: number) => SVG_W / 2 + (c - r) * 40;
const isoY = (c: number, r: number, h: number) => 150 + (c + r) * 22 - h;

type Box = {
  col: number;
  row: number;
  h: number;
  base: number;
  cx: number;
  cy: number;
};

const BOXES: Box[] = (() => {
  const out: Box[] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const s = r * GRID + c;
      if (seed(s) > 0.5) continue;
      const h = Math.floor(seed(s + 200) * 3) * 12 + 8;
      out.push({
        col: c,
        row: r,
        h,
        base: 0.06 + seed(s + 300) * 0.08,
        cx: isoX(c, r),
        cy: isoY(c, r, h / 2),
      });
    }
  }
  return out.sort((a, b) => a.col + a.row - (b.col + b.row));
})();

export function BoxField({ intensity = 1 }: { intensity?: number } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  const onMove = useCallback((e: MouseEvent) => {
    // Stand down under a control: the atmosphere never competes with the
    // thing in front of it.
    if (e.target instanceof Element && e.target.closest("a, button, input")) {
      setMouse(null);
      return;
    }
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        const svgAspect = SVG_W / SVG_H;
        let vw = SVG_W,
          vh = SVG_H,
          ox = 0,
          oy = 0;
        if (aspect > svgAspect) {
          vh = SVG_W / aspect;
          oy = (SVG_H - vh) / 2;
        } else {
          vw = SVG_H * aspect;
          ox = (SVG_W - vw) / 2;
        }
        setMouse({
          x: ox + ((e.clientX - rect.left) / rect.width) * vw,
          y: oy + ((e.clientY - rect.top) / rect.height) * vh,
        });
      }
      raf.current = 0;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", () => setMouse(null));
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [onMove]);

  const active = useMemo(() => {
    if (!mouse) return -1;
    let best = -1;
    let min = 80;
    for (let i = 0; i < BOXES.length; i++) {
      const d = Math.hypot(mouse.x - BOXES[i].cx, mouse.y - BOXES[i].cy);
      if (d < min) {
        min = d;
        best = i;
      }
    }
    return best;
  }, [mouse]);

  return (
    <div ref={ref} className="boxfield" aria-hidden="true">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid slice"
        width="100%"
        height="100%"
      >
        {BOXES.map((b, i) => {
          const fade = edgeFade(b.cx, b.cy);
          if (fade < 0.01) return null;
          const isActive = i === active && fade > 0.3;
          let ring = 0;
          if (active >= 0 && !isActive) {
            const a = BOXES[active];
            const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
            if (d < 180) ring = (1 - d / 180) * 0.14;
          }
          const op = (b.base + ring + (isActive ? 0.3 : 0)) * intensity * fade;
          const x = isoX(b.col, b.row);
          const drawH = b.h + (isActive ? 14 : 0);
          const ty = isoY(b.col, b.row, drawH);
          const by = isoY(b.col, b.row, 0);
          const top = `M ${x} ${ty} L ${x + BW} ${ty + BD / 2} L ${x} ${ty + BD} L ${x - BW} ${ty + BD / 2} Z`;
          const right = `M ${x + BW} ${ty + BD / 2} L ${x + BW} ${by + BD / 2} L ${x} ${by + BD} L ${x} ${ty + BD} Z`;
          const left = `M ${x - BW} ${ty + BD / 2} L ${x} ${ty + BD} L ${x} ${by + BD} L ${x - BW} ${by + BD / 2} Z`;
          const outline = `M ${x} ${ty} L ${x + BW} ${ty + BD / 2} L ${x + BW} ${by + BD / 2} L ${x} ${by + BD} L ${x - BW} ${by + BD / 2} L ${x - BW} ${ty + BD / 2} Z`;
          return (
            <g key={i}>
              <path d={left} fill={`rgba(${WARM}, ${op * 0.45})`} />
              <path d={right} fill={`rgba(${WARM}, ${op * 0.65})`} />
              <path d={top} fill={`rgba(${WARM}, ${op})`} />
              <path
                d={outline}
                fill="none"
                stroke={`rgba(${WARM}, ${op * (isActive ? 1.8 : 0.9)})`}
                strokeWidth={isActive ? 0.8 : 0.4}
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
