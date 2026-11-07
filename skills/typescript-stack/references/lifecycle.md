# Add a lifecycle machine

Use a machine when the work has states that matter to someone: pending, retrying, cancelled, expired, done. XState owns the states and the moves between them. Effect owns the side effects, typed errors, services, and cleanup. Keep a plain Effect when there are no states worth naming.

Before writing, read the installed `@xstate/effect` README, docs, and tests for the pinned version. Its API is pre-release and moves.

## 1. Write the states first

List the states, the events, and the final outcomes before any code. For a payment capture: `authorizing`, `capturing`, `captured`, `declined`, `expired`. The outcome is a tagged union, so a known failure ends in a final state instead of an error:

```ts
export type CaptureOutcome = Data.TaggedEnum<{
  Captured: { readonly receipt: Receipt };
  Declined: { readonly cause: Cause.Cause<PaymentDeclined> };
}>;
export const captureOutcome = Data.taggedEnum<CaptureOutcome>();
```

A failed actor reports an `EffectFailure` that wraps the Effect `Cause`. Keep the `Cause` in the outcome, and re-raise it with `Effect.failCause`, so the typed error and its trace both survive.

If a person must judge the flow, draw it with the **statechart** skill before building it.

## 2. Declare side effects as actors

Each side effect is a `createEffectLogic` actor defined outside the machine:

```ts
const capture = createEffectLogic({
  effect: ({ input }) => Payments.use((payments) => payments.capture(input.paymentId)),
  schemas: { input: Schema.Struct({ paymentId: Schema.String }) },
});
```

Never return an Effect from an inline XState callback. Only actors and actions declared in `setupEffect` add to the machine's requirements.

## 3. Build the machine

```ts
export const captureMachine = setupEffect({
  actors: { capture },
  schemas: { context: types<CaptureContext>(), input: Schema.Struct({ paymentId: Schema.String }) },
}).createMachine({
  context: ({ input }) => ({ outcome: undefined, paymentId: input.paymentId }),
  initial: "capturing",
  output: ({ context }) => context.outcome,
  states: {
    captured: { type: "final" },
    capturing: {
      invoke: {
        input: ({ context }) => ({ paymentId: context.paymentId }),
        onDone: {
          context: ({ context, event }) => ({ ...context, outcome: captureOutcome.Captured({ receipt: event.output }) }),
          target: "captured",
        },
        onError: {
          context: ({ context, event }) => ({ ...context, outcome: captureOutcome.Declined({ cause: event.error.cause }) }),
          target: "declined",
        },
        src: "capture",
      },
    },
    declined: { type: "final" },
  },
});
```

A loop that yields `Effect.sleep` is a lifecycle hiding in a generator: its states, cancellation, and resumption have no names. `stack/no-sleep-in-loop` flags it. It walks up from each `Effect.sleep` call, stops at a function boundary, and reports a `while`, `do`, or `for` statement it reaches through a `yield`. The fix is a machine with declared actors, or `Effect.retry` with a `Schedule`.

A machine that calls a provider takes one timeout at the boundary, bounded retries that reuse the same idempotency key, and holds nothing open across the call.

### When a machine grows

Split a machine when you see one of these:

- An event matters in only a few states, but every state has to say it ignores it.
- Two concerns change independently, such as a form draft and a file upload.
- A sub-flow has its own retries, deadline, or cancellation.
- The model test needs long, specific event sequences to reach a state.

Use the cheapest tool that fits:

1. **Nested states**, for modes that share transitions. The parent holds the shared `on`, and each child holds only what differs. The quote wizard's `editing` holds the field edits and Back, and only `editing.valid` accepts Submit, so the machine refuses an invalid submit without a guard. Give the machine an `id` and target `#id.parent.child`, because a target in a nested state resolves against its own parent.
2. **Parallel regions** (`type: "parallel"`), for independent concerns that share one context. Each region adds to the state count, so check that the model test still reaches every combination you care about.
3. **A child machine** started with `invoke`, for a sub-flow with its own lifecycle. It lives in its own `<name>-<part>.machine.ts` with its own model test, and talks to the parent only through its input and its done or error result, never `sendParent`. The parent's model test treats it like any other invoked actor, with sample done and error results.

A child machine keeps each model test the size of one machine. Nested states and parallel regions make the one test bigger.

The model-test helpers handle nested states: `leafStatesOf` turns a state value into leaf paths like `editing.invalid`, and `declaredStatesOf` lists every leaf in the tree. Compare those instead of `String(state.value)`, which turns a nested value into `[object Object]`.

## 4. Run it inside Effect

Start it with `createEffectActor`, never XState's `createActor`. Lint makes that structural: `no-restricted-imports` bans `createActor` from `xstate` in every override (see [new-repo.md](new-repo.md#4-lint)). Wait with `join` inside `Effect.scoped`, then turn the outcome back into Effect's channels:

