import { BoxField } from "./BoxField.js";

/* The hero ground: drifting rose and ocean blooms, a grain so it reads as
   light on a surface, a vignette to seat the content, and the box city behind
   it all. Colour lives only here — the brand allows it as atmosphere, never on
   type or chrome. Blooms drift on co-prime periods so the field never returns
   to a pose you have seen. */

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.4 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

export function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden="true">
      <div className="bloom bloom-rose-a" />
      <div className="bloom bloom-ocean-a" />
      <div className="bloom bloom-rose-b" />
      <BoxField />
      <div className="atmosphere-grain" style={{ backgroundImage: GRAIN }} />
      <div className="atmosphere-vignette" />
    </div>
  );
}
