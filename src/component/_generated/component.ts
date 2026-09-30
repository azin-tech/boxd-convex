/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    exec: {
      run: FunctionReference<
        "action",
        "internal",
        {
          command: string | Array<string>;
          cwd?: string;
          env?: Record<string, string>;
          machineId: string;
          ownerId?: string;
          timeoutMs?: number;
        },
        {
          executionId: string;
          exitCode: number;
          stderr: string;
          stdout: string;
          success: boolean;
        },
        Name
      >;
    };
    executions: {
      get: FunctionReference<
        "query",
        "internal",
        { executionId: string; ownerId?: string },
        null | {
          _creationTime: number;
          _id: string;
          command: string;
          cwd?: string;
          error?: string;
          exitCode?: number;
          finishedAt?: number;
          machineId: string;
          ownerId?: string;
          startedAt: number;
          status: "running" | "completed" | "failed";
          stderr?: string;
          stdout?: string;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { limit?: number; machineId: string; ownerId?: string },
        Array<{
          _creationTime: number;
          _id: string;
          command: string;
          cwd?: string;
          error?: string;
          exitCode?: number;
          finishedAt?: number;
          machineId: string;
          ownerId?: string;
          startedAt: number;
          status: "running" | "completed" | "failed";
          stderr?: string;
          stdout?: string;
        }>,
        Name
      >;
    };
    files: {
      listDir: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string; path: string },
        {
          entries: Array<{
            isDir: boolean;
            modifiedAt: number;
            name: string;
            permissions: string;
            sizeBytes: number;
          }>;
          truncated: boolean;
        },
        Name
      >;
      readFile: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string; path: string },
        string,
        Name
      >;
      readFileBytes: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string; path: string },
        ArrayBuffer,
        Name
      >;
      writeFile: FunctionReference<
        "action",
        "internal",
        {
          content: string | ArrayBuffer;
          machineId: string;
          ownerId?: string;
          path: string;
        },
        { bytesWritten: number },
        Name
      >;
    };
    machines: {
      create: FunctionReference<
        "action",
        "internal",
        {
          autoDestroySeconds?: number;
          autoSuspendSeconds?: number;
          env?: Record<string, string>;
          image?: string;
          isolated?: boolean;
          memory?: string;
          name?: string;
          ownerId?: string;
          readyTimeoutMs?: number;
          vcpu?: number;
          waitUntilReady?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      destroy: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      expose: FunctionReference<
        "action",
        "internal",
        { machineId: string; name?: string; ownerId?: string; port: number },
        { port: number; url: string },
        Name
      >;
      fork: FunctionReference<
        "action",
        "internal",
        {
          machineId: string;
          name?: string;
          ownerId?: string;
          readyTimeoutMs?: number;
          waitUntilReady?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { machineId: string; ownerId?: string },
        null | {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      hibernate: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { limit?: number; ownerId?: string },
        Array<{
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        }>,
        Name
      >;
      pause: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      refresh: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      resume: FunctionReference<
        "action",
        "internal",
        {
          machineId: string;
          ownerId?: string;
          readyTimeoutMs?: number;
          waitUntilReady?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      start: FunctionReference<
        "action",
        "internal",
        {
          machineId: string;
          ownerId?: string;
          readyTimeoutMs?: number;
          waitUntilReady?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      stop: FunctionReference<
        "action",
        "internal",
        { machineId: string; ownerId?: string },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
      wake: FunctionReference<
        "action",
        "internal",
        {
          machineId: string;
          ownerId?: string;
          readyTimeoutMs?: number;
          waitUntilReady?: boolean;
        },
        {
          _creationTime: number;
          _id: string;
          forkedFrom?: string;
          image?: string;
          lastError?: string;
          machineId: string;
          memoryBytes?: number;
          name: string;
          ownerId?: string;
          status: string;
          updatedAt: number;
          url?: string;
          vcpu?: number;
        },
        Name
      >;
    };
  };
