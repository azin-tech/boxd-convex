import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState, type FormEvent } from "react";
import { api } from "../convex/_generated/api.js";
import { Atmosphere } from "./lib/Atmosphere.js";
import { BoxMark } from "./lib/NotchedPanel.js";

/** The password screen, shown until the visitor unlocks the demo. */
export function Gate() {
  const unlock = useMutation(api.demo.unlock);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setPending(true);
    setError(undefined);
    try {
      await unlock({ password });
    } catch (e) {
      const data =
        e instanceof ConvexError ? (e.data as { message?: string }) : undefined;
      setError(data?.message ?? "Something went wrong. Try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="gate">
      <Atmosphere />
      <form className="gate-card" onSubmit={submit}>
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
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(undefined);
            }}
            autoComplete="off"
            autoFocus
          />
          <button type="submit" disabled={!password || pending}>
            {pending ? "Checking…" : "Open"}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
