# Effect shapes

The shapes every package reuses. Read `node_modules/effect/AGENTS.md` for the pinned version before writing new Effect code. When it disagrees with this file, it wins and this file needs an update.

## A service

A service is a named interface for one job. `make` captures its dependencies, so its methods carry none. `layer` sits beside it.

```ts
// receipt-not-found.ts
import { Schema } from "effect";

export class ReceiptNotFound extends Schema.TaggedError<
  ReceiptNotFound,
  { readonly brand: unique symbol }
>()("ReceiptNotFound", {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `No receipt at ${this.path}: ${this.reason}. Fix: check the path, or run the import first.`;
  }
}
```

```ts
// receipts.ts
import { Context, Effect, FileSystem, Layer } from "effect";

import { ReceiptNotFound } from "./receipt-not-found.ts";

export class Receipts extends Context.Service<
  Receipts,
  { readonly read: (path: string) => Effect.Effect<Uint8Array, ReceiptNotFound> }
>()("@app/core/Receipts", {
  make: Effect.gen(function* makeReceipts() {
    const fs = yield* FileSystem.FileSystem;

    const read = Effect.fn("Receipts.read")(function* read(path: string) {
      return yield* fs.readFile(path).pipe(
        Effect.mapError((error) => new ReceiptNotFound({ path, reason: error.message })),
      );
    });

    return { read } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
```

- Each error class gets its own file, with a brand (`{ readonly brand: unique symbol }`). effect-tsrs asks for the brand, so two errors with the same fields can't stand in for each other.
- `effect/FileSystem` is an unstable API in Effect 4.1, so the package lists it in `allowedUnstableApis` (see [new-repo.md](new-repo.md#3-types-that-fail-on-effect-mistakes)).
- Name every generator function (`function* makeReceipts()`). The lint preset requires it, and traces read better.
- The service tag's key is `@<scope>/<package>/<Name>`, unique across the workspace.
- Wrap each method in `Effect.fn("<Service>.<method>")` so traces name it.
- Map vendor errors to the port's own tagged errors at the adapter. Callers never see a vendor error type.
- A second vendor is a second Layer for the same tag, in its adapter package.

## Errors

- Expected failures are `Schema.TaggedError` classes, so they cross the wire and decode on the other side.
- Match them with `Effect.catchTag` or `Match`, never by comparing `_tag` strings by hand.
- A union of failures is `Schema.Union([A, B])` in the contract.
- An impossible state is a defect: `Effect.die(new Error("<what broke>"))`. Don't add it to the error type.
- The message says what happened, why, and how to fix it.

## Config

Read config inside a service, so tests provide values directly:

```ts
import { Config, Context, Effect, Layer } from "effect";
import type { Redacted } from "effect";

interface MailSettings {
  readonly apiKey: Redacted.Redacted;
  readonly from: string;
}

export class MailConfig extends Context.Service<MailConfig, MailSettings>()("@app/core/MailConfig") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* makeMailConfig() {
      return {
        apiKey: yield* Config.Redacted("MAIL_API_KEY"),
        from: yield* Config.String("MAIL_FROM"),
      };
    }),
  );

  static readonly test = (values: MailSettings) => Layer.succeed(this, values);
}
```

Effect 4 names the constructors in PascalCase: `Config.String`, `Config.Redacted`, `Config.Integer`, and `Config.schema` for anything with a `Schema`. Every name here is also in `.env.schema`. Keep secrets `Redacted` all the way to the call that needs the value, and never put one in an error message.

## Composition

Only apps provide Layers. A package exports services and Layers. It never calls `Effect.runPromise` or builds a runtime.

```ts
const MainLayer = Receipts.layer.pipe(Layer.provide(NodeServices.layer));
```

Check `@effect/platform-node` for the pinned name of the Node services Layer. Composition roots are the only place `Effect.run*` appears, through the platform's `runMain`.

## Tests

```ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { PaymentDeclined } from "#/payment-declined.ts";
import { Payments } from "#/payments.ts";
import { runCapture } from "#/capture-machine.ts";

const LineItem = Schema.Struct({ cents: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) });
const total = (lines: readonly (typeof LineItem.Type)[]) => lines.reduce((sum, line) => sum + line.cents, 0);

const declining = Layer.succeed(
  Payments,
  Payments.of({ capture: (paymentId) => Effect.fail(new PaymentDeclined({ paymentId })) }),
);

describe("capture", () => {
  it.effect("a declined payment fails with PaymentDeclined", () =>
    Effect.gen(function* declinedCase() {
      const error = yield* Effect.flip(runCapture("p1"));
      expect(error.paymentId).toBe("p1");
    }).pipe(Effect.provide(declining)),
  );

  it.prop("total never goes negative", { lines: Schema.Array(LineItem) }, ({ lines }) => {
    expect(total(lines)).toBeGreaterThanOrEqual(0);
  });
});
```

Tests import the package's source through its `#/` alias, never `../src` (see [new-repo.md](new-repo.md#2-lay-out-the-workspace)). `it.prop` takes schemas directly and derives the arbitraries. The capture machine is the one in [lifecycle.md](lifecycle.md).

- `it.effect` for one Effect, `it.layer(layer)` to share a Layer across a block, `it.prop` and `it.effect.prop` for properties.
- Derive arbitraries from the domain `Schema`. Don't add a separate generator library.
- Use `Effect.flip` to assert on an expected failure, and `Schema.encodeEffect` to check what crosses the wire.
- Fakes are Layers built with `Layer.succeed(Tag, Tag.of({...}))`.
- Plant a bug before you trust a new property. It must fail and shrink to a small input.
