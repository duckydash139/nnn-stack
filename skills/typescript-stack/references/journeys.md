# Journeys and laws on this stack

The **prove-behavior** skill owns the format: what a journey, flow, law, and line ID are, and who approves what ([its journeys reference](../../prove-behavior/references/journeys.md), [its laws reference](../../prove-behavior/references/laws.md)). This playbook says where they live in a repo on this stack, how the helpers run on `@effect/vitest`, how the gate checks them, and how mutant-cafe checks that the tests can fail. Every file named here is in [assets/](../assets/journeys/spec.json), and each one passes the stack's typecheck and lint as it is.

## Layout

| Path | Holds | Changes need |
| --- | --- | --- |
| `packages/spec/` | `@<scope>/spec`: `law`, `flow`, `journey`, `prove`, `step`, `check`, `property`. A leaf package, so every test can import it | Owner sign-off for `laws.ts`. The helpers are safe to fix |
| `packages/spec/laws.ts` | Every law, imported as `@<scope>/spec/laws` | Owner sign-off |
| `journeys/` | `@<scope>/journeys`, a workspace package: one `tests/<name>.journey.test.ts` per journey, `flows/<flow>.flow.ts`, `support/`, `spec.json`, and the generated pages in `docs/` (`README.md` and `<flow>.md`) | Owner sign-off, except `docs/` |
| `breaks/` | Optional. One patch per planted bug that mutant-cafe can't make, named in a law's or journey's `breakWith`. Most repos have none | Owner sign-off |
| `tools/journey-spec/journey-spec.mjs` | The generator and spec check, copied from **prove-behavior**'s `scripts/` | Copy it again to update. Never edit it here |

The laws live in a package, not at the root, because a test under `packages/` can't reach a root file without a `../` import, which lint bans. `journeys/spec.json` points the generator at it with `"laws": "packages/spec/laws.ts"`.

