# Publishing

Nothing here is published yet.

The component needs `@boxd-sh/sdk` 0.2.13 or later. Earlier versions hold a
literal `import("node:fs/promises")` in the web entry, which Convex's
default-runtime bundler refuses. Never lower that floor in `package.json`.

1. Check everything, against real boxd too:

   ```sh
   npm ci
   npm run build:clean
   npm run check
   npm run test:live
   ```

   `test:live` runs against production unless `BOXD_BASE_URL` is set.

2. Check the package contents: `npm pack --dry-run`. It holds `dist/`, `src/`
   without tests, `README.md`, `LICENSE` and `package.json`.

3. Set the date in `CHANGELOG.md`, then set the version. The first release ships
   `0.1.0` as it stands in `package.json`, so tag it instead of bumping:

   ```sh
   git tag v0.1.0              # first release
   npm version <patch|minor|major>   # every later release
   ```

4. Publish, and push the tag:

   ```sh
   npm publish --access public
   git push --follow-tags
   ```

5. Submit the package on the
   [Convex components directory](https://www.convex.dev/components).
