/**
 * Argument checks that Convex validators can't express. Each one runs before
 * any remote call or row write, and throws `INVALID_ARGUMENT`.
 */

import { invalidArgument } from "./errors.js";

/**
 * A caller-supplied timeout, validated and capped. A value that is not a
 * positive number fails loudly instead of meaning "no limit".
 */
export function boundedTimeout(
  requested: number | undefined,
  fallback: number,
  max: number,
  field: string,
): number {
  if (requested === undefined) return fallback;
  if (!Number.isFinite(requested) || requested <= 0) {
    throw invalidArgument(
      `${field} must be a positive number of milliseconds, got ${requested}`,
    );
  }
  return Math.min(Math.floor(requested), max);
}

export function requirePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw invalidArgument(`port must be an integer in 1-65535, got ${port}`);
  }
  return port;
}

const SUBDOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A proxy name is one DNS label: `<name>.<machine>.<zone>`. */
export function requireSubdomainLabel(name: string): string {
  if (!SUBDOMAIN_LABEL.test(name)) {
    throw invalidArgument(
      `name must be one DNS label (lowercase letters, digits and inner hyphens), got ${JSON.stringify(name)}`,
    );
  }
  return name;
}

export function requireAbsolutePath(path: string): string {
  if (!path.startsWith("/")) {
    throw invalidArgument(`path must be absolute, got ${JSON.stringify(path)}`);
  }
  return path;
}

export function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw invalidArgument(`${field} must not be empty`);
  }
  return value;
}
