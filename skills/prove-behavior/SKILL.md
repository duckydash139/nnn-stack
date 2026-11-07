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

## Rules

- **Expected behavior comes from a source independent of the builder.** That means an approved requirement, a brief, a reported bug, or the human's words. Your own reading of the code doesn't count. If no source defines the right answer, or two sources disagree, the human decides.
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
3. **Plant the bug the law forbids**, such as removing the idempotency key. At least one proof must fail on an assertion, not a crash. Restore the code, and put the failing input in the report.

A law the product breaks today stays a known bug. Mark its proof as expected-to-fail and name the fix it waits on. Don't weaken the law to make it pass.

## Audit: find what's broken

When asked whether existing behavior is broken or safe to ship, follow [references/audit.md](references/audit.md). An audit ends at the report. Fixing a finding is a new tier 1 or tier 2 change.

## Deep runs

These never run in the session unless the human asks:
- Mutation sweeps across a whole area.
- Browser sweeps.
- Running timing-sensitive tests three times to find flakes.
- Long simulations and randomized seeds.

Queue them instead. List the commands in the reply under **Deep runs queued**, and offer to schedule them with the `/schedule` or `/loop` skill. A deep run reports in one short note. Every item it lists needs an owner, or the run stops meaning anything.

## Report

- The tier and why.
- The journeys and bad journeys covered.
- Any law, and the planted bug that made its proof fail.
- The gate result and commit, with the time each step took against its budget.
- What isn't covered, and the deep runs queued.
