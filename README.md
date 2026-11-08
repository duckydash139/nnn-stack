# nnn-stack

A Claude Code plugin built on pstack's principles and verification skills, plus new skills of its own.

## Install

```bash
/plugin marketplace add /Users/nnn/work/nnn-stack
/plugin install nnn-stack@nnn
```

Skills are namespaced, so the router is `/nnn-stack:nnn-mode`.

## Use

Start any non-trivial task with `/nnn-stack:nnn-mode`. A feature goes through five stages. Skills marked *(you)* start only when you type them. The rest, nnn-mode loads when the work calls for them.

```
PLAN                      DESIGN             BUILD                    PROVE                       SHIP
writing-expectations ──► tldraw-ui-mock ──► nnn-mode + playbooks ──► prove-behavior ──────────► opening-a-pr
  (you)                    (screens only)     typescript-stack         gate                        unslop
  expectations-viewer                         how, architect           verify-<app>
  docs/brief-*.md                             blast-radius             deep runs (queued)
```

### 1. Plan: what it does

Skip this when the behavior is already pinned down.

- `/nnn-stack:writing-expectations` *(you)* interviews you into a roadmap and one brief per milestone. It covers actors, goals, journeys, states, bad cases, and limited things with every path that changes them. It never designs or writes code.
- `expectations-viewer` shows the draft on a local page. You pick options, leave notes, and approve.
- The output is `docs/brief-<milestone>.md`. It holds approved EARS lines, journeys, `Every path:` notes, which become laws, and `Suspected bug:` notes.

### 2. Design: what it looks like

Only for new or changed screens with no agreed design.

- `tldraw-ui-mock` draws the brief's journeys on a tldraw board: a screen per step, plus the empty, error, and rejected screens. It makes a wireframe for an early idea, static screens for visual design, or a clickable page for a settled flow.
- You mark up the board, and it applies your notes. The mock never changes what the brief says. A note that would change behavior goes back into the brief.

### 3. Build

`/nnn-stack:nnn-mode` *(you)*:

1. Restates the goal, the problem, and the smallest change (`in-your-own-words`).
2. Reads the principles index and opens each `principle-*` that bears on a decision.
3. Loads the stack. `typescript-stack` covers a TypeScript repo, unless the repo's `AGENTS.md` names its own skills or you name another template.
4. Names the data shape, the store that owns it, and its single writer before any code.
5. Copies each matching playbook into the todo list. Work shapes like feature, bug-fix, and refactoring stack with the stack's playbooks: new-repo, capability, lifecycle, store, web, and infra.

The feature playbook reads the brief and the approved board, then runs `how`, then `architect`. It plans which work can run in parallel and hands the code to subagents. Along the way it runs `dependency-usage-grounding` before using a library and `blast-radius` when a change's reach is unclear. It settles any choice a run can answer with a prototype instead of a question to you.

### 4. Prove

`prove-behavior` picks a tier:

| Tier | The change | Proof |
| --- | --- | --- |
| 0 | Copy, styles, docs, or a refactor that tests cover | The gate |
| 1 | New or changed behavior | A test per brief line, the bad journeys, a planted bug each, then the gate |
| 2 | A money, data, access, or trust rule across several paths | Tier 1, plus a law you approve, proved by a property or model test |

Then each check runs in its slot:

| Slot | What runs |
| --- | --- |
| Edit loop, after every edit | Tests for the changed code and the journeys that cover it. Plant the bug, see the test fail, restore. Regenerate the journey pages |
| Done, once on the final commit | The project's gate: build, types, lint, the journey spec check, and every test, including API and in-DOM journeys |
| Real surface, for a change users can see | The project's `verify-<app>` skill drives the running app and proves the changed journey lines by ID. `create-verification-skill` writes it, and `maintain-verification-skill` *(you)* fixes its drift |
| Higher rungs, when the risk needs them | `create-formal-verification-skill` for races, retries, and lifecycles. `statechart` draws the model when you must judge it |
| Deep run, queued, never in the session | Mutation testing on changed lines, the break check over saved patches, browser journeys, long property runs |

### 5. Ship

The `opening-a-pr` playbook passes the gate before every commit. It writes small ordered commits, Conventional Commit titles, and a short Why / What changed / Scope / Blast Radius / Verification body, all through `unslop`. It stops for your sign-off before anything irreversible, and before changes to journeys, laws, or dependencies.

### Known gaps

- Nothing runs the queued deep runs yet. They run only when someone starts them.
- Most skills only start when you type them. Under nnn-mode the agent reads them by path. Without it, only a few load on their own, such as `prove-behavior`, `typescript-stack`, `tldraw-ui-mock`, `scrutinize`, and `unslop`.

## What's inside

| Path | Contents |
| --- | --- |
| `skills/nnn-mode/` | The router and 14 playbooks |
| `skills/principle-*` | pstack's 24 principles |
| `skills/*verification*`, `statechart` | pstack's verification generators |
| `typescript-stack` | New. The TypeScript stack (pnpm, Effect, XState, Foldkit, Alchemy), its rules, gate and fence, and playbooks for a new repo, actions, lifecycles, stores, web, and infra |
| `prove-behavior` | New. What to prove and how much: risk tiers, time budgets, bad journeys, laws, audits. Ships the journey-spec generator, which checks journeys and laws and writes a page per flow |
| `how`, `why`, `architect`, `interrogate`, `correct`, `in-your-own-words`, `blast-radius`, `benchmark-checklist` | pstack skills the router calls |
| `writing-expectations`, `expectations-viewer` | New. Interview the human into a roadmap and small briefs of approved EARS lines, reviewed on a local page, before nnn-mode builds them |
| `tldraw-ui-mock` | New. Mock a feature's screens on a tldraw board from its brief, and apply the human's notes before the build |
| `scrutinize`, `dependency-usage-grounding`, `auto-research`, `unslop` | New skills |

## Keeping in sync with upstream

Run `/sync-with-upstream` in this repo. It's a project skill in `.claude/skills/` and doesn't ship with the plugin. It checks pstack, decides what each change means here, merges, and reports. Underneath it uses:

| Command | Does |
| --- | --- |
| `npm run sync` | Read-only status: new commits, files we'll update or merge, new or ignored skills that changed, watched files |
| `node scripts/sync.mjs diff pstack <path>` | pstack's diff for one path since the pin |
| `npm run sync:apply` | Three-way merge of every mapped pstack file, then moves the pin |
| `npm run check` | Repo check: conflict markers, missing skills, broken links, Cursor leftovers, plugin validation |

`sync/upstreams.json` pins pstack to a commit. The merge base is that pinned commit, so local edits survive and only real overlaps conflict.

## Credits

Built on [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan (MIT). See `PROVENANCE.md`.
