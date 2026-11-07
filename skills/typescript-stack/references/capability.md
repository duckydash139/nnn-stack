# Add an action

An action is one contract plus one handler. Every surface (browser RPC, HTTP, CLI, agent tools) is a projection of it. Write business logic once.

The repo owns a small `packages/capability`: `defineContract`, `implement`, and one projection per surface. If it doesn't exist yet, write it first (step 0). Projections live there, and only there.

## 0. The capability package, once per repo

A handful of small source files (`contract.ts`, `implement.ts`, `unique-names.ts`, one per projection) and one barrel. The package's `exports` point only at the barrel (`".": "./src/index.ts"`), so callers import it in one line and internal helpers stay private. Ultracite's `oxc/no-barrel-file` passes a barrel this small. Features stay barrel-free.

```ts
// packages/capability/src/contract.ts
import type { Effect, Schema } from "effect";

export type PlainSchema = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export type InputSchema = Schema.Struct<Record<string, PlainSchema>>;

export interface Contract<
  Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
> {
  readonly description: string;
  readonly failure: Failure;
  readonly input: Input;
  readonly name: Name;
  readonly output: Output;
}

export type AnyContract = Contract<string, InputSchema, PlainSchema, PlainSchema>;

export const defineContract = <
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
>(
  name: Name,
  options: Omit<Contract<string, Input, Output, Failure>, "name">
): Contract<Name, Input, Output, Failure> => ({
  description: options.description,
  failure: options.failure,
  input: options.input,
  name,
  output: options.output,
});

export type Handler<ContractType extends AnyContract, Requirements> = (
  input: ContractType["input"]["Type"]
) => Effect.Effect<ContractType["output"]["Type"], ContractType["failure"]["Type"], Requirements>;

export interface Capability<ContractType extends AnyContract, Requirements = never> {
  readonly contract: ContractType;
  readonly handler: Handler<ContractType, Requirements>;
}
```

- `PlainSchema` makes "schemas encode and decode without services" a type error, not a convention. `InputSchema` does the same for "input is a `Schema.Struct`".
- A plain object literal needs no cast. Don't wrap it in `Data.TaggedClass`: the `as unknown as` that wrapper needs is a chained assertion, which anti-slop bans.
- `implement(contract, handler)` returns `{ contract, handler }`.
- Add fields (flags such as `readOnly`, `idempotent`, `destructive`; an approval requirement; an HTTP route) when the first surface that reads them exists. A field nothing reads is documentation the compiler demands.

**Duplicate names.** Effect's `RpcGroup.merge` and `RpcGroup.make` key requests by tag with `Map.set`, so a second action with the same name silently replaces the first. Reject it in the types, in every projection:

```ts
// packages/capability/src/unique-names.ts
export interface DuplicateName<Name> {
  readonly "Fix: give each contract its own name": Name;
}

export type RejectDuplicate<Duplicate> = [Duplicate] extends [never] ? unknown : DuplicateName<Duplicate>;

type RepeatedIn<Names extends readonly string[]> = Names extends readonly [
  infer Head extends string,
  ...infer Rest extends readonly string[],
]
  ? (Head extends Rest[number] ? Head : never) | RepeatedIn<Rest>
  : never;

export type DuplicateContractName<Contracts extends readonly AnyContract[]> =
  RepeatedIn<{ readonly [Index in keyof Contracts]: Contracts[Index]["name"] }>;
```

The projection takes `contracts: Contracts & RejectDuplicate<DuplicateContractName<Contracts>>`. A collision reads `Property "Fix: give each contract its own name" is missing … DuplicateName<"Double">`.

**Projections.** Write each one only when a surface needs it:

