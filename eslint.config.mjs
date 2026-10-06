// Root ESLint flat config shared by every TypeScript workspace package.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/target/**",
      "**/drizzle/**",
      "**/next-env.d.ts",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Security-relevant hygiene.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is forbidden (XSS). Render text nodes instead.",
        },
      ],
    },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/test/**",
      "**/tests/**",
      "**/scripts/**",
      "tools/**",
      "packages/verifier/src/cli.ts",
    ],
    rules: { "no-console": "off" },
  },
);
