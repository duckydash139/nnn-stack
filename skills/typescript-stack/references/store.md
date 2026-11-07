# Add a store

Persistence goes behind a port named for the job, with validated writes, bounded reads, one Layer per vendor, and the same tests run against every vendor.

## 1. Name the facts and their owner

- The facts stored, the system of record, and the single writer.
- Each copy derived from it: how to rebuild it, how fresh it is, and what consistency it promises.
- Reuse an existing store when its facts and guarantees fit. Add a new one only for genuinely different facts.
- Write each authoritative fact once. Two independent writes (a row and an aggregate) can't promise consistency. If both must commit together, design one atomic operation first.
- Reporting and analytics must never change whether an unrelated action runs or what it returns.

## 2. Define the port

```ts
export class Orders extends Context.Service<
  Orders,
  {
    readonly place: (input: PlaceOrder) => Effect.Effect<Order, InvalidOrderInput | StoreError>;
    readonly listRecent: (input: ListRecent) => Effect.Effect<ReadonlyArray<Order>, InvalidOrderInput | StoreError>;
  }
>()("@app/orders/Orders") {}
```

- Small named operations. No SQL, ORM types, or vendor resources in the port.
- Schemas and failures sit beside the port.
- `InvalidOrderInput` (the caller's fault) is distinct from `StoreError` (the store's fault). Keep the operation name and the source cause.
- State the retry and identity rule. If `place` creates a new id each call, it isn't safe to replay. Take an idempotency key when callers retry.

## 3. Validate both ways

- Decode input before any statement runs. Reject bad input before storage work starts.
- Decode every row read back with a persisted-row schema, then the domain value. Reject a mismatched row. Don't repair it silently.

## 4. One Layer per vendor, bounded reads

- Each vendor's queries live in its adapter package, with an ORM such as Drizzle inside it if you use one.
- Pick the vendor with one Layer at the composition root.
- Every read names its key, index, order, row cap, and pagination rule. Encode the cap in the input schema (for example, `limit` between 1 and 100).
- Read the query plan. A capped result can still scan the whole table.
- Measure before setting limits, and label any unmeasured number a guess.

## 5. Schema, migrations, and resources together

- Each dialect's schema and migrations live in the adapter package.
- The Layer that owns a cloud database also declares the resource (see [infra.md](infra.md)).
- Keep connection strings redacted, out of the port and out of error messages.
- A schema change isn't permission to replace or delete a resource. Review the plan.

## 6. Prove it on every vendor

- Run one shared behavior suite against each Layer: local SQLite for D1, PGlite for Postgres, or the vendor's own local runtime.
- Cover ordering, caps, invalid input, typed store failures, and isolation between owners.
- Cover replay and interruption when the operation promises idempotency or atomicity.
- Where a local fake differs from the provider, say so in the report, and add a test against the real thing when it matters.

## Report

The port and its operations, the system of record and derived copies, the vendor and migrations, read bounds with plan evidence, the backend test results, and what stays unproven on real infrastructure.
