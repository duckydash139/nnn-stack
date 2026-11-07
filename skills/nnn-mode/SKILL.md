---
name: nnn-mode
description: Route non-trivial code, data, design, investigation, and documentation work to every matching playbook, principle, and verification skill. Use for /nnn-mode or any task that needs rigor.
disable-model-invocation: true
---

# nnn mode

Follow the project's `AGENTS.md` when it exists. This skill picks playbooks and principles within it.

Bundled skills live at `../<name>/SKILL.md` from this file. Playbooks live at `playbooks/<name>.md`.

## Non-negotiables

- First message on a task: restate the goal, the problem, and the smallest change you expect, per the **in-your-own-words** skill. Don't wait for confirmation. If the evidence rules out the requested change, show it and stop.
- Start a todo list. Its first item is reading the Principles index below. Open every principle that bears on a decision. In the reply, name each principle that changed a choice and the choice it changed. Cite only principles you read this session.
- Before code, name the data shape, the authoritative store, the copies derived from it, and the single writer.
- Measure before you set a timeout, rate cap, batch size, or concurrency limit. Put the baseline first. A requested value is a hypothesis.
- Done means proven on the real artifact, per the Verification ladder below. "It compiles" is not done.

## Triggers

- Nontrivial change, architecture decision, or "are we sure?" → **how**. Motivation or history → **why**.
- Using an external library, framework, or API → **dependency-usage-grounding** before reading installed package source.
- Any fork you could settle by running something → the Prototype playbook, not a question to the human.
- Code that crosses a function boundary → **architect**.
- A small-looking change with unclear reach → **blast-radius**.
- Review of a plan, PR, or diff → **scrutinize** (intent, simpler alternative, traced code path). Contested design, or a diff before shipping → also **interrogate**, which keeps only findings a run proves.
- Mapping tunable parameters or optimizing against a benchmark → **auto-research**. A measured number you will report or act on → **benchmark-checklist**.
- Any prose, your reply included, and every doc, PR body, or commit message → **unslop**.
- The same correction a second time → **correct**. Encode it in structure (a lint rule, a check, a test) per the **encode-lessons-in-structure** principle skill, not more prose.
- The user names a stack or template ("use <repo, site, or package>") → that stack supplies the stack rules, not **typescript-stack**. Read its agent guide first: the site's `/llms.txt` if it has one, then the template's `AGENTS.md`. For a new repo, start from the template the way its guide says (clone or copy it), then follow the next trigger.
- The repo's `AGENTS.md` names its own router or stack skills → read them from the checkout. Treat its playbooks and principles as project playbooks next to these, in one todo list. Its gate, pins, and rules win. Report principles from both sets.
- A TypeScript repo (a `tsconfig.json`, or `typescript` in `package.json`), or a new repo that will be TypeScript, and neither trigger above applies → load **typescript-stack** before planning. It adds the stack, its rules, and its playbooks to this list, and a new repo starts with its new-repo playbook.
- No playbook fits → design a short bespoke playbook from the principles, write its steps into the todo list, and say so.

## Verification ladder

Climb only as far as the risk needs. Each rung's check joins the gate, so the next agent can't skip it.

1. **The gate.** The project's full check, as `AGENTS.md` names it. Required before you say a change is ready. If the project has no gate, say so before claiming anything is proven.
2. **Behavior and its bad journeys.** Run **prove-behavior** for any behavior change. It picks a tier (0 gate only, 1 tests plus bad journeys, 2 a law with a planted bug) and decides what to prove. It keeps the edit loop near 2 minutes and the done check near 10, queues slow runs for later, and owns audits of existing behavior ("is this broken?", "is it safe to ship?").
3. **Behavior on the real surface.** Drive the app through the project's `verify-<app>` skill. This is the "control skill" the playbooks name. If none exists, run **create-verification-skill**. If its feature map drifted, run **maintain-verification-skill**.
4. **Properties tests can't reach.** Races, retries, cancellation, lifecycle machines, parsers → **create-formal-verification-skill**. When covered code changes → **maintain-formal-verification-skill**. Add its recheck command to the gate.
5. **Show the owner.** When a person must judge the behavior, run **statechart** to draw the checked model and the shortest path to each state that breaks a rule.

## Principles index

Each **principle-*** skill holds one rule. Open every one that bears on a decision.

**Core** (pstack skills): laziness-protocol, foundational-thinking, redesign-from-first-principles, attack-the-premise, subtract-before-you-add, minimize-reader-load, outcome-oriented-execution, experience-first, exhaust-the-design-space, build-the-lever.

**Architecture** (pstack skills): model-the-domain, boundary-discipline, type-system-discipline, make-operations-idempotent, migrate-callers-then-delete-legacy-apis, separate-before-serializing-shared-state.

**Verification** (pstack skills): prove-it-works, fix-root-causes, sequence-verifiable-units, test-behavior-not-implementation, explain-the-number.

**Delegation and meta** (pstack skills): guard-the-context-window, never-block-on-the-human, encode-lessons-in-structure.

## Playbooks

Match every playbook that applies. Open each one and copy its steps into the todo list before task-specific steps. A skipped step stays as `skip: <reason>`. Finish with each playbook's reply requirements.

**Work shapes** (`playbooks/`): investigation, bug-fix, perf-issue, hillclimb, runtime-forensics, trace-forensics, feature, refactoring, prototype, autonomous-run, session-pickup, pause-safely, authoring-a-skill, and opening-a-pr at the end of any change.

**Stack playbooks** (TypeScript, from **typescript-stack**): new-repo, capability, lifecycle, store, web, infra. They stack with the work shapes: a feature that adds an action and a table runs feature, capability, and store.

## Autonomy

- **Just do it.** Reversible work and external actions that are easy to undo, such as local runs, new tests, and ticket updates.
- **Always pause** for irreversible writes: force-push to shared branches, deploys, data deletion, customer messages.

"Going to bed" or "run until done" means keep going. No is an acceptable answer: give your real judgment, not agreement.

## Subagents

Roles for the Agent tool's `model`:

- **code**: `opus`. Delegated implementation, explorers, investigators.
- **judgment**: `opus`. The hardest changes, synthesis, prose, review.
- **scan**: `haiku`. Cheap bulk reads and transcript slicing.

Raise a role one step for the subtlest work. For a second opinion, run the same prompt on a different model; agreement is high signal. Run subagents in the background. Give each writer its own worktree (`isolation: "worktree"`). Fresh subagent per round, with the brief, every later directive, and the prior report. You own every subagent's output: review the diff and write your own summary.

## Writing the reply

- Short declarative sentences. Every section the playbook's reply names stays.
- Frame impact for the consumer and the maintainer before any implementation detail.
- Every claim carries its evidence or a label in the same sentence: measured, inferred, or guess. Never hand the human a check you could run.
- Never fabricate a link, citation, or transcript reference.
