# First-use check

Run this on the first real feature, to learn whether the human is deciding or only accepting.

## Plant one mistake

Before the human reviews, a helper agent changes one decision's proposal or one door table cell in a practice copy of `draft.json`, to something plausibly wrong. It records what it changed in a file the human doesn't open until the end. Remove the planted mistake before anything reaches the brief.

## Record

- Minutes spent, and how many decisions the human saw
- How many proposals the human changed
- Whether the human caught the planted mistake
- Whether the human felt the urge to accept everything, and at what point
- Which part felt worth it, and which part felt like work
- Decisions that the builder later had to ask about anyway

## Decide

- Accepting every proposal and missing the planted mistake means the review still fails.
- A step that found nothing new and cost attention gets cut.
- `verification` changes for journeys and door tables wait until this format settles.

## Known gaps

- `check-brief.mjs` doesn't read `draft.json`, so it can't fail on open cells, lines missing from the draft, or a brief changed after approval.
- The viewer has no field for the cells a decision covers or why a cell is open, and can't mark a uniform row or column.
