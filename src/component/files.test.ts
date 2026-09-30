/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api.js";
import { MAX_FILE_BYTES } from "./files.js";
import {
  cloud,
  initConvexTest,
  resetCloud,
  stubExchange,
} from "./setup.test.js";

vi.mock(
  "@boxd-sh/sdk/web",
  async () => (await import("./setup.test.js")).fakeSdk,
);

beforeEach(() => {
  resetCloud();
  stubExchange();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = initConvexTest();
  const { machineId } = await t.action(api.machines.create, {
    ownerId: "user-1",
  });
  return { t, target: { machineId, ownerId: "user-1" } };
}

function code(error: unknown): string {
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string }>).data.code;
}

describe("files", () => {
  test("text round-trips as UTF-8", async () => {
    const { t, target } = await setup();
    const written = await t.action(api.files.writeFile, {
      ...target,
      path: "/tmp/note.txt",
      content: "héllo wörld",
    });
    expect(written).toEqual({ bytesWritten: 13 });
    expect(
      await t.action(api.files.readFile, { ...target, path: "/tmp/note.txt" }),
    ).toBe("héllo wörld");
  });

  test("bytes round-trip unchanged", async () => {
    const { t, target } = await setup();
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    await t.action(api.files.writeFile, {
      ...target,
      path: "/tmp/blob.bin",
      content: bytes.buffer,
    });
    const read = await t.action(api.files.readFileBytes, {
      ...target,
      path: "/tmp/blob.bin",
    });
    expect(Array.from(new Uint8Array(read))).toEqual([0, 1, 127, 128, 255]);
  });

  test("readFileBytes returns only the file, not the buffer behind it", async () => {
    const { t, target } = await setup();
    // A view into the middle of a larger buffer, like a streamed download.
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    cloud.files.set(
      `${target.machineId}:/tmp/view.bin`,
      backing.subarray(2, 5),
    );
    const read = await t.action(api.files.readFileBytes, {
      ...target,
      path: "/tmp/view.bin",
    });
    expect(Array.from(new Uint8Array(read))).toEqual([1, 2, 3]);
  });

  test("readFile refuses binary data rather than mangle it", async () => {
    const { t, target } = await setup();
    cloud.files.set(
      `${target.machineId}:/tmp/image.png`,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]),
    );
    const error = await t
      .action(api.files.readFile, { ...target, path: "/tmp/image.png" })
      .catch((e: unknown) => e);
    expect(code(error)).toBe("INVALID_ARGUMENT");
    expect((error as ConvexError<{ message: string }>).data.message).toContain(
      "readFileBytes",
    );
  });

  test("listDir maps entries and timestamps", async () => {
    const { t, target } = await setup();
    await t.action(api.files.writeFile, {
      ...target,
      path: "/work/a.txt",
      content: "abc",
    });
    const listing = await t.action(api.files.listDir, {
      ...target,
      path: "/work",
    });
    expect(listing).toEqual({
      entries: [
        {
          name: "a.txt",
          isDir: false,
          sizeBytes: 3,
          permissions: "-rw-r--r--",
          modifiedAt: 1_700_000_000_000,
        },
      ],
      truncated: false,
    });
  });

  test("a missing file is NOT_FOUND", async () => {
    const { t, target } = await setup();
    const error = await t
      .action(api.files.readFile, { ...target, path: "/nope" })
      .catch((e: unknown) => e);
    expect(code(error)).toBe("NOT_FOUND");
  });

  test("relative paths and oversized files are refused", async () => {
    const { t, target } = await setup();
    cloud.calls = [];
    const relative = await t
      .action(api.files.readFile, { ...target, path: "etc/hostname" })
      .catch((e: unknown) => e);
    expect(code(relative)).toBe("INVALID_ARGUMENT");
    const oversized = await t
      .action(api.files.writeFile, {
        ...target,
        path: "/tmp/big",
        content: new ArrayBuffer(MAX_FILE_BYTES + 1),
      })
      .catch((e: unknown) => e);
    expect(code(oversized)).toBe("INVALID_ARGUMENT");
    expect(cloud.calls).toEqual([]);
  });

  test("an oversized download is refused rather than returned", async () => {
    const { t, target } = await setup();
    cloud.files.set(
      `${target.machineId}:/tmp/huge`,
      new Uint8Array(MAX_FILE_BYTES + 1),
    );
    const error = await t
      .action(api.files.readFileBytes, { ...target, path: "/tmp/huge" })
      .catch((e: unknown) => e);
    expect(code(error)).toBe("INVALID_ARGUMENT");
  });
});
