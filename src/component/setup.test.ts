/// <reference types="vite/client" />
/**
 * Test harness: a `convex-test` instance of the component, an in-memory fake
 * of the boxd SDK, and a stub of the key-exchange endpoint.
 *
 * The fake replaces `@boxd-sh/sdk/web` in each test file:
 *
 * ```ts
 * vi.mock("@boxd-sh/sdk/web", async () => (await import("./setup.test.js")).fakeSdk);
 * ```
 *
 * It pins the component's own logic: bookkeeping, owner fencing, error
 * codes, token caching. The wire protocol is covered by `npm run test:live`
 * against real boxd.
 */
import { convexTest } from "convex-test";
import { test, vi } from "vitest";
import schema from "./schema.js";

export const modules = import.meta.glob("./**/*.*s");

export const API_KEY = "bxd_test_key";

export function initConvexTest() {
  vi.stubEnv("BOXD_API_KEY", API_KEY);
  return convexTest(schema, modules);
}

/** An error shaped like the SDK's: a class name and a gRPC status code. */
export function sdkError(name: string, grpcCode: number, message: string) {
  return Object.assign(new Error(message), { name, grpcCode });
}

export const notFound = (what: string) =>
  sdkError("NotFoundError", 5, `${what} not found`);
export const conflict = (message: string) =>
  sdkError("ConflictError", 9, message);
export const unauthenticated = () =>
  sdkError("AuthenticationError", 16, "invalid token");

type FakeMachine = {
  id: string;
  name: string;
  status: string;
  imageRef: string;
  vcpu: number;
  memoryBytes: number;
  /** Status to move to after `pending.after` more reads, if set. */
  pending?: { status: string; after: number };
};

/** In-memory boxd: machines, files, and a log of every SDK call. */
export class FakeCloud {
  machines = new Map<string, FakeMachine>();
  files = new Map<string, Uint8Array>();
  /** `method machineId` per SDK call, in order. */
  calls: string[] = [];
  /** Tokens every SDK client was constructed with. */
  tokens: string[] = [];
  /** Params of the last create/fork/exec call. */
  lastParams: Record<string, unknown> = {};
  /** Params of the last create call, which `waitUntilReady` doesn't replace. */
  lastCreate: Record<string, unknown> = {};
  /** Errors to throw from the next call of a method, keyed by method name. */
  failures = new Map<string, Error>();
  /** Tokens boxd rejects with UNAUTHENTICATED. */
  revoked = new Set<string>();
  /** What `exec` returns. */
  execResult = { stdout: "", stderr: "", exitCode: 0 };
  /** Make the next create return a machine the component can't store. */
  malformedCreate = false;
  /** Reads a hibernation takes before boxd reports "hibernated". */
  hibernateReads = 2;
  private nextId = 1;

  add(overrides: Partial<FakeMachine> = {}): FakeMachine {
    const n = this.nextId++;
    const machine: FakeMachine = {
      id: `vm-${n}`,
      name: `machine-${n}`,
      status: "running",
      imageRef: "boxd/computer:1",
      vcpu: 2,
      memoryBytes: 8 * 1024 ** 3,
      ...overrides,
    };
    this.machines.set(machine.id, machine);
    return machine;
  }
}

export let cloud = new FakeCloud();

export function resetCloud(): FakeCloud {
  cloud = new FakeCloud();
  return cloud;
}

function view(m: FakeMachine) {
  return {
    id: m.id,
    name: m.name,
    status: m.status,
    imageRef: m.imageRef,
    resources: { vcpu: m.vcpu, memoryBytes: m.memoryBytes, diskBytes: 0 },
    access: {
      url: m.name ? `https://${m.name}.boxd.test` : "",
      domain: "boxd.test",
    },
  };
}

class FakeBoxd {
  private readonly token: string;

  constructor(options: { token?: string }) {
    this.token = options.token ?? "";
    cloud.tokens.push(this.token);
  }

  private async call<T>(
    method: string,
    machineId: string,
    run: () => T,
  ): Promise<T> {
    cloud.calls.push(`${method} ${machineId}`.trim());
    if (cloud.revoked.has(this.token)) throw unauthenticated();
    const failure = cloud.failures.get(method);
    if (failure) {
      cloud.failures.delete(method);
      throw failure;
    }
    return run();
  }

  private machine(id: string): FakeMachine {
    const m = cloud.machines.get(id);
    if (!m) throw notFound(`machine ${id}`);
    return m;
  }

  private read(id: string) {
    const m = this.machine(id);
    if (m.pending && --m.pending.after <= 0) {
      m.status = m.pending.status;
      m.pending = undefined;
    }
    return view(m);
  }

