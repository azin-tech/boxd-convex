/**
 * Live end-to-end test: the example app on a real, anonymous, local Convex
 * backend, against real boxd machines. It exercises the packaged component
 * (built `dist/`) inside Convex's actual runtime, which `convex-test`'s
 * edge-runtime simulation can't fully match, and verifies each outcome
 * independently: over HTTPS, in the component's tables, and through the
 * boxd SDK directly.
 *
 * Nothing is uploaded: the Convex deployment is local, and every machine the
 * run creates is destroyed at the end, even when a check fails.
 *
 * Needs BOXD_API_KEY (the environment or `.env.e2e.local`). BOXD_BASE_URL
 * points it at another boxd cluster.
 *
 *   npm run build:codegen && npm run test:live
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Boxd } from "@boxd-sh/sdk";

// ---- Setup ------------------------------------------------------------------

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

loadEnvFile(".env.e2e.local");
const apiKey = process.env.BOXD_API_KEY;
const baseURL = process.env.BOXD_BASE_URL;
if (!apiKey) {
  console.error("BOXD_API_KEY is required (environment or .env.e2e.local)");
  process.exit(1);
}
if (!existsSync("dist/component/convex.config.js")) {
  console.error("dist/ is missing: run `npm run build:codegen` first");
  process.exit(1);
}

// The locally installed Convex CLI, through this Node: no npx, no shell, so
// JSON arguments are never re-parsed.
const convexBin = join(
  dirname(createRequire(import.meta.url).resolve("convex/package.json")),
  "bin/main.js",
);

function convex(...args) {
  return execFileSync(process.execPath, [convexBin, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
  });
}

const identities = {
  alice: { subject: "alice", issuer: "https://example.test" },
  bob: { subject: "bob", issuer: "https://example.test" },
};

/** Run an example function as `user`; rejects with the Convex error text. */
function run(fn, args = {}, user = "alice") {
  const cli = ["run", fn, JSON.stringify(args)];
  if (user) cli.push("--identity", JSON.stringify(identities[user]));
  try {
    const out = convex(...cli).trim();
    return out ? JSON.parse(out) : null;
  } catch (error) {
    throw new Error(String(error.stderr || error.message).trim());
  }
}

/** Read the component's own tables. */
function inlineQuery(code) {
  const out = convex("run", "--component", "boxd", "--inline-query", code);
  return JSON.parse(out.trim());
}

let checks = 0;
function check(condition, message, detail) {
  if (!condition) {
    throw new Error(
      `FAILED: ${message}${detail === undefined ? "" : `\n  got: ${JSON.stringify(detail)}`}`,
    );
  }
  checks++;
  console.log(`  ✓ ${message}`);
}

