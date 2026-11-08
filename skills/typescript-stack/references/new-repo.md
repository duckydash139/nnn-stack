# Start a repo on the stack

Set up the workspace, the gate, the fence, and `AGENTS.md`. Then prove the gate fails on a planted error and passes without it. The repo isn't ready for features until both happen.

Budget: one session. Don't add product code here beyond one example package that the gate can check.

## 1. Pin the versions

Known-good set, checked together in November 2026:

| Package | Version |
| --- | --- |
| node | `>=24.18.0` |
| pnpm | `12.18.0` |
| `effect`, `@effect/platform-node`, `@effect/platform-browser`, `@effect/vitest` | `4.1.2` |
| `xstate` | `6.0.0-beta.1` |
| `@xstate/effect` | `1.0.0-beta.0` (npm's `latest` tag still points at an older alpha, so pin this exactly) |
| `foldkit`, `@foldkit/ui`, `@foldkit/devtools` | `0.170.0` |
| `@foldkit/vite-plugin` | `0.29.0` |
| `vite` | `8.3.6` |
| `alchemy`, `@alchemy.run/cloudflare` | `2.0.0-beta.85` |
| `typescript` | `7.0.2` |
| `@yielded/effect-tsrs` | `0.2.3` |
| `tsrs` | `0.23.0-ts7.1.0-beta` |
| `oxlint`, `@oxlint/plugins` | `1.92.0` |
| `oxlint-tsgolint` | `7.0.2006` |
| `oxfmt` | `0.77.0` |
| `ultracite` | `8.1.1` |
| `vitest` | `5.1.0` |
| `lefthook` | `2.2.2` |
| `varlock` | `1.24.0` |
| `@types/node` | `24.19.2` (match the Node major) |

Every version lives once, in the `catalog` of `pnpm-workspace.yaml`. Each `package.json` says `"catalog:"`. Bump a version in the catalog, never in a `package.json`.

Check each pre-release on npm before you copy it (the **dependency-usage-grounding** skill). If a newer one exists, read its changelog, take it only if the set still typechecks together, and update this table. Effect, Foldkit, and `@xstate/effect` must agree on one Effect version.

## 2. Lay out the workspace

```text
apps/            composition roots: cli, web, infra, workers
packages/        one job each: domain, adapters, shared primitives
AGENTS.md        repo law for agents
VISION.md        intent, optional
.env.schema      every env var
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
verifyDepsBeforeRun: error
catalogMode: strict
savePrefix: ""
catalog:
  effect: "4.1.2"
  # one line per package in the table above
allowBuilds:
  lefthook: true
  workerd: true
```

`catalogMode: strict` makes a conflicting pin an install error, and `savePrefix: ""` keeps new pins exact.

Root `package.json` (dependency versions are `"catalog:"`):

```json
{
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.18.0",
  "engines": { "node": ">=24.18.0" },
  "scripts": {
    "prepare": "if git rev-parse --git-dir >/dev/null 2>&1; then lefthook install; fi",
    "build": "pnpm -r --if-present build",
    "typecheck": "pnpm -r --if-present typecheck && effect-tsrs diagnostics --project tsconfig.json --strict --type-check",
    "typecheck:fast": "pnpm -r --if-present typecheck:fast && tsrs --noEmit -p tsconfig.json",
    "postinstall": "effect-tsrs patch --oxlint",
    "lint": "effect-tsrs oxlint --deny-warnings . && oxfmt --check .",
    "lockfile:check": "pnpm install --frozen-lockfile --offline --lockfile-only --ignore-scripts",
    "check": "pnpm lockfile:check && varlock load && pnpm typecheck && pnpm lint",
    "test": "pnpm -r --if-present test",
    "fix": "effect-tsrs oxlint --fix . && oxfmt .",
    "gate": "pnpm build && pnpm check && pnpm test"
  }
}
```

`effect-tsrs oxlint` runs Oxlint with the Effect rules loaded. `postinstall` patches the installed `oxlint` so editors that run plain `oxlint --lsp` load them too.

Each package's `package.json` has `typecheck` (`effect-tsrs diagnostics --project tsconfig.json --strict --type-check`), `typecheck:fast` (`tsrs --noEmit -p tsconfig.json`), `test` (`vitest run`), and `build` if it ships output. Internal dependencies use `"workspace:*"`.

**Imports.** Each package maps `#/*` in its `package.json` `imports` (`"#/*": "./src/*"` in apps, `"./*"` in a package without `src/`), and imports across its own folders through it, with `.ts` extensions. Same-folder `./` imports are fine. `../` imports are a lint error (step 4). Packages that Vite bundles override the base with `"module": "Preserve"`, `"moduleResolution": "Bundler"`, and `"allowImportingTsExtensions": true`. Node runs `tools/` scripts as `.ts` directly.

## 3. Types that fail on Effect mistakes

`tsconfig.base.json`, which every package extends:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "moduleDetection": "force",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"],
    "plugins": [
      {
        "name": "@effect/language-service",
        "ignoreEffectWarningsInTscExitCode": false,
        "namespaceImportPackages": ["effect", "@effect/platform-node"],
        "diagnosticSeverity": {
          "floatingEffect": "error",
          "floatingEffectInVitest": "error",
          "missingEffectContext": "error",
          "missingEffectError": "error",
          "missingLayerContext": "error",
          "leakingRequirements": "error",
          "anyUnknownInErrorContext": "error",
          "unsafeEffectTypeAssertion": "error",
          "globalErrorInEffectCatch": "error",
          "globalErrorInEffectFailure": "error",
          "unknownInEffectCatch": "error",
          "tryCatchInEffectGen": "error",
          "returnEffectInGen": "error",
          "runEffectInsideEffect": "error",
          "schemaSyncInEffect": "error",
          "instanceOfSchema": "error",
          "newPromise": "error",
          "asyncFunction": "error",
          "globalConsole": "error",
          "globalDate": "error",
          "globalFetch": "error",
          "globalRandom": "error",
          "globalTimers": "error",
          "cryptoRandomUUID": "error",
          "nodeBuiltinImport": "error"
        }
      }
    ]
  }
}
```

Two checkers read this file:

- **effect-tsrs** (`pnpm typecheck`, part of the gate). `--type-check` runs the ordinary TypeScript diagnostics, the Effect diagnostics come from the plugin's `diagnosticSeverity` map, and `--strict` makes Effect warnings fail. It's the only checker the gate trusts.
- **tsrs** (`pnpm typecheck:fast`). Plain TypeScript diagnostics in seconds, with no Effect diagnostics. Use it in the edit loop, never as proof.

Keep `ignoreEffectWarningsInTscExitCode` false. Keep `typescript` installed at its pin for the editor and the language service. Both checkers ship platform binaries, so if pnpm's release-age check holds a fresh pin back, add an exact `minimumReleaseAgeExclude` entry for each binary package in `pnpm-workspace.yaml`, and remove it once the version ages past the check. When either checker is bumped, run both on the workspace and report any error one finds and the other doesn't. A package that needs a narrower rule overrides one line with `// @effect-diagnostics-next-line <rule>:off -- <reason>`, never the map.

