import { useAuthActions } from "@convex-dev/auth/react";
import {
  useAction,
  useConvexAuth,
  useQuery,
  type ReactAction,
} from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReference } from "convex/server";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../convex/_generated/api.js";

const REPO = "https://github.com/azin-tech/boxd-convex";
const NPM = "https://www.npmjs.com/package/@boxd-sh/convex";

type Row = NonNullable<
  ReturnType<typeof useQuery<typeof api.demo.machines>>
>[number];
type Machine = NonNullable<Row["machine"]>;
type State = "running" | "paused" | "hibernated";

/** The message a failed call should show. */
function message(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  return "Something went wrong. Try again";
}

/** An action, with its pending state and error. */
function useCall<F extends FunctionReference<"action">>(fn: F) {
  const run = useAction(fn) as ReactAction<F>;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function call(...args: Parameters<ReactAction<F>>) {
    setPending(true);
    setError(undefined);
    try {
      return await run(...args);
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  }
  return { call, pending, error, clearError: () => setError(undefined) };
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The states boxd can move a machine to from `from`. */
const MOVES: Record<State, State[]> = {
  running: ["paused", "hibernated"],
  paused: ["running", "hibernated"],
  hibernated: ["running"],
};

function stateOf(status: string): State | undefined {
  if (status === "running") return "running";
  if (status === "suspended" || status === "standby") return "paused";
  if (status === "hibernated") return "hibernated";
  return undefined;
}

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const signingIn = useRef(false);

  // Every visitor is signed in anonymously, so the machines they make are
  // theirs alone.
  useEffect(() => {
    if (isLoading || isAuthenticated || signingIn.current) return;
    signingIn.current = true;
    void signIn("anonymous").finally(() => {
      signingIn.current = false;
    });
  }, [isLoading, isAuthenticated, signIn]);

  const rows = useQuery(api.demo.machines, isAuthenticated ? {} : "skip");
  const usage = useQuery(api.demo.usage, {});
  const create = useCall(api.demo.createMachine);
  const [bootMs, setBootMs] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string>();

  const live = rows ?? [];
  const current =
    live.find((row) => row.slotId === selected) ?? live[live.length - 1];

  async function boot() {
    const started = performance.now();
    const machineId = await create.call({});
    if (machineId) {
      setBootMs((b) => ({ ...b, [machineId]: performance.now() - started }));
    }
  }

  return (
    <div className="page">
      <header className="bar">
        <a className="wordmark" href="https://boxd.sh">
          boxd <span>for Convex</span>
        </a>
        <nav>
          <a href={REPO}>GitHub</a>
          <a href={NPM}>npm</a>
          <a href="https://docs.boxd.sh">Docs</a>
        </nav>
      </header>

      <main>
        <section className="intro">
          <h1>A Linux machine for every user of your Convex app</h1>
          <p className="lede">
            This page runs on a Convex backend with the{" "}
            <code>@boxd-sh/convex</code> component. Boot a machine and it
            creates a real boxd microVM, just for you. Everything below is a
            Convex query, so it changes the moment the machine does.
          </p>
          {live.length === 0 && (
            <div className="start">
              <button
                className="primary"
                onClick={boot}
                disabled={!isAuthenticated || create.pending}
              >
                {create.pending ? "Booting…" : "Boot a machine"}
              </button>
              <Usage usage={usage} />
            </div>
          )}
          {create.error && live.length === 0 && (
            <p className="error" role="alert">
              {create.error}
            </p>
          )}
        </section>

        {live.length > 0 && current && (
          <section className="workspace" aria-label="Your machines">
            {live.length > 1 && (
              <div className="tabs" role="tablist">
                {live.map((row) => (
                  <button
                    key={row.slotId}
                    role="tab"
                    aria-selected={row.slotId === current.slotId}
                    onClick={() => setSelected(row.slotId)}
                  >
                    {row.machine?.name ?? "booting"}
                    {row.machine?.forkedFrom && <span> fork</span>}
                  </button>
                ))}
              </div>
            )}
            {current.machine ? (
              <MachinePanel
                key={current.slotId}
                machine={current.machine}
                expiresAt={current.expiresAt}
                bootMs={bootMs[current.machine.machineId]}
                canFork={live.length < 2}
                onForked={(machineId, ms) =>
                  setBootMs((b) => ({ ...b, [machineId]: ms }))
                }
              />
            ) : (
              <p className="booting">Booting a fresh machine…</p>
            )}
          </section>
        )}

        <HowItWorks />
      </main>

      <footer>
        <p>
          Demo machines have 1 vCPU and 4 GiB of memory, and are destroyed after
          ten minutes. Don't put anything on them you want to keep.
        </p>
      </footer>
    </div>
  );
}

function Usage({
  usage,
}: {
  usage: { running: number; capacity: number; lifetimeMs: number } | undefined;
}) {
  if (!usage) return null;
  return (
    <p className="usage">
      {usage.running} of {usage.capacity} demo machines running right now
    </p>
  );
}

function MachinePanel({
  machine,
  expiresAt,
  bootMs,
  canFork,
  onForked,
}: {
  machine: Machine;
  expiresAt: number;
  bootMs: number | undefined;
  canFork: boolean;
  onForked: (machineId: string, ms: number) => void;
}) {
  const now = useNow();
  const setState = useCall(api.demo.setState);
  const fork = useCall(api.demo.forkMachine);
  const destroy = useCall(api.demo.destroyMachine);
  const state = stateOf(machine.status);
  const left = Math.max(0, expiresAt - now);
  const busy = setState.pending || fork.pending || destroy.pending;
  const error = setState.error ?? fork.error ?? destroy.error;

  /** The call that moves the machine from its state to `to`. */
  function move(to: State) {
    if (!state || !MOVES[state].includes(to)) return;
    const verb =
      to === "paused"
        ? "pause"
        : to === "hibernated"
          ? "hibernate"
          : state === "paused"
            ? "resume"
            : "wake";
    void setState.call({ machineId: machine.machineId, to: verb });
  }

  async function forkIt() {
    const started = performance.now();
    const machineId = await fork.call({ machineId: machine.machineId });
    if (machineId) onForked(machineId, performance.now() - started);
  }

  return (
    <div className="machine">
      <div className="identity">
        <div>
          <h2 className="name">{machine.name}</h2>
          {machine.url && (
            <a
              className="url"
              href={machine.url}
              target="_blank"
              rel="noreferrer"
            >
              {machine.url.replace(/^https:\/\//, "")}
            </a>
          )}
        </div>
        <dl className="facts">
          {bootMs !== undefined && (
            <div className="boot">
              <dt>{machine.forkedFrom ? "Forked in" : "Ready in"}</dt>
              <dd>{(bootMs / 1000).toFixed(1)} s</dd>
            </div>
          )}
          <div>
            <dt>Destroyed in</dt>
            <dd>
              {Math.floor(left / 60000)}:
              {String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}
            </dd>
          </div>
        </dl>
      </div>

      <div
        className="track"
        role="group"
        aria-label="Machine state"
        data-busy={busy || undefined}
      >
        {(
          [
            ["running", "Running", "Using CPU and memory"],
            ["paused", "Paused", "Frozen in memory, resumes instantly"],
            ["hibernated", "Hibernated", "Memory saved to disk, host freed"],
          ] as const
        ).map(([key, label, hint]) => (
          <button
            key={key}
            className="stop"
            aria-pressed={state === key}
            disabled={busy || !state || !MOVES[state].includes(key)}
            onClick={() => move(key)}
          >
            <span className="label">{label}</span>
            <span className="hint">{hint}</span>
          </button>
        ))}
      </div>
      {!state && (
        <p className="transition">
          boxd reports this machine as {machine.status}
        </p>
      )}

      <div className="actions">
        {canFork && (
          <button onClick={forkIt} disabled={busy}>
            {fork.pending ? "Forking…" : "Fork, memory and all"}
          </button>
        )}
        <button
          className="danger"
          onClick={() => void destroy.call({ machineId: machine.machineId })}
          disabled={busy}
        >
          {destroy.pending ? "Destroying…" : "Destroy"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <Terminal machineId={machine.machineId} />
    </div>
  );
}

const SUGGESTIONS = [
  "uname -sr && cat /etc/os-release | head -1",
  "nproc && free -h",
  "echo $RANDOM > /tmp/n && cat /tmp/n",
  "python3 -c 'import sys; print(sys.version)'",
];

function Terminal({ machineId }: { machineId: string }) {
  const executions = useQuery(api.demo.executions, { machineId });
  const run = useCall(api.demo.runCommand);
  const [command, setCommand] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = command.trim();
    if (!text) return;
    setCommand("");
    await run.call({ machineId, command: text });
  }

  return (
    <div className="terminal">
      <form onSubmit={submit}>
        <label htmlFor="command" className="prompt">
          $
        </label>
        <input
          id="command"
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
            run.clearError();
          }}
          placeholder="Run a command on the machine"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={!command.trim()}>
          Run
        </button>
      </form>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => setCommand(s)}>
            {s}
          </button>
        ))}
      </div>
      {run.error && (
        <p className="error" role="alert">
          {run.error}
        </p>
      )}
      <ol className="history" aria-live="polite">
        {executions?.map((e) => (
          <li key={e._id} data-status={e.status}>
            <div className="line">
              <code className="cmd">{e.command}</code>
              <span className="status">
                {e.status === "running"
                  ? "running"
                  : e.error
                    ? "failed"
                    : `exit ${e.exitCode}`}
              </span>
            </div>
            {(e.stdout || e.stderr || e.error) && (
              <pre>
                {e.stdout}
                {e.stderr && <span className="stderr">{e.stderr}</span>}
                {e.error && <span className="stderr">{e.error}</span>}
              </pre>
            )}
          </li>
        ))}
      </ol>
      {executions?.length === 0 && (
        <p className="empty">
          Commands you run show up here, with their output, as a Convex query.
        </p>
      )}
    </div>
  );
}

