# Laws

A law is a rule that must hold in every case, such as "a customer is never charged twice for one order". Journeys prove named paths. Laws state what must stay true on every path, including ones nobody named.

Write a law when a break would cost money, data, access, or trust, and the rule applies across more than one path. A brief's `Every path:` note marks a line that needs one. Behavior with one trigger and one response stays an EARS test title in a journey. Most projects need a handful of laws, so don't write one per test.

## The format

Keep all laws in one file: `laws.ts` at the project root, or the path in `laws` in `journeys/spec.json` when tests must import laws from a package. It's protected, like `journeys/`. Changes to it need the owner's sign-off, as the project's `AGENTS.md` lists it.

```ts
// laws.ts
export const NoDoubleCharge = law({
  kind: "never",
  over: "any order of checkout requests, retries, and timeouts",
  says: "A customer is charged twice for one order",
  breakWith: ["breaks/no-idempotency-key.patch"],
});
```

| Field | Meaning |
|---|---|
| Variable name | The law's name. A model rule with the same meaning uses this name. |
| `kind` | The type of promise, which sets the proof it needs |
| `over` | What the law covers, in plain words. Name what varies. |
| `says` | The rule in one sentence. For `never`, state the outcome that must not happen. |
| `breakWith` | Optional. Patches that each remove behavior the law depends on, for breaks no mutation tool can make: across several files, or ones that change meaning. A law with two such clauses needs a patch for each, or split it into two laws. |
| `knownBroken` | Optional. See [A law the product breaks today](#a-law-the-product-breaks-today). |

Each law is an `export const` with a plain object literal. Importing `laws.ts` must do nothing except define the laws, and `law()` returns a typed value that proofs can import.

`law()`, `check()`, and `prove()` start from the templates in [assets/](../assets/law.ts), set up as in [The journey pages](journeys.md#the-journey-pages). Add the laws file, `breaks/`, and those helpers to the project's test, type, lint, and dead-code config, because a root file may sit outside all of them.

## Proving a law

Proofs point at the law, so each link lives in one place and find-all-references lists every proof. Import the variable, and don't rename it on import.

Link one test at a time, because a journey's other tests may not bear on the law. In a journey, use `prove()`:

```ts
import { NoDoubleCharge } from "../laws";

journey({ title: "Buy a product with a saved card", /* ... */ }, () => {
  prove({ proves: [NoDoubleCharge] }, "IF two tabs submit the same cart, THEN THE SYSTEM SHALL charge once", async () => {
    // ...
  });
});
```

Checks outside `journeys/` declare the same link with `check()`, using a plain literal. It can name its own patches:

```ts
check({ type: "property", proves: [NoDoubleCharge], breakWith: ["breaks/skip-retry-lookup.patch"] }, "THE SYSTEM SHALL charge at most once, for any order of retries", async () => {
  // ...
});
```

| Kind | Promise | Required proof |
|---|---|---|
| `always` | True in every state, for every input | A `property` or `model` check, plus one journey test |
| `never` | This outcome can't happen | A `property` or `model` check, plus one journey test |
| `eventually` | The system recovers once faults stop | A `simulation` or `model` check |
| `reachable` | A run really gets to this state | A `reachability` check |

Build `property` and `model` checks as [Tier 2](../SKILL.md#tier-2-a-law) says, and `simulation` or `reachability` checks with the **create-formal-verification-skill** skill. A `check` with a type that doesn't exist for this project yet fails, so never add one as a placeholder.

Only claim a law on a test that can fail for it. If planting the bug, or the break check, shows a test never fails for the law, remove the claim.

## Who does what

1. An agent drafts the law, and the human approves `kind`, `over`, and `says`. No tool can tell whether a rule is the right one, so this approval carries the most weight. If the law needs saved patches, the draft names its `breakWith` files before they exist, so the spec check fails on the branch until step 3. It also drafts the titles of the checks the law's kind requires, and the human approves them too. Keep those checks under a protected path, such as `journeys/checks/`, so a branch can't loosen them.
2. A tester agent writes the proofs from the public interface, without reading the implementation.
3. An agent plants the bug the law forbids and sees each proof fail, then writes any `breakWith` patches against the current code. Check every older patch with `git apply --check` too, and rewrite any that no longer applies. Run the [break check](break-check.md) on the branch to see each new patch fail its proofs before the merge.
4. The law lands with its code in one commit, after the owner signs off, following [Who does what](journeys.md#who-does-what).

Never weaken a law to get a pass. If the code breaks a law, report it with the shortest failing sequence and ask the human what to change. If that sequence came from a model, replay it against the real code first, and show it with the **statechart** skill.

## A law the product breaks today

Writing a law can expose a bug, so a law may start out broken. A kept failing test would leave the gate red and stop tools that need a green run, such as mutation testing. Record the bug in three places instead:

```ts
// laws.ts
export const NoOverselling = law({
  kind: "never",
  over: "any orders from any number of customers, tabs, or devices, in any order",
  says: "Confirmed orders hold more units of a product than were in stock",
  breakWith: ["breaks/drop-the-stock-limit.patch"],
  knownBroken: { bug: "BUG-12", fix: "breaks/fixes/add-the-stock-limit.patch" },
});
```

```ts
prove({ proves: [NoOverselling], knownFailing: "BUG-12" }, "IF two customers buy the last unit, THEN THE SYSTEM SHALL confirm one order", async () => {
  // ...
});
```

1. `knownBroken` on the law names a tracked bug and a patch that fixes it.
2. `knownFailing` on each failing proof names the same bug. `prove()` and `check()` turn it into the test runner's expected-failure mode, so the proof must keep failing. If it starts to pass, the run fails until the marker is removed. The break check turns the marker off by setting `IGNORE_KNOWN_FAILING=1`.
3. The flow page lists the law under Known bugs, and the chart shows the bug as a `broken` state.

The human approves each marker, like any other change to a law. The gate passes with a known failing proof, and every report lists it. An expected failure can hide a different failure, so the break check applies the fix first: the proofs must pass on the fix, then fail on the `breakWith` patch. With no patch, plant the bug on top of the fix by hand and check the same two things.

## Proving a law can fail

Plant the bug in the session first, as [Tier 2](../SKILL.md#tier-2-a-law) says, and leave one-spot breaks to the mutation run. Store each patch you do keep in `breaks/`, which is protected too. The break check applies each patch to a clean checkout and runs the proofs that name it. See [Break check](break-check.md).

The patch must remove the behavior itself, such as the idempotency key. A patch that only makes the test crash proves nothing. Each proof of a law must fail on at least one of its patches, because a proof that never fails isn't checking the law.

When the code moves, a patch stops applying. That counts as a stale patch, not a pass. An agent rewrites it, and the rewrite needs the same approval as the law.
