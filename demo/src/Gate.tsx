import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../convex/_generated/api.js";
import { Atmosphere } from "./lib/Atmosphere.js";
import { BoxMark } from "./lib/NotchedPanel.js";

/** How long the opening plays before the page takes over. */
const OPEN_MS = 1100;

type Phase = "idle" | "checking" | "open" | "wrong";

/**
 * The password screen, shown until the visitor unlocks the demo. While the
 * password is checked a rose light runs around the card; when it is right
 * the border lights up, the card dissolves into the box field, and
 * `onOpened` hands over to the page.
 */
export function Gate({ onOpened }: { onOpened: () => void }) {
  const unlock = useMutation(api.demo.unlock);
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== "open") return;
    const id = setTimeout(onOpened, OPEN_MS);
    return () => clearTimeout(id);
  }, [phase, onOpened]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || phase === "checking" || phase === "open") return;
    setPhase("checking");
    setError(undefined);
    // Let the light make one full lap, even when the check is instant.
    const lap = new Promise((r) => setTimeout(r, 700));
    try {
      await Promise.all([unlock({ password }), lap]);
      setPhase("open");
    } catch (e) {
      const data =
        e instanceof ConvexError ? (e.data as { message?: string }) : undefined;
      await lap;
      setError(data?.message ?? "Something went wrong. Try again");
      setPhase("wrong");
      input.current?.select();
    }
  }

  return (
    <div className="gate" data-phase={phase}>
      <Atmosphere />
      <form
        className="gate-card"
        onSubmit={submit}
        // The shake ends the wrong state, so the next wrong try shakes again.
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget && phase === "wrong")
            setPhase("idle");
        }}
      >
        <span className="wordmark">
          <BoxMark size={20} />
          <span className="wordmark-text">
            boxd <span>for Convex</span>
          </span>
        </span>
        <label htmlFor="password">Enter the password to open the demo</label>
        <div className="gate-row">
          <input
            id="password"
            ref={input}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(undefined);
            }}
            autoComplete="off"
            autoFocus
            disabled={phase === "open"}
          />
          <button type="submit" disabled={!password || phase === "checking"}>
            <span className="gate-label">
              {phase === "checking" ? "Checking" : "Open"}
            </span>
            <svg
              className="gate-check"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 8.5L6.5 12L13 4"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p className="error" role="alert" hidden={!error}>
          {error}
        </p>
        <span className="gate-sweep" aria-hidden="true" />
      </form>
      <span className="sr-only" aria-live="polite">
        {phase === "open" ? "Opening the demo" : ""}
      </span>
    </div>
  );
}