const SNIPPET = `// convex/machines.ts
const boxd = new Boxd(components.boxd);

export const createMachine = action({
  args: {},
  handler: async (ctx) =>
    await boxd.create(ctx, { ownerId: await userId(ctx), vcpu: 1 }),
});

export const run = action({
  args: { machineId: v.string(), command: v.string() },
  handler: async (ctx, args) =>
    await boxd.exec(ctx, { ...args, ownerId: await userId(ctx) }),
});

// Reactive: re-runs whenever a machine changes state.
export const myMachines = query({
  args: {},
  handler: async (ctx) =>
    await boxd.list(ctx, { ownerId: await userId(ctx) }),
});`;

function HowItWorks() {
  return (
    <section className="how">
      <h2>How this page works</h2>
      <p>
        Install the component and bind your boxd API key into it. Your Convex
        functions then create, fork, pause and destroy machines, and run
        commands on them. The component keeps a row for every machine and every
        command, so the UI subscribes with an ordinary query.
      </p>
      <pre className="snippet">
        <code>npm install @boxd-sh/convex</code>
      </pre>
      <pre className="snippet">
        <code>{SNIPPET}</code>
      </pre>
      <p>
        This demo adds anonymous sign-in, a cap of two machines per visitor,
        rate limits and a cron that destroys each machine after ten minutes. The
        full source is in <a href={`${REPO}/tree/main/example`}>example/</a>.
      </p>
    </section>
  );
}