async function timed(label, fn) {
  const started = Date.now();
  const result = await fn();
  console.log(`• ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  return result;
}

/**
 * GET `url` until it answers 200 or `windowMs` passes. A new named route
 * refuses TLS until boxd has issued its certificate, typically 15-20 s.
 */
async function fetchText(url, windowMs = 90_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < windowMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
      });
      last = `${response.status} ${(await response.text()).trim()}`;
      if (response.ok) {
        console.log(
          `    ${url} answered after ${((Date.now() - started) / 1000).toFixed(0)}s`,
        );
        return last;
      }
    } catch (error) {
      last = String(error.cause?.code ?? error.cause?.message ?? error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return last;
}

const sdk = new Boxd({ apiKey, baseURL });
const created = new Set();

// ---- The run ------------------------------------------------------------------

async function main() {
  await timed("deploy the example app to a local Convex backend", () => {
    if (!existsSync(".env.local")) convex("init");
    convex("env", "set", "BOXD_API_KEY", apiKey);
    // The local deployment persists its env, so clear a base URL an earlier
    // run left behind, or production keys go to that cluster.
    if (baseURL) convex("env", "set", "BOXD_BASE_URL", baseURL);
    else convex("env", "remove", "BOXD_BASE_URL");
    convex("dev", "--once", "--typecheck", "enable");
  });
  // A failed run's cleanup destroys its machines through the SDK, behind the
  // component's back. Reconcile those rows through the component, which
  // treats "already gone on boxd" as destroyed.
  const leftovers = inlineQuery(
    'return (await ctx.db.query("machines").collect()).filter((m) => m.status !== "destroyed").map((m) => ({ machineId: m.machineId, ownerId: m.ownerId ?? null }))',
  );
  for (const { machineId, ownerId } of leftovers) {
    if (!(ownerId in identities)) continue;
    run("example:destroyMachine", { machineId }, ownerId);
    console.log(`  reconciled leftover ${machineId}`);
  }
  const live = inlineQuery(
    'return (await ctx.db.query("machines").collect()).filter((m) => m.status !== "destroyed").length',
  );
  check(live === 0, "no live machine is left over from an earlier run", live);
  // Drop any session an earlier run cached, so this run starts with a key
  // exchange and the token check at the end is exact.
  const sessionsQuery =
    'return (await ctx.db.query("sessions").collect()).map((s) => ({ keyHash: s.keyHash, token: s.token, expiresAt: s.expiresAt }))';
  for (const { keyHash, token } of inlineQuery(sessionsQuery)) {
    convex(
      "run",
      "--component",
      "boxd",
      "sessions:drop",
      JSON.stringify({ keyHash, token }),
    );
  }

  // Lifecycle: create -------------------------------------------------------
  const suffix = Date.now().toString(36);
  const machine = await timed("create a machine as alice", () =>
    run("example:createMachine", { name: `convex-e2e-${suffix}` }),
  );
  created.add(machine.machineId);
  check(
    machine.status === "running",
    "create waits until the machine is running",
    machine.status,
  );
  check(machine.ownerId === "alice", "the owner comes from alice's identity");
  check(
    /^https:\/\//.test(machine.url),
    `it has an HTTPS URL (${machine.url})`,
  );
  check(machine.vcpu === 1, "the requested size reached boxd", machine.vcpu);
  const direct = await sdk.machines.get(machine.machineId);
  check(
    direct.status === "running" && direct.name === machine.name,
    "boxd itself reports the machine running",
  );
  const id = { machineId: machine.machineId };
  const [firstSession] = inlineQuery(sessionsQuery);

  // Exec -------------------------------------------------------------------
  await timed("exec", () => {
    const uname = run("example:runCommand", { ...id, command: "uname -s" });
    check(
      uname.stdout.trim() === "Linux" && uname.exitCode === 0,
      "a shell command runs",
      uname,
    );
    const argv = run("example:runCommand", {
      ...id,
      command: ["sh", "-c", 'printf "%s|" "$@"', "_", "a b", "it's", "$HOME"],
    });
    check(
      argv.stdout === "a b|it's|$HOME|",
      "argv arguments arrive exactly, no shell expansion",
      argv.stdout,
    );
    const failing = run("example:runCommand", {
      ...id,
      command: "echo oops >&2; exit 7",
    });
    check(
      failing.exitCode === 7 && !failing.success && failing.stderr === "oops\n",
      "a failing command reports its exit code and stderr",
      failing,
    );
    const cwd = run("example:runCommand", {
      ...id,
      command: "pwd",
      cwd: "/tmp",
    });
    check(cwd.stdout.trim() === "/tmp", "cwd is honoured", cwd.stdout);
    let timeoutError = "";
    try {
      run("example:runCommand", {
        ...id,
        command: "sleep 30",
        timeoutMs: 2_000,
      });
    } catch (error) {
      timeoutError = error.message;
    }
    check(
      /"code":"TIMEOUT"/.test(timeoutError),
      "a command over its timeout fails with TIMEOUT",
      timeoutError,
    );
  });

  // Executions table ---------------------------------------------------------
  const executions = run("example:executions", id);
  check(executions.length === 5, "every exec was recorded", executions.length);
  check(
    executions[0].status === "failed" && /timed out/.test(executions[0].error),
    "the timed-out exec is recorded as failed",
    executions[0],
  );
  check(
    executions
      .slice(1)
      .every((e) => e.status === "completed" && e.finishedAt >= e.startedAt),
    "the others are recorded as completed, with timings",
  );
  check(
    executions.some(
      (e) =>
        e.command === `sh -c 'printf "%s|" "$@"' _ 'a b' 'it'"'"'s' '$HOME'`,
    ),
    "an argv exec is stored as a shell would read it",
    executions.map((e) => e.command),
  );
  const one = run("example:execution", { executionId: executions[1]._id });
  check(one?._id === executions[1]._id, "one execution reads back by id");

  // Files ------------------------------------------------------------------
  const text = "héllo from convex ✓\n";
  await timed("files", () => {
    run("example:runCommand", { ...id, command: "mkdir -p /tmp/e2e" });
    const written = run("example:writeFile", {
      ...id,
      path: "/tmp/e2e/note.txt",
      content: text,
    });
    check(
      written.bytesWritten === Buffer.byteLength(text),
      "writeFile reports the UTF-8 byte count",
      written,
    );
    check(
      run("example:readFile", { ...id, path: "/tmp/e2e/note.txt" }) === text,
      "readFile returns the same text",
    );
    const onDisk = run("example:runCommand", {
      ...id,
      command: "sha256sum /tmp/e2e/note.txt",
    });
    check(
      onDisk.stdout.startsWith(createHash("sha256").update(text).digest("hex")),
      "the bytes on the machine's disk match",
    );
    run("example:runCommand", {
      ...id,
      command: "head -c 4096 /dev/urandom > /tmp/e2e/random.bin",
    });
    const bytes = run("example:readFileBytes", {
      ...id,
      path: "/tmp/e2e/random.bin",
    });
    const decoded = Buffer.from(bytes.$bytes, "base64");
    const remoteSum = run("example:runCommand", {
      ...id,
      command: "sha256sum /tmp/e2e/random.bin",
    });
    check(
      decoded.length === 4096 &&
        remoteSum.stdout.startsWith(
          createHash("sha256").update(decoded).digest("hex"),
        ),
      "readFileBytes returns binary data byte for byte",
    );
    const listing = run("example:listDir", { ...id, path: "/tmp/e2e" });
    check(
      listing.entries
        .map((e) => e.name)
        .sort()
        .join(",") === "note.txt,random.bin",
      "listDir lists the directory",
      listing.entries.map((e) => e.name),
    );
    let relative = "";
    try {
      run("example:readFile", { ...id, path: "tmp/e2e/note.txt" });
    } catch (error) {
      relative = error.message;
    }
    check(
      /"code":"INVALID_ARGUMENT"/.test(relative),
      "a relative path is refused with INVALID_ARGUMENT",
    );
  });

  // Preview URLs -----------------------------------------------------------
  await timed("preview URLs", async () => {
    run("example:runCommand", {
      ...id,
      command:
        "mkdir -p /tmp/www8080 /tmp/www3000 && echo port-8080 > /tmp/www8080/index.html && echo port-3000 > /tmp/www3000/index.html && " +
        "(cd /tmp/www8080 && nohup python3 -m http.server 8080 >/dev/null 2>&1 &) && (cd /tmp/www3000 && nohup python3 -m http.server 3000 >/dev/null 2>&1 &) && sleep 1",
    });
    const main = run("example:preview", { ...id, port: 8080 });
    check(
      main.url === machine.url,
      "the default route keeps the machine's URL",
      main,
    );
    const mainBody = await fetchText(main.url);
    check(
      mainBody === "200 port-8080",
      "the default URL serves port 8080 over HTTPS",
      mainBody,
    );
    const named = run("example:preview", { ...id, port: 3000, name: "api" });
    check(
      named.url === machine.url.replace("https://", "https://api."),
      `a named route is added (${named.url})`,
    );
    const namedBody = await fetchText(named.url);
    check(
      namedBody === "200 port-3000",
      "the named URL serves port 3000 over HTTPS",
      namedBody,
    );
  });

  // Sleep and wake -----------------------------------------------------------
  await timed("pause and resume", () => {
    const paused = run("example:pauseMachine", id);
    check(
      paused.status === "suspended",
      "pause suspends the machine",
      paused.status,
    );
    const resumed = run("example:resumeMachine", id);
    check(
      resumed.status === "running",
      "resume brings it back",
      resumed.status,
    );
    const again = run("example:resumeMachine", id);
    check(
      again.status === "running" && !again.lastError,
      "resume on a running machine is a no-op, not an error",
      again,
    );
  });
  await timed("hibernate and wake, memory kept", () => {
    const pid = run("example:runCommand", {
      ...id,
      command: "nohup sleep 100000 >/dev/null 2>&1 & echo $!",
    }).stdout.trim();
    const hibernated = run("example:hibernateMachine", id);
    check(
      hibernated.status === "hibernated",
      "hibernate waits until boxd reports hibernated",
      hibernated.status,
    );
    const woken = run("example:wakeMachine", id);
    check(woken.status === "running", "wake restores it", woken.status);
    const alive = run("example:runCommand", {
      ...id,
      command: `kill -0 ${pid} && echo alive`,
    });
    check(
      alive.stdout.trim() === "alive",
      `a process started before hibernation still runs (pid ${pid})`,
    );
  });

  // Fork -------------------------------------------------------------------
  const fork = await timed("fork", () => run("example:forkMachine", id));
  created.add(fork.machineId);
  check(
    fork.status === "running" &&
      fork.forkedFrom === machine.machineId &&
      fork.ownerId === "alice",
    "the fork runs, records its source, and keeps the owner",
    fork,
  );
  check(
    run("example:readFile", {
      machineId: fork.machineId,
      path: "/tmp/e2e/note.txt",
    }) === text,
    "the fork has the source's files",
  );
  run("example:writeFile", {
    machineId: fork.machineId,
    path: "/tmp/e2e/fork-only.txt",
    content: "x",
  });
  const sourceView = run("example:runCommand", {
    ...id,
    command: "ls /tmp/e2e",
  }).stdout;
  check(
    !sourceView.includes("fork-only.txt"),
    "a write in the fork doesn't touch the source",
  );

  // Tenancy ----------------------------------------------------------------
  await timed("tenancy", () => {
    check(
      run("example:myMachines", {}, "bob").length === 0,
      "bob sees none of alice's machines",
    );
    check(
      run("example:machine", id, "bob") === null,
      "bob can't read alice's machine",
    );
    check(
      run("example:executions", id, "bob").length === 0,
      "bob can't read alice's executions",
    );
    check(
      run("example:refreshOrNull", id, "bob") === null,
      "the NOT_FOUND code reaches the app intact",
    );
    let refused = "";
    try {
      run("example:runCommand", { ...id, command: "id" }, "bob");
    } catch (error) {
      refused = error.message;
    }
    check(
      /"code":"NOT_FOUND"/.test(refused),
      "bob's exec on alice's machine is refused as NOT_FOUND",
    );
    let signedOut = "";
    try {
      run("example:createMachine", {}, null);
    } catch (error) {
      signedOut = error.message;
    }
    check(/Sign in/.test(signedOut), "a signed-out caller is refused");
  });

  // Stop and start -----------------------------------------------------------
  await timed("stop and start, disk kept", () => {
    run("example:runCommand", {
      ...id,
      command: "echo persisted > ~/e2e-persist.txt && sync",
    });
    const stopped = run("example:stopMachine", id);
    check(
      stopped.status === "stopped",
      "stop shuts the machine down",
      stopped.status,
    );
    const started = run("example:startMachine", id);
    check(started.status === "running", "start boots it again", started.status);
    const kept = run("example:runCommand", {
      ...id,
      command: "cat ~/e2e-persist.txt",
    });
    check(
      kept.stdout.trim() === "persisted",
      "a file on disk survives the cold boot",
      kept,
    );
  });

  // Token cache ------------------------------------------------------------
  const sessions = inlineQuery(sessionsQuery);
  check(
    sessions.length === 1 && sessions[0].token === firstSession.token,
    "every call in this run shared the one session token exchanged at the start",
    sessions.map((session) => ({
      sameToken: session.token === firstSession.token,
    })),
  );

  // Destroy ----------------------------------------------------------------
  await timed("destroy", async () => {
    for (const machineId of [fork.machineId, machine.machineId]) {
      const row = run("example:destroyMachine", { machineId });
      check(row.status === "destroyed", `destroy marks ${machineId} destroyed`);
      const gone = await sdk.machines.get(machineId).then(
        () => false,
        (error) => error.name === "NotFoundError",
      );
      check(gone, "boxd no longer has it");
      created.delete(machineId);
    }
    const again = run("example:destroyMachine", id);
    check(again.status === "destroyed", "destroying twice is not an error");
    const history = run("example:executions", id);
    check(history.length > 5, "the destroyed machine's history stays readable");
  });

  console.log(`\nALL ${checks} LIVE CHECKS PASSED`);
}

try {
  await main();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  // Never leave a machine running, whatever failed.
  for (const machineId of created) {
    try {
      await sdk.machines.delete(machineId);
      console.log(`cleanup: destroyed ${machineId}`);
    } catch (error) {
      if (error.name !== "NotFoundError") {
        console.error(`cleanup FAILED for ${machineId}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
  await sdk.close();
}
