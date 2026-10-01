import { useAuthActions } from "@convex-dev/auth/react";
import {
  useAction,
  useConvexAuth,
  useQuery,
  type ReactAction,
} from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReference } from "convex/server";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "../convex/_generated/api.js";
import { Atmosphere } from "./lib/Atmosphere.js";
import { BoxMark, NotchedPanel } from "./lib/NotchedPanel.js";
import { Decode, useUptime } from "./lib/effects.js";
import { CtaBanner } from "./CtaBanner.js";
import { Footer } from "./Footer.js";
import { Gate } from "./Gate.js";
import { CopyCommand, StartBar } from "./lib/buttons.js";
import { HowItWorks } from "./HowItWorks.js";

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

  const unlocked = useQuery(api.demo.unlocked, isAuthenticated ? {} : "skip");
  // The gate stays up after the unlock until its opening has played.
  const [gateOpen, setGateOpen] = useState(false);
  useEffect(() => {
    if (unlocked === false) setGateOpen(true);
  }, [unlocked]);
  const closeGate = useCallback(() => setGateOpen(false), []);
  const rows = useQuery(
    api.demo.machines,
    isAuthenticated && unlocked ? {} : "skip",
  );
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

  // Hold the page until sign-in and the password check have answered, so the
  // demo never flashes before the gate.
  if (unlocked === undefined) return <div className="page" />;
  if (!unlocked || gateOpen) return <Gate onOpened={closeGate} />;

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
            </nav>
          </header>

          <section className="intro">
            <NotchedPanel
              className="speed"
              radius={6}
              notch={7}
              stroke="rgba(255,255,255,0.2)"
              background="linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))"
            >
              <span>a full computer in</span> &lt;10ms
            </NotchedPanel>
            <h1>
              Composable computers
              <br />
              on Convex
            </h1>
            <p className="lede">
              This page runs on a Convex backend with the{" "}
              <code>@boxd-sh/convex</code> component. Boot a machine and it
              creates a real boxd microVM. Everything below is a Convex query,
              so it changes the moment the machine does.
            </p>
            <div className="start">
              <StartBar
                onClick={() => void boot()}
                disabled={
                  !isAuthenticated ||
                  create.pending ||
                  live.length >= 2 ||
                  (usage !== undefined && usage.running >= usage.capacity)
                }
              >
                {create.pending ? "Booting…" : "Boot a machine"}
                {/* Rendered before the query lands, hidden, so the bar keeps
                    its width and the count fades in instead of pushing it. */}
                <span
                  className="boot-count"
                  data-loading={!usage || undefined}
                  title={
                    usage &&
                    `${usage.running} of ${usage.capacity} demo machines running`
                  }
                >
                  {usage?.running ?? 0}/{usage?.capacity ?? 10}
                </span>
              </StartBar>
              <CopyCommand command="npm install @boxd-sh/convex" />
            </div>
            {create.error && (
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

          <HowItWorks
            machines={live.flatMap((row) => (row.machine ? [row.machine] : []))}
            machineId={current?.machine?.machineId}
          />
          <CtaBanner />
        </main>
      </div>
      <Footer />
    </div>
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
    <div className="console">
      {/* Viewfinder header: the machine, and a readout of facts. */}
      <div className="hud">
        <div className="hud-id">
          <span
            className="live-dot"
            data-live={state === "running" || undefined}
          />
          <div>
            <div className="name-row">
              <h2 className="name">
                <Decode text={machine.name} />
              </h2>
              {/* Every demo machine is created with `isolated: true`. */}
              <span className="pill-isolated" tabIndex={0}>
                Isolated
                <span role="tooltip" className="tip">
                  A sandbox. It can't reach other machines, the boxd API or your
                  org's integrations, and has no boxd CLI inside. Set when the
                  machine is created, so this page can safely run whatever you
                  type.
                </span>
              </span>
            </div>
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

      <Terminal
        machineId={machine.machineId}
        name={machine.name}
        host={host}
        live={!!state}
      />
    </div>
  );
}

const SUGGESTIONS = [
  "uname -sr && head -1 /etc/os-release",
  "nproc && free -h",
  "python3 --version",
  "df -h /",
];

function Terminal({
  machineId,
  name,
  host,
  live,
}: {
  machineId: string;
  name: string;
  host: string;
  live: boolean;
}) {
  const executions = useQuery(api.demo.executions, { machineId });
  const run = useCall(api.demo.runCommand);
  const [command, setCommand] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  // The query returns newest first; a terminal reads oldest first.
  const lines = [...(executions ?? [])].reverse();

  // Keep the prompt in view as output arrives, like a real terminal.
  useEffect(() => {
    const el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [executions]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = command.trim();
    if (!text) return;
    setCommand("");
    await run.call({ machineId, command: text });
  }

  const prompt = (
    <span className="ps1" aria-hidden="true">
      {name}:~$
    </span>
  );

  return (
    <div className="terminal">
      <div className="terminal-titlebar">
        <span className="live-dot" data-live={live || undefined} />
        <span className="terminal-host">{host}</span>
      </div>
      <div
        className="screen"
        ref={screen}
        onClick={() => input.current?.focus()}
        aria-live="polite"
      >
        {lines.map((e) => {
          const failed = !!e.error || (e.exitCode ?? 0) !== 0;
          return (
            <div key={e._id} className="entry" data-status={e.status}>
              <div className="entry-cmd">
                {prompt} <span>{e.command}</span>
                {e.status !== "running" && failed && (
                  <span className="exit">
                    {e.error ? "failed" : `exit ${e.exitCode}`}
                  </span>
                )}
              </div>
              {e.status === "running" ? (
                <span className="caret" aria-label="running" />
              ) : (
                (e.stdout || e.stderr || e.error) && (
                  <pre>
                    {e.stdout}
                    {e.stderr && <span className="stderr">{e.stderr}</span>}
                    {e.error && <span className="stderr">{e.error}</span>}
                  </pre>
                )
              )}
            </div>
          );
        })}
        <form onSubmit={submit} className="entry-cmd">
          <label htmlFor="command">{prompt}</label>
          <input
            id="command"
            ref={input}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              run.clearError();
            }}
            placeholder={
              lines.length ? "" : "type a command, or pick one below"
            }
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={!command.trim() || run.pending}>
            Run
          </button>
        </form>
        {run.error && (
          <p className="error" role="alert">
            {run.error}
          </p>
        )}
      </div>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setCommand(s);
              input.current?.focus();
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
