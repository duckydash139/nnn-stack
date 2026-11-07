# Audit existing behavior

Find what's broken in code that already exists. The output is a Markdown report with a chart of the flow and draft proofs. Change no product code, tests, or specs until the human approves the drafts.

Budget: one pass. Walk each state against the taxonomy cases that can go wrong there, not every pair. Stop when each suspect has an outcome.

## 1. Map the states

List the states the feature can be in, as a person sees them: failed, cancelled, expired, paid, and records an earlier use can leave behind. List the sources of expected behavior: EARS lines, briefs, product docs, reported bugs, `AGENTS.md`. Check branches and worktrees for earlier work on this flow.

## 2. Walk the taxonomy

For each state, walk the taxonomy in [SKILL.md](../SKILL.md#tier-1-a-behavior-change) and the left-behind and repeat questions. Write each case that could go wrong as a suspect, and note whether it came from the expectations or the code. Start from the expectations where you can, because reading the code shapes what you look for.

## 3. Reproduce each suspect

Reproduce it in the running product with a throwaway probe. The code tells you where to look, and it can be wrong either way.

- Write one line per probe: what it must show, and what would differ if the bug were absent.
- Run one happy-path control first, with the same setup.
- Change one detail between repeats, so retry protection can't hide the result.
- Wait for the final state, not the URL or a loaded page. Check stored state as well as the screen.
- Set a short action timeout, so a stuck step fails in seconds.
- Run locally, through the public interface. Name any seeded step, such as a passed deadline, because a real person may not reach that state.
- Keep probes out of tracked files, in a throwaway worktree or the scratchpad.
- For a UI, use the framework's devtools to read state and events, not just the screen. Replay the sequence behind a bug as a throwaway test.

Give each suspect one outcome: **Reproduced**, **Ruled out** (a probe that could have shown it didn't), **Inconclusive** (the probe failed on its own setup), **Read in code only**, or **Not tested**. Ruling a suspect out takes the same care as confirming it.

## 4. Sort the findings

| Label | Next step |
| --- | --- |
| Breaks a stated expectation | Report it as a bug |
| Rule has a gap: the intent covers this path, but the wording misses it | The human decides |
| Sources disagree | The human chooses |
| The expectation itself looks wrong for the person | The human decides |
| Nothing specifies it | The human decides |

Never write your guess down as expected behavior. "It passes and I still think it's wrong" is a valid finding.

## 5. Report

Save the report and its evidence in a gitignored folder or the scratchpad. Rank findings by cost per case times how often it happens. For each one:

- What happened, and what the person sees.
- Steps to reproduce, naming any seeded step.
- Evidence: stored state, a response, or a screenshot.
- Its label and outcome, and whether it came from the expectations or the code.
- The decision the human needs to make.

Then add:
- A Mermaid `stateDiagram-v2` of the flow, with each bug marked as a `broken` state. Use the **statechart** skill when the flow needs a checked model.
- A draft bad journey, in one `WHEN … THE SYSTEM SHALL …` line, for each finding that breaks a stated expectation.
- A draft law (kind, over, says) for each rule that must hold on every path.
- What you didn't test, where the probes are, and any test data left behind.

The human picks the drafts to keep. A probe shows the path, but it isn't a proof, so don't promote one unchanged. Each approved draft becomes a tier 1 or tier 2 change.
