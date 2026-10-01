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

type Box = { x: number; y: number };
type Edge = { from: NodeId; to: NodeId; d: string };

/**
 * The loop every call travels, laid out as a ring of equal boxes: wide is a
 * 3 x 2 grid, tall (phones) a 2 x 3 one. Edges join neighbours with short
 * straight wires; `full` threads every box through their centres for the
 * comet, and `list` starts at the tables. Boxes are opaque and drawn over
 * the route, so the comet reads as passing through them.
 */
const LAYOUTS: Record<
  "wide" | "tall",
  {
    w: number;
    h: number;
    box: { w: number; h: number };
    nodes: Record<NodeId, Box>;
    edges: Edge[];
    full: string;
    list: string;
  }
> = {
  wide: {
    w: 600,
    h: 236,
    box: { w: 160, h: 60 },
    nodes: {
      page: { x: 0, y: 20 },
      action: { x: 220, y: 20 },
      boxd: { x: 440, y: 20 },
      vm: { x: 440, y: 156 },
      tables: { x: 220, y: 156 },
      query: { x: 0, y: 156 },
    },
    edges: [
      { from: "page", to: "action", d: "M160 50 H214" },
      { from: "action", to: "boxd", d: "M380 50 H434" },
      { from: "boxd", to: "vm", d: "M520 80 V150" },
      { from: "vm", to: "tables", d: "M440 186 H386" },
      { from: "tables", to: "query", d: "M220 186 H166" },
      { from: "query", to: "page", d: "M80 156 V86" },
    ],
    full: "M80 50 H520 V186 H80 V50",
    list: "M300 186 H80 V50",
  },
  tall: {
    w: 320,
    h: 340,
    box: { w: 136, h: 60 },
    nodes: {
      page: { x: 10, y: 10 },
      action: { x: 174, y: 10 },
      boxd: { x: 174, y: 140 },
      vm: { x: 174, y: 270 },
      tables: { x: 10, y: 270 },
      query: { x: 10, y: 140 },
    },
    edges: [
      { from: "page", to: "action", d: "M146 40 H168" },
      { from: "action", to: "boxd", d: "M242 70 V134" },
      { from: "boxd", to: "vm", d: "M242 200 V264" },
      { from: "vm", to: "tables", d: "M174 300 H152" },
      { from: "tables", to: "query", d: "M78 270 V206" },
      { from: "query", to: "page", d: "M78 140 V76" },
    ],
    full: "M78 40 H242 V300 H78 V40",
    list: "M78 300 V40",
  },
};

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

const LABELS: Record<NodeId, string> = {
  page: "This page",
  action: "Convex action",
  boxd: "boxd API",
  vm: "microVM",
  query: "Convex query",
  tables: "Component tables",
};

function Loop({ fn, reduce }: { fn: Fn; reduce: boolean }) {
  const narrow = useNarrow();
  const L = narrow ? LAYOUTS.tall : LAYOUTS.wide;
  const route = fn === "list" ? L.list : L.full;
  const on = new Set(FNS[fn].nodes);
  const hot = {
    machines: fn !== "exec",
    executions: fn !== "create",
  };
  const vmSub = fn === "exec" ? "runs the command" : "boots or wakes";
  const { w: bw, h: bh } = L.box;
  const key = `${fn}-${narrow}`;

  return (
    <svg
      className="loop"
      viewBox={`0 0 ${L.w} ${L.h}`}
      role="img"
      aria-label={`The path a ${FNS[fn].call} call takes: ${FNS[fn].nodes.map((n) => LABELS[n]).join(", then ")}`}
    >
      <defs>
        <marker
          id="loop-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M1 1 L7 4 L1 7" className="loop-arrowhead" />
        </marker>
        <marker
          id="loop-arrow-on"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M1 1 L7 4 L1 7" className="loop-arrowhead" data-on />
        </marker>
      </defs>

      {L.edges.map((e) => {
        const lit = on.has(e.from) && on.has(e.to);
        return (
          <path
            key={`${e.from}-${e.to}`}
            className="loop-edge"
            data-on={lit || undefined}
            d={e.d}
            markerEnd={`url(#${lit ? "loop-arrow-on" : "loop-arrow"})`}
          />
        );
      })}

      {/* The comet: a short rose trail and a bright head, running the route. */}
      {!reduce && (
        <g key={key} className="comet">
          <path d={route} pathLength={100} className="comet-trail" />
          <path d={route} pathLength={100} className="comet-head" />
        </g>
      )}

      {(Object.keys(L.nodes) as NodeId[]).map((id) => {
        const n = L.nodes[id];
        const active = on.has(id);
        const sub = id === "vm" ? vmSub : id === "tables" ? "rows" : undefined;
        return (
          <g key={id} className="node" data-on={active || undefined}>
            <rect x={n.x} y={n.y} width={bw} height={bh} rx="9" />
            <text
              className="node-title"
              x={n.x + 14}
              y={sub ? n.y + 25 : n.y + bh / 2 + 4.5}
            >
              {LABELS[id]}
            </text>
            {id === "tables" ? (
              <text
                className="node-sub"
                data-tight={narrow || undefined}
                x={n.x + 14}
                y={n.y + 44}
              >
                <tspan
                  className="node-row"
                  data-hot={hot.machines || undefined}
                >
                  machines
                </tspan>
                <tspan className="node-sep">{narrow ? "·" : " · "}</tspan>
                <tspan
                  className="node-row"
                  data-hot={hot.executions || undefined}
                >
                  executions
                </tspan>
              </text>
            ) : (
              sub && (
                <text className="node-sub" x={n.x + 14} y={n.y + 44}>
                  {sub}
                </text>
              )
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
