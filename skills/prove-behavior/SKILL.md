---
name: prove-behavior
description: Decide what a change must prove and how much proof it's worth - a risk tier, time budgets, bad journeys, laws for money/data/access/trust rules, and audits of existing behavior - using the project's own gate. Load only for /prove-behavior or when nnn-mode's verification ladder routes here. Never load it just because a task mentions tests.
---

# Prove behavior

Decide what a change must prove, including when things go wrong, and spend only what the risk is worth. The human's attention and wall-clock time are the scarce resources, not compute.

This skill decides **what** to prove and **how much**. The project's `verify-<app>` skill drives the real surface. This skill never builds a gate, a merge queue, or a protection scheme. It uses the project's gate as it is.

## Pick the tier first

Name the tier in your first message, with one line of reason. Do only that tier's work.

| Tier | The change | Prove it with | Human approves |
|---|---|---|---|
| **0** | Copy, styling, docs, or a refactor that existing tests cover | The project's gate. Nothing else | Nothing |
| **1** | New or changed behavior | One test per behavior, plus the bad journeys that apply. Then the gate | Nothing. Report what's covered |
| **2** | A rule whose break costs money, data, access, or trust, across more than one path | Tier 1, plus a law with a property or model test | The law's wording, before you implement |

If you can't tell tier 1 from tier 2, ask one question. Don't default up.

## Time budgets

| Step | Budget | When it's over |
|---|---|---|
| Edit loop: tests for the changed area | about 2 minutes | Run fewer tests, or a faster shape |
| Done: the project's gate | about 10 minutes, or the gate's own time | Report the time. Don't trim the gate |
| Deep run: mutation sweeps, browser sweeps, repeated runs, long simulations | Not in the session | Queue it (see Deep runs) |

Never stretch a budget quietly. When a step outgrows it, say so and move the work to a later slot.

## When each check runs

| Check | Runs | Slot |
|---|---|---|
| Tests for the changed area, including the `api` and `dom` journeys whose `paths` the change touches | After every edit | Edit loop |
| Planting the bug a new test or law guards against, then restoring the code | Once per new test or law | Edit loop |
| Regenerating the journey pages | In the same commit as any change to a journey, flow, law, or `check()` | Edit loop |
| The project's gate: build, types, lint, the spec check, and every test, journeys included | Before a change counts as ready, on that exact commit | Done |
| The `verify-<app>` skill, proving the changed journey lines by ID on the running app | Once per change a user can see, after the gate and before it ships | Real surface |
| The formal model's recheck | When the code it covers changes. Its command is part of the gate | Done |
| Mutation testing on the changed lines | After the change lands, or as an advisory job on the pull request | Deep run |
| The break check over saved patches | Queued, or in the session for a new or rewritten patch | Deep run |
| `browser` journeys, repeated runs of timing-sensitive tests, long property runs and simulations | Queued | Deep run |

Tier 0 runs only the gate. Tier 1 adds the edit-loop rows and, for a change a user can see, the real surface. Tier 2 adds the planted bug for each law.

## Rules

- **Expected behavior comes from a source independent of the builder.** That means an approved requirement, a brief, a reported bug, or the human's words. Your own reading of the code doesn't count. If no source defines the right answer, or two sources disagree, the human decides.
- **Brief lines are filed word for word.** A brief from `writing-expectations` gives EARS lines and journeys the human approved. Title each line's test `<ID>: <line>`, such as `TODO-7: WHEN a person adds a todo, THE SYSTEM SHALL show it first`, with the next free number under the feature's prefix in `prefixes` in `journeys/spec.json`. Add the prefix there for a new feature. `Replace <ID>` changes that test's title and assertion, and `Withdraw <ID>` deletes its test and adds the ID to `retiredIds` in `journeys/spec.json`. Never renumber. A line under an `Every path:` note is a law, so prove it at tier 2 across every door the brief lists.
- **Every test earns its place.** Keep a test when you can name the bug it catches and no higher-level test would fail if that bug came back. Otherwise delete it, and give the name and reason in the commit.
- **An agent's claim is not evidence.** A change counts as proven only by a gate result on the exact commit. An audit finding counts only with a reproduction.
- **Coverage shows what's untested.** Never use it as a target.

## Tier 1: a behavior change

1. **List the journeys.** Name the journeys the change touches, then the bad journeys around them. Walk this taxonomy and keep only the cases that exist:
   1. Happy path.
   2. Edge: empty, zero, max.
   3. Error: invalid input, thrown errors.
   4. Another actor: someone who doesn't own the data, or is signed out, gets nothing.
   5. Same person, other context: signs in partway, a second device, a stale client, earlier records.
   6. Reversal: a final state is undone, or arrives late after something else took its place.
   7. Worst case: resource exhaustion.
   8. Concurrency or timing: parallel calls, races, double submits.
   9. Dependency or environment: a dependency fails, config changes.

   Then ask what's left behind when a step fails halfway, and which step happens twice when a request repeats. Every past incident in this area becomes a bad journey.

