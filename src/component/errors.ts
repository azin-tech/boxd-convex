import { ConvexError, v, type Infer } from "convex/values";
import { MAX_STORED_ERROR, truncate } from "./limits.js";

export const errorCode = v.union(
  v.literal("INVALID_ARGUMENT"),
  v.literal("UNAUTHENTICATED"),
  v.literal("PERMISSION_DENIED"),
  v.literal("NOT_FOUND"),
  v.literal("CONFLICT"),
  v.literal("RATE_LIMITED"),
  v.literal("TIMEOUT"),
  v.literal("UNAVAILABLE"),
  v.literal("BOXD_ERROR"),
);

/** The `data` of every `ConvexError` this component throws. */
export type BoxdErrorData = {
  code: Infer<typeof errorCode>;
  message: string;
  /**
   * Set when `create` or `fork` made a machine but it failed to become ready:
   * the machine exists, and bills, until you destroy it.
   */
  machineId?: string;
};

// gRPC status codes, as carried on `BoxdError.grpcCode`.
const GRPC_CODES: Record<number, BoxdErrorData["code"]> = {
  3: "INVALID_ARGUMENT",
  4: "TIMEOUT",
  5: "NOT_FOUND",
  6: "CONFLICT",
  7: "PERMISSION_DENIED",
  8: "RATE_LIMITED",
  9: "CONFLICT",
  14: "UNAVAILABLE",
  16: "UNAUTHENTICATED",
};

// The SDK's own error classes, for errors raised before anything reached the
// wire (a missing credential, a failed key exchange, a dropped connection).
// Matched by name and `grpcCode` rather than `instanceof`, so the modules
// that only store and read rows never load the SDK.
const SDK_CLASSES: Record<string, BoxdErrorData["code"]> = {
  AuthenticationError: "UNAUTHENTICATED",
  PermissionDeniedError: "PERMISSION_DENIED",
  NotFoundError: "NOT_FOUND",
  ConflictError: "CONFLICT",
  RateLimitError: "RATE_LIMITED",
  APIConnectionError: "UNAVAILABLE",
};

// The SDK's client-side deadlines: "exec timed out after 5000ms", and
// "machine x did not reach 'running' within 90000ms".
const TIMEOUT_MESSAGE = /timed out|within \d+ms/i;

export function boxdError(
  code: BoxdErrorData["code"],
  message: string,
): ConvexError<BoxdErrorData> {
  return new ConvexError({ code, message });
}

export function invalidArgument(message: string): ConvexError<BoxdErrorData> {
  return boxdError("INVALID_ARGUMENT", message);
}

/** A human-readable message for any thrown value, bounded for storage. */
export function errorMessage(error: unknown): string {
  let message: string;
  if (error instanceof ConvexError) {
    const data = error.data as Partial<BoxdErrorData> | string;
    message =
      typeof data === "string" ? data : (data.message ?? String(error.data));
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return truncate(message, MAX_STORED_ERROR);
}

/**
 * Map anything thrown while talking to boxd onto a `ConvexError` with a
 * stable `code`, so the app can branch on `error.data.code` instead of
 * parsing messages. A `ConvexError` passes through unchanged.
 */
export function toConvexError(error: unknown): ConvexError<BoxdErrorData> {
  if (error instanceof ConvexError) return error as ConvexError<BoxdErrorData>;
  const message = errorMessage(error);
  if (error instanceof Error) {
    const { grpcCode } = error as { grpcCode?: unknown };
    const code =
      (typeof grpcCode === "number" ? GRPC_CODES[grpcCode] : undefined) ??
      SDK_CLASSES[error.name] ??
      (TIMEOUT_MESSAGE.test(message) ? "TIMEOUT" : "BOXD_ERROR");
    return boxdError(code, message);
  }
  return boxdError("BOXD_ERROR", message);
}

/** True when `error` says the target no longer exists on boxd. */
export function isNotFound(error: unknown): boolean {
  return toConvexError(error).data.code === "NOT_FOUND";
}
