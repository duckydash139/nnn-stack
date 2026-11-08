# Draft format

The agent writes `draft.json`. The viewer writes `answers.json` beside it. Both live in a folder outside the skill.

## draft.json

Every key below is required unless it says optional.

```json
{
  "title": "Noon Box team lunches",
  "milestone": "Milestone 2: paying for a day",
  "context": {},
  "chart": "stateDiagram-v2\n  direction TB\n  ...",
  "decisions": [],
  "rules": [],
  "journeys": [],
  "lowStakes": ["The week view starts on Monday."]
}
```

`context` opens the page, so a human who hasn't read the conversation knows what they're deciding:

```json
{
  "summary": "Noon Box lets a team book and pay for lunch one day at a time. This draft adds paying for a day.",
  "today": "A team can place an order on a free day, and the order holds that day until someone cancels it.",
  "changes": "An order now needs a payment to confirm its day, and an unpaid hold runs out.",
  "outOfScope": ["Refunds through the admin screen."]
}
```

`summary`, `today`, and `changes` are plain sentences. Write `summary` so a human who reads only it knows what the draft adds. `outOfScope` may be empty.

`chart` is Mermaid `stateDiagram-v2` text, and that must be its first line. Declare every state with a readable label, as in `state "Late payment waiting" as LatePayment`, because the chart and the decisions show the label. `direction TB` usually reads better than `LR`. On narrow screens Pele may switch to a vertical layout by itself. Four classes have colors in both modes: `breaks`, `mayBreak`, `bugPath`, and `undecided`. `class X breaks` is enough. A `classDef` for them is allowed, and the page overrides its colors. The viewer adds `undecided` to states with an open decision by itself.

A decision:

```json
{
  "id": "late-payment-after-rival",
  "tier": "decide",
  "title": "A payment lands on a day someone else already paid for",
  "story": "Ann's order is unpaid and holds Friday. Ben pays for Friday first...",
  "options": [{ "key": "A", "text": "Send Ann's money back." }, { "key": "B", "text": "Keep it as credit." }],
  "states": ["LatePayment"]
}
```

- `id` is stable across drafts. It starts with a letter and uses letters, digits, `-`, or `_`. The page uses it as an anchor and never shows it.
- `tier` is `decide` or `glance`.
- `title` names the situation, such as "A payment lands on a day someone else already paid for". It's not a question or a rule name.
- `story` is a concrete case with named people, not an abstract rule. It ends on the moment that needs a decision.
- Each option `text` is one sentence saying what the product does, in words the human uses.
- `options` has at least two entries. Each `key` is one capital letter. When picking an option would add or change a brief line, its `text` quotes that line exactly, so one approval covers the words that get filed.
- `proposed` is an option key. A `glance` item must have one, and a `decide` item must not.
- `states` lists chart state ids. It may be empty, and each id must exist in the chart. The page shows each state's label, and leaves out a state that has none.

A rule, with its door table:

```json
{
  "id": "OneOrderPerDay",
  "statement": "A team has at most one confirmed order for each delivery day.",
  "columns": ["Day free", "Held by confirmed order", "Held by unpaid order"],
  "rows": [
    {
      "door": "Late payment lands",
      "cite": "app/payments/webhook.ts:112",
      "cells": ["Order confirmed", { "decision": "late-payment-after-rival" }, "Order confirmed"]
    }
  ]
}
```

The page uses `id` as an anchor only, and `statement` is the rule's heading, so write it as a full sentence. Rows are doors and columns are states of the limited thing. A cell is an outcome string or `{ "decision": "<id>" }`, which shows as `?` and links to the decision. `cite` is optional and looks like `file:line`. Each row has one cell per column.

A journey:

```json
{
  "name": "Book a team lunch for a day",
  "who": "Ann, who orders for the Harbour Street team",
  "startsFrom": "The week view, with Friday showing as free",
  "wants": "Lunch for her team on Friday, paid and confirmed",
  "steps": [
    {
      "name": "Pay for the order",
      "lines": ["WHEN payment lands while the order still holds the day, THE SYSTEM SHALL confirm the order."],
      "failures": [{ "when": "the card is declined", "then": "the hold stays." }]
    }
  ],
  "holds": [{ "rule": "OneOrderPerDay", "text": "a team has at most one confirmed order each day." }]
}
```

`lines` are the step's EARS lines. `failures` are the step's bad cases. A step's list may be empty, but each journey needs at least one. The page draws a diagram for each journey from its steps and bad cases, so don't write one. Keep `when` and `then` short, because they label the diagram. `holds` lists what stays true throughout. `rule` is optional, and when set, `text` links to that rule. `lowStakes` is a list of strings, shown folded with a count.

If the draft is missing or invalid, the page lists each problem by its path and keeps the last good version on screen with answers and approval turned off. The last good version lives in server memory only, so a restart loses it. If only the chart fails to parse, the page shows the Pele error and the Mermaid text, and everything else keeps working.

## answers.json

The viewer writes this file through a temp file and a rename. Agents only read it.

```json
{
  "decisions": {
    "late-payment-after-rival": {
      "pick": "B",
      "note": "Tell Ann the same day.",
      "decisionSha256": "b6fd...",
      "at": "2026-11-01T02:16:43.602Z"
    }
  },
  "notes": {
    "state:LatePayment": { "note": "Could this wait a day?", "at": "2026-11-01T02:16:50.000Z" },
    "row:OneOrderPerDay:Admin edit": { "note": "Admins should see a warning.", "at": "2026-11-01T02:16:58.000Z" }
  },
  "approval": {
    "draftSha256": "9158...",
    "answersSha256": "af8f...",
    "at": "2026-11-01T02:17:10.000Z"
  }
}
```

- `pick` is an option key, or `null` when the human left only a note.
- `decisionSha256` covers the title, story, options, and proposal at the moment of the pick. If they change, the answer is flagged for re-checking until the human keeps it or picks again. Changes to `tier` or `states` don't flag it, and a note alone doesn't clear the flag.
- `notes` holds notes on a place, keyed by target. `state:<id>` is a chart state and `row:<rule id>:<door>` is a door table row. A door repeated in one rule gets `#2`, `#3` on the end. Files from before notes existed may leave the key out.
- `approval` is `null` until the human approves.
- `draftSha256` is the sha256 of the draft's canonical form: JSON with object keys sorted at every level and no whitespace.
- `answersSha256` is the same hash over every decision's pick, note, and `decisionSha256`. When `notes` has entries, it covers `{ picks, notes }`, where `notes` maps each target to its text, so a note changed after approval makes the approval stale.
- A decision with no entry was not answered. For a `glance` item in an approved draft, the proposal stands.

An approval is current only while both hashes match. Approve stays disabled until every `decide` item is answered and no answer of either tier needs re-checking. The server enforces this too, and it refuses a pick or an approval made against text that has since changed.

Answers to decisions no longer in the draft stay in the file, count for nothing, and are counted on the page. Notes on places no longer in the draft stay in the file and are counted on the page too. Notes never block approval. If `answers.json` can't be parsed, the page says so and refuses to save, so it is never overwritten.

## Security

The server refuses a draft folder inside the skill, following symlinks, so answers never land in an installed copy. It answers only for `127.0.0.1:<port>` and `localhost:<port>`, on all routes, which stops DNS rebinding. POST requests must also carry a matching `Origin`, or none, and JSON content. Draft text goes through an escaping template. Pele gets links and images turned off, and a Content Security Policy blocks inline scripts and outside requests.