Journeys drive the product from outside, through the interface a real client uses. The API level calls the app's RPC handler through a typed `RpcClient` with the app's own serialization, as [assets/journeys/support/app.ts](../assets/journeys/support/app.ts) shows. The web app exposes its handler factory for this with one `exports` entry, `"./server/rpc": "./src/server/rpc.ts"`. Write one opener per contract group in `support/`. A journey never imports a handler, service, or machine directly. A page-level journey uses the `dom` level, as [Journeys on the page](#journeys-on-the-page) shows. A `browser` journey needs Playwright, which is a dependency the owner approves first, and the `verify-<app>` skill usually covers the same ground without it.

## Set it up

Run this once per repo, from the new-repo playbook or on its own. Replace `@<scope>` with the repo's package scope.

1. Copy `assets/packages/spec/` to `packages/spec/`, and `assets/journeys/` to `journeys/`. Add `"journeys"` to `packages` in `pnpm-workspace.yaml`.
2. Copy [journey-spec.mjs](../../prove-behavior/scripts/journey-spec.mjs) to `tools/journey-spec/`.
3. Add `oxc-parser` to the catalog, pinned exact and at least two weeks old, and to the root `devDependencies`. The generator loads it from the root. Add `mutant-cafe` to the catalog too, pinned exact, and to the `devDependencies` of each package it checks. If its pinned release is under two weeks old, add `mutant-cafe@<version>` to `minimumReleaseAgeExclude`, and drop that line once the release is old enough. Both are dependency changes, so they need the owner.
4. Add `@<scope>/spec` to the `devDependencies` of each package whose tests prove a law. The journeys package already lists `foldkit` and `happy-dom` from the catalog for `dom` journeys.
5. In `oxlint.config.ts`, add `"tools/journey-spec/**"` to `ignorePatterns`, because the generator keeps its comments. In `oxfmt.config.ts`, add `"tools/journey-spec/**"` and `"journeys/docs/**"`, and `"breaks/**"` if the repo keeps patches. The formatter reformats Markdown, and a reformatted page no longer matches what the generator writes, so the spec check would fail on every run. Add `mutants.out*` to `.gitignore`. mutant-cafe writes `mutants.out/` and keeps the previous run as `mutants.out.old/`, and the formatter checks the JSON in both unless git ignores them.
6. Add the root scripts `"spec": "node tools/journey-spec/journey-spec.mjs check"` and `"spec:generate": "node tools/journey-spec/journey-spec.mjs generate"`, and append `&& pnpm spec` to `check`. `pnpm -r test` already runs the journeys package. In each package mutant-cafe checks, add `"mutants": "mutant-cafe --in-diff-range main...HEAD --jobs 4"`, using the default branch's ref (`origin/main` in CI), and a root `mutants` script that runs it with `pnpm --filter`. Never add it to `gate` or `check`.
7. Run `pnpm install`, `pnpm spec:generate`, and `pnpm gate`.
8. Prove it can fail: change a journey's `intent` without regenerating. `pnpm spec` must report the page as stale. Then restore it.

## Write a journey

```ts
journey(
  {
    title: "Get a quote for a team",
    criticality: "important",
    level: "api",
    flow: "quote",
    paths: ["packages/features/quote/", "apps/web/src/server/"],
    persona: "A buyer pricing seats for their team",
    context: "The Team plan takes 3 to 200 seats, no coupon",
    intent: "See what the team will pay",
  },
  () => {
    prove(
      { proves: [NoSeatsOutsidePlan] },
      "QUO-2: IF a buyer asks for more seats than the plan takes, THEN THE SYSTEM SHALL refuse the quote and name the plan's seat range",
      () =>
        Effect.gen(function* quoteOutOfRange() {
          const desk = yield* openQuoteDesk;
          const refusal = yield* step(
            "Ask for 500 seats on the Team plan",
            Effect.flip(desk.PriceQuote({ couponCode: "", planId: "team", seats: 500 }))
          );
          expect(refusal).toEqual(
            new SeatsOutOfRange({ maxSeats: 200, minSeats: 3, planId: "team", seats: 500 })
          );
        })
    );
  }
);
```

- `prove()` runs its body as `it.effect`, so it gets a `Scope`, `TestClock`, and Layers like any Effect test. Use `{ proves: [] }` for a test that proves no law. A plain `it.effect` inside `journey()` works too, and the page lists it.
- `step(name, effect)` names an action for the page and wraps it in a span. It returns the same Effect, so `yield*` it.
- Get the next line ID with `node tools/journey-spec/journey-spec.mjs next-ids`.
- Build a client inside the test with `Layer.build`, as the support file does. `Effect.provide(layer)` on the client closes the layer's scope as soon as the client exists, and every call then hangs until the test times out with `InterruptError`.

## Journeys on the page

A `dom` journey proves a Foldkit page without a browser. `foldkit/scene` renders the page's real `update` and `view` in happy-dom and clicks and types by accessible role, but it never runs a Command: the test hands it each result. So the journey runs the page's own Command first, with `runOnTheApp` from [support/app.ts](../assets/journeys/support/app.ts), through the real `RpcClient` to the real handler, and passes that reply to the scene:

```ts
const request = PriceQuote({ couponCode: "NOPE", planId: "team", seats: 3 });

const reply = yield* step(
  "Send the page's request with coupon NOPE to the app",
  runOnTheApp(request)
);

yield* step(
  "Enter coupon NOPE on the quote page and ask for a quote",
  Effect.sync(() => {
    scene(
      page,
      given(init(plans)),
      click(role("button", { name: "Choose Team" })),
      type(role("textbox", { name: "Coupon code" }), "NOPE"),
      click(role("button", { name: "Get quote" })),
      Command.expectHas(request),
      Command.resolve(request, reply),
      expect(role("alert")).toHaveText(
        new CouponRejected({ code: "NOPE", planId: "team", reason: "Unknown" }).message
      )
    );
  })
);
```

- `Command.expectHas(request)` proves the page sent exactly that request, and `Command.resolve(request, reply)` gives it the server's real answer. Between them the journey covers the form, the request, the Command's client code and error mapping, the handler, and what the page shows.
- Expect what the domain says, such as the error's own `message`, not a copied string. A `<name>.dom.test.ts` in `apps/web` that stubs a reply can drift from the server: on the quote page the stub said "Coupon NOPE is not a coupon we issued.", while the server adds a fix hint. A planted bug that drops the server's reason passed that test and failed the journey.
- Name each file `<name>.dom.journey.test.ts`. The journeys Vitest config runs those in happy-dom with Foldkit's `setup()` from `support/foldkit-setup.ts`, and the rest on Node.
- The web app exports each page a journey drives, such as `"./client/features/quote": "./src/client/features/quote.ts"`.
- A `dom` journey can't see startup wiring, SSR hydration, the relative RPC URL, the Vite build, layout, or real focus. The `verify-<app>` skill checks those on the running app before a UI change ships. Add a committed Playwright smoke test only after a break there slips through.

## Prove a law

A `never` or `always` law needs a property or model check and one journey test. Write the check beside the code it covers, under the file-role names (`<name>.<role>.test.ts`, or a machine's `<name>.machine.model.test.ts`):

```ts
check(
  { type: "property", proves: [NoSeatsOutsidePlan], flow: "quote" },
  "THE SYSTEM SHALL refuse every seat count outside the plan's range",
  property([PlanId, Schema.Int], ([planId, seats]) =>
    Effect.gen(function* seatRangeHolds() {
      const plan = PLANS[planId];
      const catalog = yield* Catalog;
      const result = yield* Effect.result(catalog.planForSeats(planId, seats));
      expect(Result.isSuccess(result)).toBe(seats >= plan.minSeats && seats <= plan.maxSeats);
    }).pipe(Effect.provide(Catalog.layer))
  )
);
```

- `check(spec, title, body)` runs an Effect body as `it.effect`. `check(spec, title, property(arbitraries, body))` runs `it.effect.prop` over Schema or fast-check arbitraries, so the inputs come from the same schemas as the contract.
- A property costs about as much as its body times its run count. Keep the body pure, or on in-memory Layers, so the default of 100 runs stays inside the edit loop. Raise `numRuns` only in a queued deep run.
- A machine's model test becomes the law's `model` check: wrap its `it.prop` body in `property(...)` and add `flow`. The page then says the chart is checked against a model.
- A law the product breaks today gets `knownFailing` on an Effect-body proof, which runs as `it.effect.fails`. A property can't be expected to fail, and `check` fails the test with a message if you try. Keep the property for after the fix.
- Plant the bug the law forbids by hand, see the property and the journey test fail on an assertion, then restore the file. mutant-cafe repeats one-spot breaks later, so a law needs no patch. Save one only for a break across several files, or one that changes meaning: break the code, `git diff <file> > breaks/<name>.patch`, restore the file, name it in `breakWith`, and run the break check (**prove-behavior**'s [break-check.md](../../prove-behavior/references/break-check.md)) on it before asking for sign-off.

## Check that tests can fail

[mutant-cafe](https://github.com/joelhooks/mutant-cafe) is mutation testing for Effect. It reads each function's return type and replaces the body with something that still type-checks: an Effect that swallows one of its tagged errors, `Effect.die`, `Effect.never`, `Option.none()`, a Layer that fails to build, a flipped boolean. It runs `vitest related` on each mutant in a scratch copy and reports the mutants no test noticed. On the quote feature, one of them is the seat-range break a law forbids, generated with no patch.

- `pnpm mutants` checks the lines changed since `main`. With no changed source, it selects nothing and exits 0. Add `--file <glob>` for one area, or run `pnpm --filter <pkg> exec mutant-cafe --jobs 4` for the whole package. A full run is a deep run: queue it.
- Read `mutants.out/missed.txt`. A missed mutant means a weak test, so strengthen the test. It never means a code change. `untested` means no test in the package covers that function.
- It runs one package's tests. A mutant only a journey catches shows as `untested` or `missed`, because journeys are their own package. Keep each law's property or model check in the package that owns the code.
- It scores the whole suite, so it can't say which test caught a mutant. Planting the bug by hand answers that for a law's own proofs.
- In CI, run it as an advisory job on the PR range with `--max-mutants 40 --format github --advisory`, as its README shows.

## When to run which

| Slot | Command |
|---|---|
| Edit loop | `pnpm --filter @<scope>/<pkg> exec vitest run <path>` for the code you changed, and `pnpm --filter @<scope>/journeys exec vitest run tests/<file>` for the journeys whose `paths` it touches |
| Edit loop | `pnpm spec:generate`, after any change to a journey, flow, law, or `check()` |
| Done | `pnpm gate`. It runs `pnpm spec` and every test, including the `api` and `dom` journeys |
| Real surface | The `verify-<app>` skill on the running app, for a change a user can see |
| Deep run | `pnpm mutants` on the lines changed since `main`, or `pnpm --filter @<scope>/<pkg> exec mutant-cafe --jobs 4` for a whole package. Never in `gate` |
| Deep run | Playwright smoke tests, only after the owner approves the dependency |
