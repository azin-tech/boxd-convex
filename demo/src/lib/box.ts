/* The boxd corner language, ported from boxd/website (LogoMark, BoxButton).
   A rounded rect with the container notch cut from the bottom-left. The mark,
   the panels and the terminal all share it, so the page reads as boxd. */

/** The logo mark: a square with the notch cut from the bottom-left. */
export function boxPath(size: number): string {
  const r = size / 12;
  const ri = size / 12;
  const n = size * 0.2;
  const notchTop = size - n;
  const notchRight = n;
  return `M ${r} 0 L ${size - r} 0 A ${r} ${r} 0 0 1 ${size} ${r} L ${size} ${size - r} A ${r} ${r} 0 0 1 ${size - r} ${size} L ${notchRight + r} ${size} A ${r} ${r} 0 0 1 ${notchRight} ${size - r} L ${notchRight} ${notchTop + ri} A ${ri} ${ri} 0 0 0 ${notchRight - ri} ${notchTop} L ${r} ${notchTop} A ${r} ${r} 0 0 1 0 ${notchTop - r} L 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

/** A rounded rect at panel scale (no notch). `inset` keeps the 1px stroke in. */
export function rectPath(w: number, h: number, r: number, inset = 0): string {
  const l = inset,
    t = inset,
    R = w - inset,
    B = h - inset;
  return [
    `M ${l + r},${t}`,
    `L ${R - r},${t}`,
    `A ${r},${r} 0 0 1 ${R},${t + r}`,
    `L ${R},${B - r}`,
    `A ${r},${r} 0 0 1 ${R - r},${B}`,
    `L ${l + r},${B}`,
    `A ${r},${r} 0 0 1 ${l},${B - r}`,
    `L ${l},${t + r}`,
    `A ${r},${r} 0 0 1 ${l + r},${t}`,
    `Z`,
  ].join(" ");
}

/** A rounded rect with the boxd notch cut from the bottom-left corner. */
export function notchedPath(
  w: number,
  h: number,
  r: number,
  n = 28,
  inset = 0,
): string {
  const rn = Math.min(3, n * 0.3),
    ri = Math.min(2, n * 0.2);
  const l = inset,
    t = inset,
    R = w - inset,
    B = h - inset;
  return [
    `M ${l + r},${t}`,
    `L ${R - r},${t}`,
    `A ${r},${r} 0 0 1 ${R},${t + r}`,
    `L ${R},${B - r}`,
    `A ${r},${r} 0 0 1 ${R - r},${B}`,
    `L ${l + n + rn},${B}`,
    `A ${rn},${rn} 0 0 1 ${l + n},${B - rn}`,
    `L ${l + n},${B - n + ri}`,
    `A ${ri},${ri} 0 0 0 ${l + n - ri},${B - n}`,
    `L ${l + rn},${B - n}`,
    `A ${rn},${rn} 0 0 1 ${l},${B - n - rn}`,
    `L ${l},${t + r}`,
    `A ${r},${r} 0 0 1 ${l + r},${t}`,
    `Z`,
  ].join(" ");
}
