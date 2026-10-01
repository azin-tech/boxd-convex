import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api.js";

type Fn = "create" | "exec" | "list";
type NodeId = "page" | "action" | "boxd" | "vm" | "tables" | "query";

type Machine = {
  machineId: string;
  name: string;
  status: string;
  vcpu?: number;
  memoryBytes?: number;
  forkedFrom?: string;
  updatedAt: number;
};

/** What each function does, the code that calls it, and the nodes it touches. */
const FNS: Record<
  Fn,
  { call: string; kind: string; says: string; code: string; nodes: NodeId[] }
> = {
  create: {
    call: "boxd.create",
    kind: "action",
    says: "Boots a machine and writes its row.",
    nodes: ["page", "action", "boxd", "vm", "tables", "query"],
    code: `export const createMachine = action({
  args: {},
  handler: async (ctx) =>
    await boxd.create(ctx, {
      ownerId: await userId(ctx),
      vcpu: 1,
    }),
});`,
  },
  exec: {
    call: "boxd.exec",
    kind: "action",
    says: "Runs a command and stores the output.",
    nodes: ["page", "action", "boxd", "vm", "tables", "query"],
    code: `export const run = action({
  args: {
    machineId: v.string(),
    command: v.string(),
  },
  handler: async (ctx, args) =>
    await boxd.exec(ctx, {
      ...args,
      ownerId: await userId(ctx),
    }),
});`,
  },
  list: {
    call: "boxd.list",
    kind: "query",
    says: "Reads the rows. Re-runs when they change.",
    nodes: ["tables", "query", "page"],
    code: `export const myMachines = query({
  args: {},
  handler: async (ctx) =>
    await boxd.list(ctx, {
      ownerId: await userId(ctx),
    }),
});`,
  },
};

const ORDER: Fn[] = ["create", "exec", "list"];

/**
 * The loop every call travels, in two shapes: wide for desktop, tall for
 * phones. `full` threads every node; `list` starts at the tables. Nodes are
 * drawn over the route, so the pulse reads as passing through them.
 */
const LAYOUTS = {
  wide: {
    w: 600,
    h: 270,
    nodes: {
      page: { x: 12, y: 109, w: 118, h: 52 },
      action: { x: 172, y: 22, w: 124, h: 52 },
      boxd: { x: 318, y: 22, w: 118, h: 52 },
      vm: { x: 458, y: 22, w: 130, h: 52 },
      query: { x: 172, y: 196, w: 124, h: 52 },
      tables: { x: 352, y: 186, w: 236, h: 58 },
    },
    full: "M71 109 V48 H523 V222 H71 V161",
    list: "M470 222 H71 V161",
  },
  tall: {
    w: 320,
    h: 382,
    nodes: {
      page: { x: 98, y: 10, w: 124, h: 52 },
      action: { x: 12, y: 104, w: 136, h: 52 },
      boxd: { x: 12, y: 200, w: 136, h: 52 },
      vm: { x: 12, y: 296, w: 136, h: 52 },
      query: { x: 172, y: 166, w: 136, h: 52 },
      tables: { x: 172, y: 286, w: 136, h: 84 },
    },
    full: "M98 36 H80 V322 H240 V36 H222",
    list: "M240 348 V36 H222",
  },
} as const;

