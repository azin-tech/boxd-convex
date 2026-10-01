![boxd: composable computers on Convex](https://raw.githubusercontent.com/azin-tech/boxd-convex/main/assets/banner.png)

# boxd for Convex

Run [boxd](https://boxd.sh) machines from your Convex backend. Each machine is a
full Linux microVM with its own disk, memory and HTTPS URL. It cold-boots in
under 10 ms, forks like a git branch in under 200 ms, and sleeps and wakes with
its memory intact.

The component keeps a reactive row for every machine and every command it runs,
so your UI subscribes to machine state and command output with a plain Convex
query.

- Create, fork, pause, resume, hibernate, wake, stop, start and destroy
  machines.
- Run commands and read and write files.
- Put a port on the public internet: `https://<machine>.boxd.sh`.
- Scope every machine to a user or tenant of your app.
- Get stable error codes to branch on (`NOT_FOUND`, `CONFLICT`, ...).

## Install

```sh
npm install @boxd-sh/convex
```

Create an API key with the [boxd CLI](https://docs.boxd.sh) and set it on your
deployment:

```sh
boxd auth keys create convex
npx convex env set BOXD_API_KEY bxd_...
```

A key is fenced to one boxd org. Machines are created in, and billed to, that
org.

Install the component in `convex/convex.config.ts`, and bind the key into it:

```ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import boxd from "@boxd-sh/convex/convex.config.js";

const app = defineApp({
  env: { BOXD_API_KEY: v.string() },
});

app.use(boxd, { env: { BOXD_API_KEY: app.env.BOXD_API_KEY } });

export default app;
```

The key goes into the component's own environment, so it never travels as a
function argument.

## Use it

```ts
// convex/machines.ts
import { Boxd } from "@boxd-sh/convex";
import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  action,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";

const boxd = new Boxd(components.boxd);

// The component can't see your users, so derive the owner from your auth.
// Never take it from a client argument.
async function ownerId(ctx: QueryCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.subject;
}

export const createMachine = action({
  args: {},
  handler: async (ctx) => {
    return await boxd.create(ctx, {
      ownerId: await ownerId(ctx),
      vcpu: 1,
      autoSuspendSeconds: 300,
    });
  },
});

export const run = action({
  args: { machineId: v.string(), command: v.string() },
  handler: async (ctx, { machineId, command }) => {
    return await boxd.exec(ctx, {
      ownerId: await ownerId(ctx),
      machineId,
      command,
    });
  },
});

// Reactive: re-runs whenever a machine changes state.
export const myMachines = query({
  args: {},
  handler: async (ctx) => boxd.list(ctx, { ownerId: await ownerId(ctx) }),
});

// Reactive: every command's status and output, newest first.
export const history = query({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }) =>
    boxd.listExecutions(ctx, { machineId, ownerId: await ownerId(ctx) }),
});
```

`example/convex/example.ts` wraps every method this way.

## API

Every method takes the Convex `ctx` first. Reads run in queries. Everything that
calls boxd runs in actions.

| Method                                    | What it does                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `create(ctx, args)`                       | Create a machine. Waits until it accepts a command, unless `waitUntilReady: false` |
| `fork(ctx, { machineId })`                | Copy a machine, disk and memory, into a new one with the same owner                |
| `exec(ctx, { machineId, command })`       | Run a command, wait for it to exit, record it. `command` is a string or an argv    |
| `readFile` / `readFileBytes`              | Read a UTF-8 file as text, or any file byte for byte                               |
| `writeFile(ctx, { path, content })`       | Write text or bytes. The parent directory must exist                               |
| `listDir(ctx, { path })`                  | List a directory                                                                   |
| `expose(ctx, { machineId, port, name? })` | Route public HTTPS to a port. Returns the URL                                      |
| `pause` / `resume`                        | Freeze in RAM, and thaw                                                            |
| `hibernate` / `wake`                      | Save memory to disk and free the host, and restore                                 |
| `stop` / `start`                          | Shut down and cold boot. The disk is kept                                          |
| `refresh(ctx, { machineId })`             | Re-read the machine from boxd into its row                                         |
| `destroy(ctx, { machineId })`             | Destroy the machine. Its row and history stay, with status `destroyed`             |
| `get` / `list`                            | Machine rows, reactive                                                             |
| `listExecutions` / `getExecution`         | Command history, reactive                                                          |

`create` takes `name`, `image`, `env`, `vcpu` or `memory` (size classes 1, 2 or
4 vCPU with 4, 8 or 16 GiB), `autoSuspendSeconds`, `autoDestroySeconds` and
`isolated`. The component never stores `env`.

### Owners

Pass `ownerId` on every call. A machine created with an `ownerId` is reachable
only with that same `ownerId`, and one created without one only without one. For
any other owner, reads return `null` or `[]`, and actions fail with `NOT_FOUND`,
the same as for a machine that doesn't exist. A fork gets its source's owner.

### Sleeping machines

A paused or hibernated machine wakes by itself when it gets a command or an
HTTPS request, so `exec` works without a `resume` first. Every transition is
idempotent: `resume` on a running machine succeeds.

### Errors

Errors are `ConvexError`s with `data: { code, message }`. Branch on the code
with `isBoxdError`:

```ts
import { isBoxdError } from "@boxd-sh/convex";

try {
  await boxd.refresh(ctx, { machineId, ownerId });
} catch (error) {
  if (isBoxdError(error, "NOT_FOUND")) return null;
  throw error;
}
```

| Code                | Meaning                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `INVALID_ARGUMENT`  | An argument is wrong. Nothing was sent to boxd                        |
| `NOT_FOUND`         | No such machine for this owner, or no such file                       |
| `CONFLICT`          | The machine's state doesn't allow this, e.g. `pause` when stopped     |
| `UNAUTHENTICATED`   | `BOXD_API_KEY` is missing, invalid, expired or revoked                |
| `PERMISSION_DENIED` | The key's org may not do this                                         |
| `RATE_LIMITED`      | A quota or rate limit, e.g. the org's machine quota                   |
| `TIMEOUT`           | A command ran past its `timeoutMs`, or a machine wasn't ready in time |
| `UNAVAILABLE`       | boxd could not be reached                                             |
| `BOXD_ERROR`        | Anything else                                                         |

A failed lifecycle call also stores its message in the machine's `lastError`.
The next successful call clears it.

When `create` or `fork` makes a machine that then fails to become ready, the
error's `data.machineId` names it. The machine exists, and bills, until you
destroy it, so act on that id instead of creating another machine.

## Limits

- **10 minute actions.** Convex stops an action after 10 minutes, so `exec`
  kills its command after `timeoutMs`: default 9 minutes, at most 9.5. For
  longer work, start it in the background (`nohup ... &`) and check on it with
  later commands.
- **Output.** `exec` returns up to 2 million characters per stream. The
  execution row keeps the first 64,000.
- **Files.** `readFile`, `readFileBytes` and `writeFile` move at most 8 MiB.
  Move bigger files with `exec`, for example with `curl`.
- **New named routes.** `expose` with a `name` returns at once, but the new URL
  answers HTTPS only after boxd issues its certificate, typically 15 to 20
  seconds later. The default URL answers at once.

## How it works

The component calls boxd through the
[`@boxd-sh/sdk`](https://www.npmjs.com/package/@boxd-sh/sdk) web entry, which
runs in Convex's default runtime. It exchanges the API key for a session token
once, keeps the token in its own table, and reuses it until it nears expiry.
boxd rate-limits that exchange per source IP, and Convex deployments share their
egress IPs, so each action must not exchange the key again. If boxd revokes the
token early, the component exchanges the key again and retries the call once.

## Testing your app

Register the component with `convex-test`:

```ts
import { convexTest } from "convex-test";
import boxdTest from "@boxd-sh/convex/test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const t = convexTest(schema, modules);
boxdTest.register(t);
```

To keep tests off the network, mock `@boxd-sh/sdk/web` with `vi.mock`. The
component's own tests do this: see `src/component/setup.test.ts`.

## Developing this component

```sh
npm install
npm run build:codegen   # codegen and build dist/
npm run check           # build, typecheck, lint, format check, unit tests
npm run test:live       # the example app against real boxd machines
```

`test:live` runs the example app on an anonymous local Convex backend, with no
Convex account and nothing uploaded, against real boxd machines. It needs
`BOXD_API_KEY` in the environment or in `.env.e2e.local`, and destroys every
machine it creates.

`demo/` is the public demo: a small React page (`demo/src`) that boots a
machine, runs commands and forks it, all through the component, with its own
Convex backend in `demo/convex`. That backend adds the parts a public page needs
on top of the component: anonymous sign-in, an optional password
(`DEMO_PASSWORD`), per-visitor machine caps, rate limits, and a cron that
destroys each machine after ten minutes. Demo machines are `isolated`, so
visitor commands can't reach boxd or other machines. Run it with
`npx convex dev` and `npm run dev:demo`, or build it with `npm run build:demo`.

`example/convex` is a reference app that wraps the whole API with no limits. It
backs the unit and live tests and is never deployed alongside the demo, since
its functions are open to any signed-in user.

## License

MIT
