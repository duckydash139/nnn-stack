# Add a web feature

The web app is Foldkit with SSR, built by one `vite build` and served by Alchemy's `Website.Foldkit` as one Worker. If a Foldkit skill is installed, load it for the framework's own conventions. Otherwise, read the installed package's docs and examples for the pinned version.

When a **tldraw-ui-mock** board was approved for the feature, build its screens and states, including the empty, error, and rejected ones. Use the board's labels as the accessible names, so journeys and the `verify-<app>` skill find the same handles.

## Where things go

A feature is one folder in `packages/features/<name>/`, split by where its code runs. The package is imported by path (`@app/features/<name>/web/<file>.ts`, or `#/<name>/shared/<file>.ts` inside the package), with no barrel files.

| Folder | Holds | Never (lint error) |
| --- | --- | --- |
| `<name>/shared/` | Contracts: `Schema` values, one tagged error per file, each `defineContract`, and the `toRpcGroup` group | Imports from `server/`, `web/`, Foldkit, or XState |
| `<name>/server/` | Services, machines, pure domain rules, and `<name>.rpc.ts` with `implement` and `toRpc` | Imports from `web/` or Foldkit |
| `<name>/web/` | A Foldkit Submodel: Model, Message, `update`, Commands, `view` | Imports from `server/` |
| `apps/web/src/client/` | Routes, the app's Model and layout, the RPC client protocol | Imports from `server/` |
| `apps/web/src/server/` | `mergeRpc` over every feature's projection | Imports from `client/` |

### File roles

Every file in a feature's side folder names its role, `<name>.<role>.ts`, from a closed set:

| Side | Roles |
| --- | --- |
| `shared/` | `contract` (schemas, `defineContract`, `toRpcGroup`), `error` (one tagged error), `schema` (schemas several contracts share) |
| `server/` | `service` (a `Context.Service` and its Layer), `machine` (a lifecycle), `rules` (pure domain functions), `rpc` (`implement` and `toRpc`) |
| `web/` | `command`, `subscription`, `machine`, and a plain `<name>.ts` for the Submodel |

Tests add `.test`, `.dom.test`, or `.model.test` after the role (`quote.machine.test.ts`). The folder already says where a file runs, so the suffix says what it is, never `.server.ts`. A role is in the set only if a rule or a reader keys off it: the actor ban reads `command` and `subscription`, and `machine` marks what needs a model test (`stack/machine-model-test`; see [lifecycle.md](lifecycle.md#5-model-test)). A small Oxlint rule (`stack/file-role`) checks `context.filename` against the set, so a wrong or missing role is a lint error, and lint globs like `**/*.subscription.ts` can't be matched by accident.

To add a feature: create the folder, add its projection to `mergeRpc`, add its route, and mount its Submodel. To remove one, reverse those three edits and delete the folder. The gate still passes.

## One send, one path

`view` → Message → `update` → named Command → `RpcClient` over the contract's group → capability handler on the server → service or store.

- The Command returns a result Message, and `update` folds it into the Model.
- The server is authoritative. The browser never decides access, price, or ownership.
- Data the first paint needs goes in the Flags from the server's render (`entry.server.ts`), so the server-rendered page already shows it.

## XState in the browser

Two shapes, both allowed in `web/` and `client/`:

- **Pure stepping.** Keep the machine's context in the Model and advance it in `update` with xstate's `initialTransition` and `transition`. No actor, no scope, nothing to clean up. Use it for multi-step forms and wizards.

  ```ts
  export const step = (state: State, event: Parameters<typeof wizard.transition>[1]): State => {
    const [snapshot] = initialTransition(wizard, state);
    return transition(wizard, snapshot, event)[0].context;
  };
  ```

  Make the context the Model's own tagged union (`ChoosingPlan | Configuring | Reviewing`), so the view still matches on it. A `restore` state with `always: ({ context }) => ({ target: stateOf(context) })` puts the snapshot back in the right state. Each transition returns `{ context: next, target: stateOf(next) }`. The states then say which events each step accepts. `update` maps each Message to one event, and returns a Command when the step enters a waiting state (`pricing`). That state accepts only the reply, so at most one request is in flight and no reply lands on a different draft. Disable the inputs that would send ignored events.

- **Actors.** A running actor needs a scope that ends with the page. Only Foldkit Subscriptions and Commands own one, so `createEffectActor` from `@xstate/effect` is allowed only in `<name>.subscription.ts` and `<name>.command.ts` files. Lint it: ban the import in `web/**` and `client/**`, then add a later override for those file globs without the ban.

`createActor` from `xstate` is banned everywhere (see [lifecycle.md](lifecycle.md)). `shared/` imports no XState.

## SSR gotchas

- **Unstyled first paint in dev.** Foldkit's dev server passes `stylesheets: []` to the document renderer, so the server-rendered page has no CSS until `entry.ts` runs. Link the source stylesheet in dev only:

  ```ts
  const linkUnbundledStylesheetInDev = (assets: Server.DocumentAssets) =>
    import.meta.env.DEV ? { ...assets, stylesheets: ["/src/client/styles.css"] } : assets;

  export const renderDocument: Server.DocumentRenderer = (application, assets) =>
    Server.renderDocument(application, linkUnbundledStylesheetInDev(assets));
  ```

  In dev the CSS then loads twice, so a deleted rule lingers until a reload.
- **"This page could not start safely".** A tab opened before a dev server restart refuses to hydrate against the new build. Reload the tab. It isn't a bug.
- **No custom Worker.** `Website.Foldkit` with `ssr.build` generates the Worker handler, so there's no `main`. New endpoints go through `renderPage` and `Server.Responded`. `/api/rpc` is one of them.
- **The RPC client posts to `/api/rpc/`.** Effect's `prependUrl` adds the trailing slash. Make the server accept both forms, and pin it with a test.

## Dev

`pnpm dev` runs `alchemy dev`: the same Worker on local workerd with Vite HMR, and no Cloudflare login. Set `dev: { port }` on `Website.Foldkit` to move it off the default 1337.

Dev-only code (devtools, test people, fake auth) lives under `src/dev/`. A test checks the production bundle contains none of it.

## Prove it

- An interaction test (`*.dom.test.ts` under happy-dom) that asserts what the person sees after each Message, and which Command `update` returned.
- `update` is a pure function. Test its rules with `it.prop` over generated Messages. A browser machine's model test does this against an independent model (see [lifecycle.md](lifecycle.md#5-model-test)). Compare Commands by `name` and `args`, because each one holds its Effect.
- An RPC test through the real handler (`makeRpcHandler()` with a `Request`) for each feature's wire shape.
- Use Foldkit devtools to read the Model and the Message log when a screen is wrong.
- Drive the real app through the project's `verify-<app>` skill for the critical paths, including a page load with scripts blocked to check the server-rendered paint.

## Report

The feature folders touched, the Messages and Commands added, the contracts called, and what the person sees in each state, including errors and loading.
