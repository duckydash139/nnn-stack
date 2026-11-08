---
name: expectations-viewer
description: Shows a draft of product expectations on a local page where a human reads the context, flow chart, door tables, and journeys with their bad cases, picks options on open decisions, leaves notes, and approves, then hands the answers back to the agent. Use when a human needs to review or decide on expectations and a page would be easier than the terminal, or when someone asks to open, show, or review a draft in the viewer. It isn't a gate, and it has no accounts, sharing, or line editing.
---

# Expectations viewer

The agent writes the words. The human picks, notes, and approves. Two files carry everything, so stopping the viewer loses nothing.

The server needs Node and nothing else. Don't run `npm install`.

## Loop

1. **Write the draft.** Make a folder outside this skill, such as `.expectations/` in the project, and write `draft.json` there. Write a temp file and rename it, so the page never reads half a draft. [references/draft-format.md](references/draft-format.md) has the full schema. To see the shape, copy `fixture/draft.json` out of the skill first.

2. **Start the server** as a background process:

   ```sh
   node <skill dir>/scripts/serve.mjs <draft-dir> [--port N] [--open]
   ```

   - Wait for the line `Expectations viewer at <url>` before you call it.
   - When the human approves, the server prints `Approved. Answers in <path>` and exits. The exit wakes you. If your turn ends while the human reviews, the exit can't wake you, so ask them to say "done" here instead.
   - `--open` opens the page in the human's default browser. Leave it off in a session the human can't see, such as one over SSH.
   - `--keep-running` keeps the server up after approval.
   - The default port is 4848. If it's taken, pick another.
   - The server refuses a folder inside the skill, because it writes `answers.json` beside the draft.

3. **Give the human the URL** the server prints, even if you passed `--open`. Say what you need from them: how many items to decide, and to press Approve when they finish. If they want to send answers back before they can approve, they say "done" here.

4. **Wait for the server to exit or for "done".** Don't poll the file or read answers early.

5. **Read `answers.json`,** including `notes`, the human's notes on chart states and door table rows.
   - The draft is approved only when `node <skill dir>/scripts/check-approval.mjs <draft-dir>` passes. It checks that the approval matches the current draft and answers.
   - A decision with no entry wasn't answered. For a `glance` item in an approved draft, the proposal stands.
   - If a note on an approved draft asks for a change, change the draft and ask for approval again.
   - Once you've written the brief, run the check again with `--brief <brief file>`. It fails on any brief line or glossary entry the approved draft doesn't hold word for word, because the human never saw those words.

6. **If there's more to settle,** and the draft isn't approved yet, apply the picks and both kinds of note to `draft.json`, remove settled decisions, and replace their `?` cells with outcomes. If the server exited, start it again. Otherwise the page refreshes by itself. Go back to step 3. After approval, leave `draft.json` alone, because any edit makes the approval stale.

7. **Stop the server** if it is still running once the human moves on. Keep `draft.json` and `answers.json`, because they are the record.

## HTTP API

The page uses these endpoints, and a human who can't open a browser can use them with curl. All of them live on `127.0.0.1`.

| Request | Does |
|---|---|
| `GET /api/state` | Returns `draft`, a top-level `decisions` list with each decision's `sha256`, `hash` (the draft's hash), `canApprove`, `blockers`, and `places`, the chart states and door rows that can take a note |
| `POST /api/answer` with `{"id", "pick", "note", "decisionSha256"}` | Saves one pick and note |
| `POST /api/note` with `{"target", "note"}` | Saves one note on a place listed in `places`. An empty note removes it |
| `POST /api/approve` with `{"draftSha256"}` | Approves the draft whose hash this is, then the server exits |

Send `Content-Type: application/json` with each POST.

Never write `answers.json` yourself. If the page shows a problem with the draft, read the listed paths, fix the file, and the page recovers on its own.
