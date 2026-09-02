# The render model — moved from the handoff 2026-09-02

> The client-rendered migration is finished and archived; this holds the route census and the
> commands that prove the shape still holds. `CLAUDE.md` §Technology Decisions carries the rule.

## The client-rendered migration is finished and archived

**Done 2026-08-06**, merged as #58. The architecture it produced is described in `CLAUDE.md`
§Technology Decisions as settled fact — read it there, not here. The change is archived at
`openspec/changes/archive/2026-08-06-migrate-to-client-rendered-shell/`; each task entry records
what that task got *wrong*, which is the part worth reading before trusting any other plan in
that directory.

**Archiving it created `openspec/specs/`, which did not exist before** — this is the repo's
first archived change, so it is also the first time the delta specs were folded into standing
ones. Four capabilities, 25 requirements: `client-render-shell`, `client-cache-invalidation`,
`client-session-storage`, `database-enforced-integrity`. Read those rather than the archived
change when you want the *current* rule; the change directory is history, the specs are the
contract. `npm run openspec -- list --json` shows what is still active.

Verify rather than trust, in one line each:

```bash
git grep -L "^'use client'" -- 'src/app/**/page.tsx'   # zero server pages — prints nothing
ls src/proxy.ts src/lib/supabase/server.ts             # both deleted — prints errors
node -p "Object.keys(require('./package.json').dependencies).length"   # 9
npm run build 2>&1 | grep -cE '^[┌├└│ ]*[ƒ●] /'         # routes the export cannot emit — 0
```

**Count `●` and `ƒ` together, and the older `ƒ`-only version is now a trap.** PD-142 moved every
detail screen to `/rides/detail?id=…`, so there is no dynamic segment left and `ƒ` alone reads
**0** — which is the right answer for the wrong reason, and would read 0 just as happily if
somebody added a `generateStaticParams()` to a resurrected `[id]` segment, because declaring one
reclassifies the route to `●` without removing the segment. What the native epic needs is
"routes `output: 'export'` refuses to emit a document for", and only the pair measures that.

**Keep `┌` in that character class.** The route table's first row uses it, so the `├└│`-only
version under-counts by one the day the first route is ever dynamic — it is right today only
because `/` sorts first and is static.

`next build` reports **43 static** and **0 dynamic**, and no `ƒ Proxy (Middleware)` line appears
at all. Do not read the `Generating static pages (44/44)` line as the static route count — it is a
different quantity, and 35 against 34 is exactly the kind of near-miss that gets copied.

**A route in that table is not the same thing as a page**, and `/icon.png` is the standing
example: it is `src/app/icon.png`, the tab icon (PD-305), reached by Next's file convention rather
than by a `page.tsx`, and it emits an asset rather than a document. So the static-route count
moves with the icon conventions too, and `git ls-files src/app | grep -c 'page\.tsx$'` answers a
different question from this line.