## 4. Lint

`oxlint.config.ts` extends Ultracite's core preset and effect-tsrs's recommended preset, with type-aware rules on. Every rule message reads `<what>. <why>. Fix: <step>`. Check `oxlint --rules` for the exact names in the pinned version.

**Plugins.** Vendor the third-party JS plugins under `tools/oxlint/<name>/`, each with an `UPSTREAM.md` naming the source, the revision, and what was copied. Both the linter and the formatter ignore those folders. Put your own rules in `tools/oxlint/stack/`.

| Plugin | Rules |
| --- | --- |
| [anti-slop](https://github.com/dmmulroy/anti-slop), vendored | The generic and Effect sets, all on |
| `no-comments` from [rat-stack](https://github.com/joelhooks/rat-stack), vendored | `no-comments/no-comments` and `no-comments/directive-reason`. Directives keep their reason after `--`, a type assertion takes one `SAFETY:` line, and nothing else survives |
| `@xstate/effect/oxlint` | `no-inline-effect` |
| `@foldkit/oxlint-plugin` | Its recommended set, scoped to the browser roots |
| `tools/oxlint/stack/` | `no-sleep-in-loop` and `machine-model-test` (see [lifecycle.md](lifecycle.md#5-model-test)), and `file-role` (see [web.md](web.md#file-roles)) |

**Boundaries.** Encode the dependency direction as `no-restricted-imports`. Each override **replaces** the rule instead of merging it, so build every override's value from one helper that always carries the shared bans:

```ts
const importRules = (paths: readonly ImportPath[], ...patterns: ImportPattern[]) =>
  ["error", { paths: [...paths], patterns: [parentImports, ...patterns] }] as const;

const restrictImports = (...patterns: ImportPattern[]) => importRules(SHARED_PATHS, ...patterns);
```

`parentImports` bans `^\.\./`. `SHARED_PATHS` holds the bans that apply everywhere: `createActor` from `xstate` ([lifecycle.md](lifecycle.md)) and hand-rolled `Rpc`/`RpcGroup` ([capability.md](capability.md#0-the-capability-package-once-per-repo)). Then one override per boundary: packages never import apps, `shared/` imports no server, web, Foldkit, or XState code, `server/` imports no web or Foldkit code, and browser code imports no `**/server/**`. [web.md](web.md#where-things-go) lists the feature boundaries.

**Turning a rule off.** The config can't carry comments either, so a rule turned off states its reason as data:

```ts
const disabled = (reasons: Record<string, string>) =>
  Object.fromEntries(Object.keys(reasons).map((rule) => [rule, "off" as const]));

rules: {
  ...disabled({
    "no-redeclare": "A Schema value and its type share one name (`Model`, `Message`), and TypeScript allows the pair.",
  }),
},
```

## 5. Hooks

`lefthook.yml`:

```yaml
pre-commit:
  parallel: false
  commands:
    check:
      run: pnpm check
    test:
      run: pnpm test
```

### Agent hook

lefthook can be skipped with `--no-verify`. Block that in the agent harness. Add `scripts/hooks/block-no-verify.mjs`:

```js
#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const command = JSON.parse(input).tool_input?.command ?? "";
  const bypass =
    /\bgit\b[^|;&]*\s--no-verify\b/.test(command) ||
    /\bgit\s+commit\b[^|;&]*\s-[a-zA-Z]*n/.test(command) ||
    /\bLEFTHOOK=0\b|core\.hooksPath/.test(command);
  if (bypass) {
    console.error("Hook bypass blocked. The gate is the fence. Fix: run the hook, read the failure, and fix it.");
    process.exit(2);
  }
});
```

And register it in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/scripts/hooks/block-no-verify.mjs\"" }] }
    ]
  }
}
```

`-n` means `--no-verify` only for `git commit`, so the pattern checks it there and nowhere else. It errs strict: a commit message containing ` -n` is blocked too, so reword the message. Add a test that feeds the script each bypass and a normal commit.

## 6. Env

Declare every env var in `.env.schema` with its type and whether it's secret. Read config through Effect `Config` inside a service, never `process.env` in domain code. Run `pnpm exec varlock load` after each schema edit. Never commit `.env.local`.

## 7. One example package

Add `packages/core` with one service and one test, shaped as in [effect.md](effect.md). It gives the gate real work.

Then set up journeys and laws with [journeys.md](journeys.md#set-it-up), so the first brief has somewhere to land and the gate checks the pages from the start.

## 8. AGENTS.md

```md
# Agent instructions

