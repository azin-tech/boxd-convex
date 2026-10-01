import { useEffect, useState } from "react";

const GLYPHS = "abcdefghijklmnopqrstuvwxyz";

/** A name-shaped scramble that never settles: boxd hasn't named it yet. */
function scramble(length: number) {
  return Array.from({ length }, (_, i) =>
    i === 4 ? "-" : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
  ).join("");
}

function useScramble(length = 9, intervalMs = 70) {
  const [text, setText] = useState(() => scramble(length));
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setText(scramble(length)), intervalMs);
    return () => clearInterval(id);
  }, [length, intervalMs]);
  return text;
}

function useElapsed() {
  const [start] = useState(() => performance.now());
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMs(performance.now() - start), 100);
    return () => clearInterval(id);
  }, [start]);
  return ms;
}

/** The machine panel's stand-in while boxd boots the machine. */
export function Booting() {
  const name = useScramble();
  const elapsed = useElapsed();

  return (
    <div className="console booting" aria-busy="true">
      <div className="hud">
        <div className="hud-id">
          <span className="live-dot" data-booting />
          <div>
            <h2 className="name booting-name" aria-label="Booting a machine">
              {name}
            </h2>
            <span className="url booting-url">waiting for boxd</span>
          </div>
        </div>
      </div>
      <ol className="bootlog" aria-live="polite">
        <li data-done>
          <span>Slot reserved</span>
          <span className="bootlog-state">done</span>
        </li>
        <li>
          <span>Starting the microVM</span>
          <span className="bootlog-state">{(elapsed / 1000).toFixed(1)}s</span>
        </li>
      </ol>
    </div>
  );
}