| Surface | Function | Built on |
| --- | --- | --- |
| Browser RPC client | `toRpcGroup(contracts)` | Effect `Rpc` and `RpcGroup`. Contracts only, never handlers, so the browser can import it |
| Server RPC | `toRpc(capabilities)` → `{ group, layer }` | `group.toLayer(...)`, with each handler keyed by its contract's name |
| Merging features | `mergeRpc([a, b, c])` → `{ group, layer }` | `RpcGroup.make().merge(...)` and `Layer.mergeAll(Layer.empty, ...)`. Rejects names shared across surfaces. Type its input slots with `RpcGroup.Any` and `Layer.Any`, because `RpcGroup<Rpc.Any>` is invariant |
| HTTP | `toHttpApi` | Effect `HttpApi`. OpenAPI comes from the schemas |
| Agent tools (MCP) | `toToolkit` | Effect AI `Tool` and `Toolkit` |
| CLI | `toCommand` | Effect CLI commands, with `--json` output |

The projections erase each capability's types while they build one handler map, then restore them at the return type. Each erasure is a `const x: unknown = ...` followed by one `as` with a `SAFETY:` line and an `oxlint-disable-next-line typescript/no-unsafe-type-assertion -- <reason>`. Effect diagnostics on the erased channels get a file-level `// @effect-diagnostics anyUnknownInErrorContext:off -- <reason>`.

**Ban hand-rolled surfaces.** Lint the imports, not the call:

```ts
const handRolledRpc = [
  { importNames: ["Rpc", "RpcGroup"], message, name: "effect/rpc" },
  { message, name: "effect/rpc/Rpc" },
  { message, name: "effect/rpc/RpcGroup" },
];
```

Put these in `no-restricted-imports` `paths` for every file except `packages/capability/**`. Each Oxlint override **replaces** `no-restricted-imports` instead of merging it, so every override must repeat the shared paths. Build each override's value from one helper (`restrictImports(...patterns)`) that always includes them. Do the same for `HttpApi*` and `Tool` when those projections exist.

## 1. Define the contract

A contract lives in the feature's `shared/` folder (see [web.md](web.md#where-things-go)). The module imports `Schema` and the capability package, nothing server-side, because the browser imports it.

```ts
export class GreetRefused extends Schema.TaggedError<GreetRefused, { readonly brand: unique symbol }>()(
  "GreetRefused",
  { personName: Schema.String, reason: Schema.String }
) {}

export const greet = defineContract("Greet", {
  description: "Greets a person by name, or refuses a reserved name.",
  failure: GreetRefused,
  input: Schema.Struct({ name: PersonName }),
  output: Greeting,
});

export const GreetingRpcs = toRpcGroup([greet]);
```

- A union of failures is `Schema.Union([A, B])`.
- The browser Command calls `RpcClient.make(GreetingRpcs)`.

## 2. Implement it

Put the handler in the feature's `server/<name>.rpc.ts`. Keep it thin: call a service or run a machine. Provide the feature's own service Layers here, so the app only merges.

```ts
export const greetCapability = implement(greet, ({ name }) => runGreet(name));

const projection = toRpc([greetCapability]);

export const greetingRpc = {
  group: projection.group,
  layer: projection.layer.pipe(Layer.provide(Greeter.layer)),
};
```

## 3. Register it

The app's server merges every feature's projection in one line, so a cross-feature name collision is a type error:

```ts
const appRpc = toRpc([]);
const rpc = mergeRpc([appRpc, greetingRpc, quoteRpc]);

RpcServer.layerHttp({ group: rpc.group, path: RPC_PATH, protocol: "http" }).pipe(
  Layer.provide(rpc.layer),
  Layer.provide(RpcSerialization.layerJson)
);
```

`appRpc` holds actions that belong to no feature. Keep it even while empty, so removing every feature leaves a working server.

## 4. Test it

- The handler's output and each expected failure, through `it.effect` with fake Layers.
- Projections through `RpcTest.makeClient(projection.group)` from `effect/rpc`, which runs the real encode and decode in memory: success, a typed failure, input the schema refuses, two capabilities needing different services, and `mergeRpc` serving two surfaces.
- Duplicate names with `// @ts-expect-error -- <reason>` on a colliding call. An unused directive fails the typecheck (TS2578), so the check proves itself.
- A property when the action enforces a rule over many inputs.
- One end-to-end test through the real HTTP surface when the action changes a public interface.

## Report

The contract name, where the handler lives, which surfaces project it, and the tests that cover its failures.
