---
name: typescript-stack
description: The default TypeScript stack and its rules - pnpm workspaces, Effect, XState with @xstate/effect, Foldkit, Alchemy, strict types with Effect diagnostics, Oxlint, Vitest, and lefthook - plus playbooks to start a repo, add an action, a lifecycle, a store, a web feature, or cloud resources. Load only for /typescript-stack or when nnn-mode routes here. Never load it when the user names another stack or template, or when the repo's AGENTS.md names its own stack skills or router.
---

# TypeScript stack

This skill is the stack and the rules for TypeScript work under nnn-mode. Everything it needs is in this folder. A project's own `AGENTS.md` wins where the two disagree. Record the drift there instead of quietly migrating the project.

## Pick the path

| The repo | Do |
| --- | --- |
| The user named another stack or template, or `AGENTS.md` names its own stack skills or router | Stop. Unload this skill and follow that stack. Don't mix the two |
| Empty, or has no `AGENTS.md` and no gate | Run [references/new-repo.md](references/new-repo.md) first. Nothing else is proven until the gate exists |
| Already on this stack | Read its `AGENTS.md`, then the playbook that matches the task (below) |
| TypeScript on a different stack | Use the rules below that don't need a dependency swap. Propose a stack change only as its own task, with the owner's sign-off |

## The stack

The stack is a floor, not a menu. Each piece owns one job.

| Job | Piece | Notes |
| --- | --- | --- |
| Packages | pnpm workspaces (`apps/*`, `packages/*`) with a strict `catalog` | pnpm only. Every version lives once, in the catalog. No Turborepo, Bun, or npm installs. `pnpm -r` runs scripts in dependency order |
| Runtime | Node 24 or later | |
| Work, errors, dependencies | Effect 4 (`effect`, `@effect/platform-node`) | One Effect version across the workspace |
| Values at a boundary | Effect `Schema` | JSON Schema and OpenAPI are derived from it, never written by hand |
| Lifecycles | XState 6 with `@xstate/effect` | Machines run as scoped Effects. Side effects are declared actors |
| Web UI | Foldkit, with `@foldkit/ui`, `@foldkit/devtools`, and `@foldkit/vite-plugin` | Server-rendered and prerendered by default |
| Cloud | Alchemy, with its Cloudflare providers | Every cloud resource is declared in one Stack program |
| Types | TypeScript strict, checked by effect-tsrs and tsrs | `effect-tsrs --strict --type-check` is the gate's typecheck, so Effect diagnostics fail it. `tsrs` gives plain types in seconds for the edit loop, with no Effect diagnostics |
| Lint and format | Oxlint (type-aware, Ultracite and effect-tsrs presets) through `effect-tsrs oxlint`, and Oxfmt | Vendored anti-slop and no-comments plugins, plus the repo's own rules in `tools/oxlint/stack/` |
| Tests | Vitest with `@effect/vitest` | `it.effect`, `it.layer`, `it.prop` |
| Env | varlock | Every env var is declared in `.env.schema` |
| Hooks | lefthook | Pre-commit runs `pnpm check` and `pnpm test` |

Pins are exact (`"effect": "4.1.2"`, never `^4.1.2`). [references/new-repo.md](references/new-repo.md) lists the known-good set. Several pieces are pre-release (XState 6, `@xstate/effect`, Alchemy 2), so check the current version and changelog with the **dependency-usage-grounding** skill before pinning one, and before any bump.

## Rules

These hold in every repo on this stack. A project adds its own product rules to `AGENTS.md`.

**Shape**

