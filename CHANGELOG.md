# Changelog

## 0.1.1 (2026-10-02)

- Docs only. The API table shows the `ownerId` every machine call needs (a
  `fork` without it is `NOT_FOUND` for a machine created with an owner), and
  `machineId` on `writeFile` and `listDir`.
- Separate boxd's boot and fork times from what `create` and `fork` take through
  the component, which also waits until the machine accepts a command.
- Explain that `refresh` picks up changes boxd makes on its own, like
  auto-suspend.
- Note that a brand-new Convex project needs a deployment before the key can be
  set.

## 0.1.0 (2026-10-01)

- First release: create, fork, pause, resume, hibernate, wake, stop, start,
  refresh and destroy boxd machines; run commands; read, write and list files;
  expose ports over HTTPS.
- Machine options: size, `autoSuspendSeconds`, `autoDestroySeconds` and
  `isolated`, for machines that run untrusted code.
- Reactive `machines` and `executions` tables, scoped by `ownerId`.
- Coded `ConvexError`s and `isBoxdError`.
- `BOXD_API_KEY` bound through component env; one cached session token per key
  and endpoint.
