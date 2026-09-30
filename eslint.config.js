import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import convexPlugin from "@convex-dev/eslint-plugin";

export default [
  {
    ignores: [
      "dist/**",
      "example/dist/**",
      "*.config.{js,mjs,cjs,ts}",
      "example/**/*.config.{js,mjs,cjs,ts}",
      "**/_generated/",
    ],
  },
  {
    // Type-aware linting for the shipped component and the example's Convex
    // functions. The example frontend (example/src) is checked by `tsc -p
    // example` in the typecheck script and linted below without a project.
    files: ["src/**/*.ts", "example/convex/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.json", "./example/convex/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  // Convex functions run in a worker-like runtime.
  {
    files: ["src/**/*.ts", "example/convex/**/*.ts"],
    languageOptions: { globals: globals.worker },
    plugins: { "@convex-dev": convexPlugin },
    rules: {
      ...convexPlugin.configs.recommended[0].rules,
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Node scripts.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
];
