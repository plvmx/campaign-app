import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Ban console.log/warn/error in production code — use structured error handling instead
      "no-console": "warn",
      // Disallow `any` — forces explicit typing
      "@typescript-eslint/no-explicit-any": "error",
      // Warn on non-null assertions — prefer explicit null checks
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Catch unused variables (stricter than default)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
]);

export default eslintConfig;