2. **Pick each test's shape** by what it proves, through the public interface (the **test-behavior-not-implementation** principle skill):
   - A rule over many inputs: a property test.
   - Anything with history, such as sessions, retries, or lifecycles: a model test that replays generated command sequences against a small model.
   - UI behavior: a component or interaction test that asserts what the person sees, not internal state.
   - One interface between parts: a single example test over the real adapter.

   Then plant the bug: break the behavior the test protects, watch the test fail on an assertion, and restore the code. A test that never failed proves little. Prove each behavior once, at the cheapest shape that can fail for the right reason. Keep browser-level journeys to a few critical paths.

3. **Build in vertical slices.** One behavior at a time: its test, then the smallest code that passes it. Don't write every test first.

4. **Check what a bad journey left behind.** A bad journey passes when the product fails safely: a clear outcome for the person, no lost or corrupted data, and no access granted. An error message alone proves little, so check the resulting state too.

5. **Pass the gate** once, at the end. Report the result, the commit, and what the tests don't cover.

Name tests by the project's convention.

## Tier 2: a law

Write a law only when a break costs money, data, access, or trust, and the rule holds across more than one path. Most projects need a handful.

1. **State it** in four parts, and get the human's approval on the wording:
   - **Name:** for example `NoDoubleCharge`.
   - **Kind:**
     - `never`: the outcome must not happen.
     - `always`: true in every state.
     - `eventually`: it recovers once faults stop.
     - `reachable`: a run really gets there.
   - **Over:** what varies. For example, "any order of checkout requests, retries, and timeouts".
   - **Says:** one sentence.
2. **Prove it** with a property or model test, plus one journey test. Have a fresh subagent write the property or model from the approved law and the public interface only, not from the implementation. For races, retries, and state machines that tests can't reach, route to **create-formal-verification-skill**.
3. **Plant the bug the law forbids**, such as removing the idempotency key. At least one proof must fail on an assertion, not a crash. Restore the code, and put the failing input in the report. Save the break as a patch only when a mutation tool can't make it: a break across several files, or one that changes what the code means, such as dropping a key the caller and the store both rely on. Then put it in `breaks/` and name it in the law's `breakWith`. A break in one spot, such as a flipped condition or a swallowed error, is left to the mutation run in [Deep runs](#deep-runs).

A law the product breaks today stays a known bug. Mark its proof as expected-to-fail and name the fix it waits on. Don't weaken the law to make it pass.

## Journeys and laws on file

A project that has `journeys/spec.json` keeps its journeys, laws, and flow charts as files, and generates a page per flow from them. There, every tier 1 and tier 2 proof goes in that format:

- Journeys, bad journeys, flows, line IDs from a brief, and the generated pages: [references/journeys.md](references/journeys.md).
- Laws and their proofs, including a law the product breaks today: [references/laws.md](references/laws.md).
- Proving each saved break still makes its proofs fail, when the project keeps any: [references/break-check.md](references/break-check.md).

Run `node tools/journey-spec/journey-spec.mjs generate` in the same commit as any change to a journey, flow, law, or `check()`, and `next-ids` for the next free line ID. The gate runs `check`, so a stale page fails it.

This skill doesn't set the format up. A stack skill does, such as **typescript-stack**, or the human approves adding it, as [The journey pages](references/journeys.md#the-journey-pages) says. In a project without it, prove behavior with ordinary tests and say the project keeps no journey pages.

## Audit: find what's broken

When asked whether existing behavior is broken or safe to ship, follow [references/audit.md](references/audit.md). An audit ends at the report. Fixing a finding is a new tier 1 or tier 2 change.

## Deep runs

These never run in the session unless the human asks:
- Mutation testing on the changed lines, with the project's mutation tool, such as the one a stack skill names. A missed mutant means a weak test, so strengthen the test. It never means a code change. The tool scores the whole test suite, so it can't say which proof caught a mutant. Planting the bug in the session answers that for a law.
- Mutation sweeps across a whole area.
- Browser sweeps.
- Running timing-sensitive tests three times to find flakes.
- Long simulations and randomized seeds.
- The [break check](references/break-check.md) across every saved patch, if there are any.

Queue them instead. List the commands in the reply under **Deep runs queued**, and offer to schedule them with the `/schedule` or `/loop` skill. A deep run reports in one short note. Every item it lists needs an owner, or the run stops meaning anything.

## Report

- The tier and why.
- The journeys and bad journeys covered.
- Any law, and the planted bug that made its proof fail.
- The journey pages regenerated, when the project keeps journeys on file.
- The gate result and commit, with the time each step took against its budget.
- What isn't covered, and the deep runs queued.