function useNarrow() {
  const query = "(max-width: 40rem)";
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.(query).matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setNarrow(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow;
}

function useReducedMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

export function HowItWorks({
  machines,
  machineId,
}: {
  machines: Machine[];
  machineId: string | undefined;
}) {
  const [fn, setFn] = useState<Fn>("create");
  const [touched, setTouched] = useState(false);
  const reduce = useReducedMotion();

  // Walk the three functions on its own until the visitor picks one.
  useEffect(() => {
    if (touched || reduce) return;
    const id = setInterval(
      () => setFn((f) => ORDER[(ORDER.indexOf(f) + 1) % ORDER.length]),
      5200,
    );
    return () => clearInterval(id);
  }, [touched, reduce]);

  const pick = (f: Fn) => {
    setTouched(true);
    setFn(f);
  };

  return (
    <section className="how" aria-labelledby="how-title">
      <h2 id="how-title">The code behind this page</h2>

      <div className="circuit">
        <div className="fn-picker" role="tablist" aria-label="Functions">
          {ORDER.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={fn === f}
              onClick={() => pick(f)}
            >
              <code>{FNS[f].call}()</code>
              <span>{FNS[f].kind}</span>
              {fn === f && (
                <i
                  className="fn-bar"
                  data-timed={(!touched && !reduce) || undefined}
                  key={f}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>

        <div className="circuit-body">
          <pre className="circuit-code" key={fn}>
            <code>
              <span className="code-comment">// {FNS[fn].says}</span>
              {"\n"}
              {FNS[fn].code}
            </code>
          </pre>
          <div className="circuit-loop">
            <Loop fn={fn} reduce={reduce} />
          </div>
        </div>

        <LiveRows fn={fn} machines={machines} machineId={machineId} />
      </div>
    </section>
  );
}

const LABELS: Record<NodeId, [string, string]> = {
  page: ["This page", ""],
  action: ["Convex action", ""],
  boxd: ["boxd API", ""],
  vm: ["microVM", ""],
  query: ["Convex query", ""],
  tables: ["Component tables", ""],
};

function Loop({ fn, reduce }: { fn: Fn; reduce: boolean }) {
  const narrow = useNarrow();
  const L = narrow ? LAYOUTS.tall : LAYOUTS.wide;
  const route = fn === "list" ? L.list : L.full;
  const on = new Set(FNS[fn].nodes);
  const vmSub = fn === "exec" ? "runs the command" : "boots or wakes";

  return (
    <svg
      className="loop"
      viewBox={`0 0 ${L.w} ${L.h}`}
      role="img"
      aria-label={`The path a ${FNS[fn].call} call takes: ${FNS[fn].nodes.map((n) => LABELS[n][0]).join(", then ")}`}
    >
      <defs>
        <radialGradient id="pulse-glow">
          <stop offset="0" stopColor="rgb(224 90 109)" stopOpacity="0.9" />
          <stop offset="1" stopColor="rgb(224 90 109)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <path className="wire" d={L.full} />
      <path className="wire-on" d={route} key={`on-${fn}-${narrow}`} />

      {!reduce && (
        <g key={`pulse-${fn}-${narrow}`}>
          <circle r="22" fill="url(#pulse-glow)">
            <animateMotion
              dur={fn === "list" ? "1.8s" : "3.2s"}
              repeatCount="indefinite"
              path={route}
            />
          </circle>
          <circle r="3.5" fill="#fff">
            <animateMotion
              dur={fn === "list" ? "1.8s" : "3.2s"}
              repeatCount="indefinite"
              path={route}
            />
          </circle>
        </g>
      )}

      {(Object.keys(L.nodes) as NodeId[]).map((id) => {
        const n = L.nodes[id];
        const [title, sub] = LABELS[id];
        const active = on.has(id);
        return (
          <g key={id} className="node" data-on={active || undefined}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="7" />
            <text
              className="node-title"
              x={n.x + 12}
              y={
                id === "tables" || id === "vm" ? n.y + 22 : n.y + n.h / 2 + 4.5
              }
            >
              {title}
            </text>
            {id === "tables" ? (
              <>
                <text
                  className="node-row"
                  data-hot={fn === "create" || fn === "list" || undefined}
                  x={n.x + 12}
                  y={n.y + 44}
                >
                  machines
                </text>
                <text
                  className="node-row"
                  data-hot={fn === "exec" || fn === "list" || undefined}
                  x={narrow ? n.x + 12 : n.x + 104}
                  y={narrow ? n.y + 64 : n.y + 44}
                >
                  executions
                </text>
              </>
            ) : (
              <text className="node-sub" x={n.x + 12} y={n.y + 40}>
                {id === "vm" ? vmSub : sub}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The visitor's actual rows in the component, from the same live queries. */
function LiveRows({
  fn,
  machines,
  machineId,
}: {
  fn: Fn;
  machines: Machine[];
  machineId: string | undefined;
}) {
  const now = useNow();
  const executions = useQuery(
    api.demo.executions,
    fn === "exec" && machineId ? { machineId } : "skip",
  );
  const table = fn === "exec" ? "executions" : "machines";

  return (
    <div className="rows">
      <p className="rows-head">
        <span className="live-dot" data-live />
        <span>
          Your rows in <code>{table}</code>, live
        </span>
      </p>
      {table === "machines" ? (
        machines.length === 0 ? (
          <p className="rows-empty">Boot a machine to see its row.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>status</th>
                <th>vcpu</th>
                <th>forkedFrom</th>
                <th>updatedAt</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.machineId}>
                  <td>{m.name}</td>
                  <td>
                    <span className="cell-flash" key={m.status}>
                      {m.status}
                    </span>
                  </td>
                  <td>{m.vcpu ?? "–"}</td>
                  <td className="dim">{m.forkedFrom ?? "–"}</td>
                  <td className="dim">
                    <span className="cell-flash" key={m.updatedAt}>
                      {ago(m.updatedAt, now)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : !executions || executions.length === 0 ? (
        <p className="rows-empty">
          {machineId
            ? "Run a command to see its row."
            : "Boot a machine to see its rows."}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>command</th>
              <th>status</th>
              <th>exitCode</th>
              <th>startedAt</th>
            </tr>
          </thead>
          <tbody>
            {executions.slice(0, 5).map((e) => (
              <tr key={e._id}>
                <td className="cmd-cell">{e.command}</td>
                <td>
                  <span className="cell-flash" key={e.status}>
                    {e.status}
                  </span>
                </td>
                <td>{e.exitCode ?? "–"}</td>
                <td className="dim">{ago(e.startedAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
