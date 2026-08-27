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
    // Isolated git worktrees the Agent tool creates for a subagent — the same
    // defect as `ios/**` above, arriving through a different door. A live
    // worktree is a second complete copy of `src/`, so ESLint lints every file
    // twice and reports the duplicates under a path nobody edited; once the
    // agent has run a build in there it is also a second `.next/`, and the run
    // goes from 9 warnings to 604 errors and 6132 warnings. Measured
    // 2026-08-27.
    //
    // `.gitignore` covers this directory and CANNOT fix it: there is no
    // `includeIgnoreFile` here, so ESLint never reads that file, and a bare
    // `eslint` descends into a dot-directory happily. `tsc` needs no equivalent
    // — `include`'s `**/*.ts[x]` does not descend into a dotted directory at
    // all, which is glob expansion rather than git-awareness.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
