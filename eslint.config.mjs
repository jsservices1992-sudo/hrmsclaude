import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  /**
   * Type-aware rules, for the database layer above all.
   *
   * Every query and every transaction is a promise. Under the previous
   * synchronous driver a forgotten `await` was mostly harmless; against
   * a network database it means the write is still in flight when the
   * request returns, so the caller reports success for something that
   * may never land — and inside a transaction, that the transaction
   * commits without it. TypeScript will not catch a floating promise on
   * its own, so the compiler is given the type information and told to.
   */
  {
    files: ["app/**/*.ts", "app/**/*.tsx", "lib/**/*.ts", "db/**/*.ts"],
    /* node:test's `test()` returns a promise nobody awaits by design,
       so the rule would flag every test in the suite and teach us to
       ignore it. Application code is where a lost write matters. */
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "warn",
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