  private move(id: string, from: string[], to: string) {
    const m = this.machine(id);
    if (!from.includes(m.status)) {
      throw conflict(`VM is ${m.status} (cannot move to ${to})`);
    }
    m.status = to;
  }

  readonly machines = {
    create: (params: Record<string, unknown>) =>
      this.call("create", "", () => {
        cloud.lastParams = params;
        cloud.lastCreate = params;
        const m = cloud.add({
          status: "pending",
          ...(params.name ? { name: params.name as string } : {}),
        });
        if (cloud.malformedCreate) {
          cloud.malformedCreate = false;
          return { ...view(m), name: 42 };
        }
        return view(m);
      }),
    get: (id: string) => this.call("get", id, () => this.read(id)),
    waitUntilReady: (id: string, params: { timeout: number }) =>
      this.call("waitUntilReady", id, () => {
        cloud.lastParams = params;
        this.machine(id).status = "running";
        return view(this.machine(id));
      }),
    fork: (id: string, params: Record<string, unknown>) =>
      this.call("fork", id, () => {
        cloud.lastParams = params;
        const source = this.machine(id);
        return view(cloud.add({ status: "pending", vcpu: source.vcpu }));
      }),
    delete: (id: string) =>
      this.call("delete", id, () => {
        this.machine(id);
        cloud.machines.delete(id);
      }),
    start: (id: string) =>
      this.call("start", id, () =>
        this.move(id, ["stopped", "running"], "running"),
      ),
    stop: (id: string) =>
      this.call("stop", id, () =>
        this.move(id, ["running", "stopped"], "stopped"),
      ),
    pause: (id: string) =>
      this.call("pause", id, () => this.move(id, ["running"], "suspended")),
    resume: (id: string) =>
      this.call("resume", id, () => this.move(id, ["suspended"], "running")),
    hibernate: (id: string) =>
      this.call("hibernate", id, () => {
        this.move(id, ["running", "suspended"], "suspended");
        this.machine(id).pending = {
          status: "hibernated",
          after: cloud.hibernateReads,
        };
      }),
    wake: (id: string) =>
      this.call("wake", id, () => this.move(id, ["hibernated"], "running")),
    exec: (id: string, params: Record<string, unknown>) =>
      this.call("exec", id, () => {
        this.machine(id);
        cloud.lastParams = params;
        return {
          ...cloud.execResult,
          success: cloud.execResult.exitCode === 0,
        };
      }),
    files: {
      upload: (id: string, path: string, data: Uint8Array) =>
        this.call("upload", id, () => {
          this.machine(id);
          cloud.files.set(`${id}:${path}`, data);
          return data.byteLength;
        }),
      download: (id: string, path: string) =>
        this.call("download", id, () => {
          this.machine(id);
          const data = cloud.files.get(`${id}:${path}`);
          if (!data) throw notFound(path);
          return data;
        }),
      listDir: (id: string, path: string) =>
        this.call("listDir", id, () => {
          this.machine(id);
          const prefix = `${id}:${path.replace(/\/$/, "")}/`;
          const entries = [...cloud.files.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, data]) => ({
              name: key.slice(prefix.length),
              isDir: false,
              sizeBytes: data.byteLength,
              permissions: "-rw-r--r--",
              modifiedAt: new Date(1_700_000_000_000),
              addedAt: new Date(1_700_000_000_000),
            }));
          return { entries, truncated: false };
        }),
    },
    proxies: {
      setPort: (id: string, port: number) =>
        this.call("setPort", id, () => {
          this.machine(id);
          cloud.lastParams = { port };
        }),
      create: (id: string, name: string, port: number) =>
        this.call("createProxy", id, () => {
          this.machine(id);
          return { name, port };
        }),
    },
  };
}

export const fakeSdk = { Boxd: FakeBoxd };

/** Every key exchange the component made, and the token each returned. */
export type Exchange = { url: string; apiKey: string; token: string };

/**
 * Stub `fetch` for the key exchange. Each exchange mints `token-<n>`, valid
 * for `ttlSeconds`. `respond` overrides the response, e.g. with a 401.
 */
export function stubExchange(
  options: { ttlSeconds?: number; respond?: () => Response } = {},
): Exchange[] {
  const exchanges: Exchange[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (options.respond) return options.respond();
      const { api_key } = JSON.parse(String(init?.body)) as { api_key: string };
      const token = `token-${exchanges.length + 1}`;
      exchanges.push({ url: String(input), apiKey: api_key, token });
      const expiresAt = Date.now() / 1000 + (options.ttlSeconds ?? 3600);
      return new Response(JSON.stringify({ token, expires_at: expiresAt }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
  return exchanges;
}

test("setup", () => {});
