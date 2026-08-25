import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The native projects. `ios/App/App/public` is the built web bundle that
    // `cap sync` copies in — thousands of emitted files that are gitignored but
    // still on disk, so ESLint walks them and the run goes from 9 warnings to
    // 50 errors and 3369 warnings, none of them about code anyone wrote.
    // Measured 2026-08-25, the first time `ios/` existed here.
    "ios/**",
    "android/**",
  ]),
]);

export default eslintConfig;
