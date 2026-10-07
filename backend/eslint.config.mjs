// Lint: correctness-focused rules (not style — formatting is left to editors).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "prisma/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node }, ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-require-imports": "off", // prisma CLI is resolved with require.resolve in ops/migrate.ts
      "no-control-regex": "off", // text sanitisers intentionally match control characters
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  }
);