For non-trivial work, use nnn-mode. This repo follows the typescript-stack skill. Rules here win where they differ.

## Commands
- `pnpm install`: install
- `pnpm gate`: required before any change is ready (build, check, test)
- `pnpm check`: lockfile, typecheck with Effect diagnostics (effect-tsrs), lint, format
- `pnpm typecheck:fast`: plain types in seconds (tsrs), no Effect diagnostics, not proof
- `pnpm test`: Vitest across the workspace
- `pnpm fix`: rewrite formatting and safe lint fixes
- `pnpm spec:generate`: rewrite the journey pages in `journeys/docs/`, in the same commit as any journey, flow, law, or `check()` change
- `pnpm mutants`: mutant-cafe on the lines changed since `main`, a deep run that never goes in the gate
- Fast loop: `pnpm --filter <pkg> exec vitest run <path>`

## Packages
- `packages/core`: <its one job>

## Product rules
<the rules this product adds>

## Drift from the stack
<what this repo does differently, and why>

## Sign-off
<who approves deploys, dependency changes, and fence changes>
```

## 9. Prove the fence

1. Plant three errors in `packages/core`: a floating Effect (an `Effect.log` that isn't yielded), a `Date.now()` inside `Effect.gen`, and an `as any`.
2. Run `pnpm check`. Each must fail with its own message. If one passes, fix the config before going on.
3. Plant one violation per lint boundary and ban: a `../` import, each forbidden cross-folder import, `createActor`, a hand-rolled `Rpc`, a comment, a feature file with no role. Plant the allowed cases beside them (`createEffectActor` in a subscription file, `Rpc` inside `packages/capability`). Lint must flag every violation and none of the allowed cases. An override that silently dropped the shared bans shows up here and nowhere else.
4. Remove them. Run `pnpm gate`, which must pass. Report its time.
5. Try `git commit --no-verify` through the agent. The hook must block it.

## Report

- Pinned versions, and any that differ from the table, with the reason.
- The gate command, its time, the three planted type errors, and the planted lint violations it caught.
- The hook test result.