- **One contract, every surface.** An action is one contract (name, description, input, output, failure) and one handler. CLI commands, HTTP routes, RPC, and agent tools are projections of it. No surface gets its own business logic. Lint bans building `Rpc` or `RpcGroup` outside the capability package. See [references/capability.md](references/capability.md).
- **Ports name jobs. Layers supply vendors.** Core code depends on a `Context.Service` named for the job (`Mailer`, `Orders`), never on a vendor SDK. Adapter packages implement the port, and the composition root provides the Layer. Swapping a vendor is one line.
- **Lifecycles are machines.** Finite modes, retries, cancellation, and resumable work live in an XState machine started with `createEffectActor`. Side effects are `createEffectLogic` actors, never inline callbacks. `createActor` and sleeping loops are lint errors. In the browser, step a machine purely from `update`, or run an actor in a Subscription or Command file. See [references/lifecycle.md](references/lifecycle.md) and [references/web.md](references/web.md#xstate-in-the-browser).
- **The server is authoritative.** The browser holds a Model and sends Messages. It never imports handlers or reaches a store directly. A feature is one folder split into `shared/`, `server/`, and `web/`, with lint boundaries between them. See [references/web.md](references/web.md).
- **Packages are cartridges.** One package, one job, named for it. Adding it takes the package plus one `Layer.provide` or Stack line. Removing it takes deleting those two, and the gate still passes.
- **Dependencies point one way:** apps → domain packages → shared primitives → Effect and XState. Packages never import apps. Encode the direction as a lint rule (see [references/new-repo.md](references/new-repo.md#4-lint)).

**Errors and types**

- **Errors are part of the interface.** Expected failures are `Schema.TaggedError` classes in the Effect error channel. Name the failure, keep its source context, and say how to fix it. Defects (bugs) die. They are not typed failures.
- **Parse at the boundary.** Decode every value that enters from the network, a file, env, or storage with `Schema`. Inside, trust the types.
- **Don't lie to the compiler.** No `any`, no `as` without a one-line `SAFETY:` comment naming the invariant. Disable a diagnostic or lint rule only for the next line, with the reason after `--`.
- **Effect owns the globals.** No `Date.now`, `Math.random`, `fetch`, `setTimeout`, `console`, or `crypto.randomUUID` inside Effect code. Use `Clock`, `Random`, `HttpClient`, `Effect.sleep`, and `Effect.log`, so tests control them. The language service enforces this (see `tsconfig.base.json` in [references/new-repo.md](references/new-repo.md)).
- **No module-level mutable state** in `src`. It leaks across requests on Workers.

**Tests** (the **prove-behavior** skill decides what to prove; these say how on this stack)

- Run every Effect test through `@effect/vitest` (`it.effect`, `it.layer`). `Effect.run*` and `ManagedRuntime.make` in a test file are a smell.
- A domain rule is an `it.prop` over `Schema`-derived arbitraries. Anything with history is a model test over generated command sequences. Keep example tests for seams.
- Control time with `TestClock`. Never sleep on the wall clock.
- No tautological tests, no change-detector tests, and no regression test for a bug fix unless it fills a real gap in behavior coverage.

**Data**

- Before code, name the facts, the system of record, the copies derived from it, and the single writer. See [references/store.md](references/store.md).
- Bound every read: a key, an order, a row cap, and a pagination rule.

**Code**

- No comments, enforced by the vendored `no-comments` lint plugin in every file the linter reads. Say it in a name, a type, a test, or the commit. Tool directives keep their reason after `--`, and a type assertion takes one `SAFETY:` line. A rule turned off in `oxlint.config.ts` states its reason in a `disabled({...})` record.
- Before writing Effect or XState code, read the installed package's own guidance: `node_modules/effect/AGENTS.md` first, then the package's docs and tests for the pinned version (the **dependency-usage-grounding** skill). Training data lags these APIs.

## The gate

Every repo on this stack has one command that decides "ready":

```sh
pnpm gate     # pnpm build && pnpm check && pnpm test
```

`check` covers the lockfile, the effect-tsrs typecheck, lint, format, and the journey spec (`pnpm spec`: stale pages, malformed journeys, unproven laws). In the edit loop, `pnpm typecheck:fast` (tsrs) answers in seconds but skips Effect diagnostics, so it never counts as passing. `AGENTS.md` names the gate, and lefthook runs `check` and `test` before each commit.

**The fence.** These checks are what make a shortcut fail loudly:

- Never pass `--no-verify`, and never skip or disable a hook. If a hook fails, fix the failure.
- Never loosen `tsconfig.base.json` diagnostics, `oxlint.config.ts`, or `lefthook.yml` to get green. A loosening needs the owner's sign-off.
- Lint baselines only shrink. Before cleaning up a bad pattern, add the lint rule that bans it.

[references/new-repo.md](references/new-repo.md#agent-hook) sets up a Claude Code hook that blocks `--no-verify`, so the fence doesn't depend on this prose.

## Playbooks

Match every playbook that applies, as nnn-mode does. An action that adds persistence matches both the capability and store playbooks. Copy each one's steps into the todo list.

| Task | Playbook |
| --- | --- |
| New repo, or a repo with no gate | [references/new-repo.md](references/new-repo.md) |
| New action for people, agents, or the browser | [references/capability.md](references/capability.md) |
| States, retries, cancellation, or deadlines | [references/lifecycle.md](references/lifecycle.md) |
| New persistence | [references/store.md](references/store.md) |
| A screen or flow in the web app | [references/web.md](references/web.md) |
| Cloud resources or deploys | [references/infra.md](references/infra.md) |
| Service, Layer, config, or error shapes | [references/effect.md](references/effect.md) |
| A journey, flow, law, or brief line to file, or setting up journey pages | [references/journeys.md](references/journeys.md) |

## Sign-off

Safe by default: a new action, service, or machine; new or tighter tests; a lint rule that tightens; a targeted override with its reason; doc edits; `infra:plan`.

Needs the owner: adding or bumping a dependency; any change to `journeys/` (other than its generated `docs/`), `packages/spec/laws.ts`, or `breaks/`; anything that loosens the fence; a deploy whose plan replaces or deletes a resource; destroying a stack; exposing a local-only server beyond localhost.

## Report

Add to nnn-mode's reply:

- Which playbooks ran, and any step skipped with its reason.
- The contracts, services, machines, or stores added, and where each lives.
- The gate result, and any fence rule added.
- Drift from this stack that the repo already had, recorded in `AGENTS.md`.
