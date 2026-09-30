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
import { Atmosphere } from "./lib/Atmosphere.js";
import { BoxMark, NotchedPanel } from "./lib/NotchedPanel.js";
import { Decode, useUptime } from "./lib/effects.js";

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

/** A mono, uppercase, tracked-out section label. */
function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="kicker">{children}</p>;
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
      <div className="hero-ground">
        <Atmosphere />
        <div className="page-inner">
          <header className="bar">
            <a className="wordmark" href="https://boxd.sh">
              <BoxMark size={20} />
              <span className="wordmark-text">
                boxd <span>for Convex</span>
              </span>
            </a>
            <nav>
              <a href={REPO}>GitHub</a>
              <a href={NPM}>npm</a>
              <a href="https://docs.boxd.sh">Docs</a>
            </nav>
          </header>

          <section className="intro">
            <Kicker>
              Live demo <span className="kicker-sep">/</span> @boxd-sh/convex
            </Kicker>
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
        </div>
      </div>

      <div className="page-inner">
        <main>
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
            Demo machines have 1 vCPU and 4 GiB of memory, run isolated, and are
            destroyed after ten minutes. Don't put anything on them you want to
            keep.
          </p>
        </footer>
      </div>
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
      <span className="usage-dot" />
      {usage.running} of {usage.capacity} demo machines running
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
  const refresh = useAction(api.demo.refreshMachine);
  const state = stateOf(machine.status);
  const uptime = useUptime(machine._creationTime);

  // boxd changes a machine's state on its own (it suspends after idle), so
  // poll its status to keep the badge honest without a user action.
  useEffect(() => {
    const id = setInterval(() => {
      void refresh({ machineId: machine.machineId }).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [refresh, machine.machineId]);
  const left = Math.max(0, expiresAt - now);
  const busy = setState.pending || fork.pending || destroy.pending;
  const error = setState.error ?? fork.error ?? destroy.error;
  const host = machine.url?.replace(/^https:\/\//, "") ?? machine.name;

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

  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");

  return (
    <NotchedPanel
      className="console"
      radius={14}
      notch={34}
      background="var(--block)"
    >
      {/* Viewfinder header: the machine, and a readout of facts. */}
      <div className="hud">
        <div className="hud-id">
          <span
            className="live-dot"
            data-live={state === "running" || undefined}
          />
          <div>
            <h2 className="name">
              <Decode text={machine.name} />
            </h2>
            {machine.url && (
              <a
                className="url"
                href={machine.url}
                target="_blank"
                rel="noreferrer"
              >
                {host}
              </a>
            )}
          </div>
        </div>
        <dl className="readout">
          <div>
            <dt>Spec</dt>
            <dd>1 vCPU · 4 GiB</dd>
          </div>
          {bootMs !== undefined && (
            <div className="boot">
              <dt>{machine.forkedFrom ? "Forked" : "Boot"}</dt>
              <dd>
                <Decode text={`${(bootMs / 1000).toFixed(1)}s`} />
              </dd>
            </div>
          )}
          <div>
            <dt>Uptime</dt>
            <dd>{uptime}</dd>
          </div>
          <div>
            <dt>Destroys</dt>
            <dd>
              {mm}:{ss}
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
            data-state={key}
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

      <Terminal machineId={machine.machineId} host={host} live={!!state} />
    </NotchedPanel>
  );
}

const SUGGESTIONS = [
  "uname -sr && cat /etc/os-release | head -1",
  "nproc && free -h",
  "echo $RANDOM > /tmp/n && cat /tmp/n",
  "python3 -c 'import sys; print(sys.version)'",
];

function Terminal({
  machineId,
  host,
  live,
}: {
  machineId: string;
  host: string;
  live: boolean;
}) {
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
      <div className="terminal-titlebar">
        <span className="live-dot" data-live={live || undefined} />
        <span className="terminal-host">{host}</span>
        <span className="terminal-shell">bash</span>
      </div>
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
      <Kicker>How this page works</Kicker>
      <h2>Three functions, one reactive table</h2>
      <p>
        Install the component and bind your boxd API key into it. Your Convex
        functions then create, fork, pause and destroy machines, and run
        commands on them. The component keeps a row for every machine and every
        command, so the UI subscribes with an ordinary query.
      </p>
      <div className="step">
        <span className="step-n">01</span>
        <span className="step-label">Install</span>
      </div>
      <pre className="snippet">
        <code>npm install @boxd-sh/convex</code>
      </pre>
      <div className="step">
        <span className="step-n">02</span>
        <span className="step-label">Wire it up</span>
      </div>
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