```ts
export const runCapture = Effect.fn("runCapture")(function* runCapture(paymentId: string) {
  const actor = yield* createEffectActor(captureMachine, { input: { paymentId } });
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- join's machine error is unknown by design; domain failures travel through the outcome.
  const outcome = yield* join(actor).pipe(Effect.orDie);
  if (outcome === undefined) {
    return yield* Effect.die(new Error("captureMachine finished without an outcome"));
  }
  return yield* captureOutcome.$match(outcome, {
    Captured: ({ receipt }) => Effect.succeed(receipt),
    Declined: ({ cause }) => Effect.failCause(cause),
  });
}, Effect.scoped);
```

The capability handler calls the runner. The app provides the service Layers.

## 5. Model test

Every machine gets a model test beside it: `<name>.machine.ts` pairs with `<name>.machine.model.test.ts`. How much goes in it depends on whether the machine takes events. A small Oxlint rule (`stack/machine-model-test`) enforces both levels from `context.filename`, so a new machine without its test fails the gate. Oxlint calls rules synchronously, so the rule reads the disk with `node:fs`: suppress `nodeBuiltinImport` on that import with the reason, and keep your own plugin under the root tsconfig (exclude only the vendored ones), or type-aware lint sees `existsSync` as an error type.

**Every machine: walk to every ending.** Use `getShortestPaths` from `xstate/graph`. Assert the set of endings equals the machine's own final states (`machine.root.states` filtered by `type === "final"`), and check each path's output against an independent model of what its child results imply. A new ending without a path, or a refusal routed onward, fails here.

- `xstate/graph` synthesizes invoke results with no payload, so a handler that reads `event.error.cause` throws. Pass `events: (snapshot) => ...` that returns, for each `Object.keys(snapshot.children)`, a `xstate.done.actor` event with a sample `output`, and a `xstate.error.actor` event with `error: new EffectFailure(Cause.fail(sample))`.
- Put this in one shared test helper (`pathsToEveryEnding(machine, { input, results })`, `finalStatesOf`, `reachedStatesOf`), so a simple machine's model test is about 40 lines. The helper erases the machine type to call the graph, then restores it with one `SAFETY:` cast.
- Compare outcomes through a projection: `Cause.squash` for a refusal, since two equal failures in different `Cause` values never deep-equal.

**A machine that takes events (`on` or `after`): add generated sequences.** Shortest paths visit each state once, so they miss bugs that need a particular order, like a reply landing after the person moved on. The rule spots `on` and `after` keys in the machine and then requires an `it.prop` in its model test.

- Generate commands from a `Schema.TaggedUnion`, so the test builds them with `cases.X.make` and branches with `match` or `guards`, which anti-slop requires.
- Keep an independent model of which events each state accepts, and what work each step starts.
- Generate sequences long enough to reach the deep states: `Schema.Array(Command).check(Schema.isMinLength(10), Schema.isMaxLength(40))`. With the default lengths, a wizard property caught a parse bug in about one run in three, because it rarely built "choose, type a bad value, submit". After the change it caught it in every run. Run options go under `arbitrary` (`it.prop(name, arbitraries, body, { arbitrary: { runs: 1000 } })`); a `fastCheck` key is silently ignored. Sample the edge inputs the spec names (signs, exponents, `0x`, `3.0`), not just the happy ones.
- Run the sequence against `createEffectActor`, settling child work through a `Deferred` inside a fake service, never by injecting completion events. A browser machine stepped from `update` (see [web.md](web.md#xstate-in-the-browser)) runs generated Messages through `update` instead, and compares the Command each step returns.
- After the final state, send more commands. The output and the work done must not change.
- For deadlines, add a `wait` command that calls `TestClock.adjust(ms)`. Check just before, at, and after the deadline.

A machine with no events, such as call-then-route, needs only the walk. Its example tests already cover its child results, and a generated test over the same results finds nothing they miss.

**Plant a bug** in every new machine: route a refusal onward, or accept an event in a state that must ignore it. The model test must fail (and shrink, for a property). Record the failing input, then restore the machine.

**Get a second model from someone who never saw the machine.** You wrote the machine and the model from the same understanding, so a shared misreading passes both. For every new machine that takes events, once your model test passes:

1. Write the spec in plain words: each state, the events it accepts, what each event changes, and what work it starts. Take it from the brief or the owner, not from the machine. Writing this list is where most machine bugs show up, so review it with the owner.
2. Start a fresh subagent (the **judgment** role) and say in the prompt that this step is the reason. Give it the spec, the public interface (the stepper or runner, the event and Message types, the outcome or Command types), and the model test's command schema. Never give it the machine file or your model.
3. It writes its own model next to yours in the same model test file (`specModel` beside `model`), and the property checks every generated sequence against both.
4. A disagreement is a finding, not a failing test to silence. Decide which of the machine, your model, and its model matches the spec. Ask the owner when the spec doesn't decide. Fix the wrong one, and never delete the model that disagreed to get green.

Report each disagreement and how it was settled. A machine with no events has no sequences to compare, so its graph walk keeps your model alone. For a rule whose break costs money, data, access, or trust, the subagent writes the model from the approved rule before you implement (prove-behavior tier 2), not after.

## Report

The states and outcomes, the actors and the services they need, the planted bug and its failing input, each disagreement between the two models and how it was settled, and the statechart if one was drawn.
