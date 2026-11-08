---
name: writing-expectations
description: Interviews a human to turn a product idea or change request into a roadmap and small briefs of EARS expectation lines, ready to hand to an nnn-mode build session. Use when someone wants to plan features, write requirements or acceptance criteria, turn an idea into EARS lines, or prepare a brief before a build session, for a new product or an existing repository. Stays on what the product does and never designs or writes code.
disable-model-invocation: true
---

# Writing expectations

Help the human say what the product must do, precisely enough that a builder with no memory can test every line. The output is a roadmap and one small brief per step of it. The builder files the lines word for word, and nobody reviews its code. A vague line becomes a guess, and an untestable line can't be locked.

You propose wording, and the human decides it. Every line in the brief is one the human approved. You never design, pick tools, or write code. The builder owns those.

Load the `unslop` skill before you write anything the human reads: questions, stories, research findings, the review page's `context` and `decisions`, and your replies. Don't run it over EARS lines, glossary entries, or quoted text. Those keep their fixed shape and the words the human approved.

## Workflow

Copy this checklist into your reply and tick it off as you go:

```
- [ ] 1. Context read (existing repository, roadmap, draft brief, or none)
- [ ] 2. Scope: roadmap approved, and this brief's milestone chosen
- [ ] 3. Interview done for this brief's goals
- [ ] 4. Lines drafted and checked
- [ ] 5. Reconciled with existing expectations
- [ ] 6. Human approved the whole brief
- [ ] 7. Brief written, check-brief passes
```

Big projects don't fit one session or one brief. Plan the whole product loosely in a roadmap, then detail one milestone at a time. Save the roadmap and the draft brief after every round, so a new session can pick up where this one stopped.

## 1. Context

When the work is for an existing repository, and you can read it:

- Find where the repository keeps its expectations, glossary, and roadmap, and read them all, including any lines the builder derived. They may be spec files, acceptance criteria, journeys, or laws.
- Note the features, their ID prefixes if they have them, and how they use each other. In a repository that keeps journey tests, every test title that starts with an ID, such as `TODO-7: WHEN ...`, is a filed line, and the prefixes are in `prefixes` in `journeys/spec.json`. Test bodies are the builder's design, not lines. If test titles carry IDs but that list is missing, ask the human to add the prefixes to `journeys/spec.json`, or to approve an nnn-mode session adding them, before you reconcile.
- Read `docs/plans/carry-over.md` when it exists. It holds the builder's notes for the next milestone, and some may be human decisions. Keep them out of the brief, because the builder applies them, but don't ask again what they settle.
- Record `git rev-parse --short HEAD` for the brief header.

Otherwise it is a new product, and the header says `none`. When a draft brief or roadmap from an earlier session exists, read it and continue from its open questions. Never ask again what it already answers. When the human mentions an existing product but you can't read its repository, ask for access or for its expectation files. Don't guess the existing lines. When the repository has product code but no expectation files, write the brief as for a new product, with `Reconciled with: none`. Tell the human the builder adopts the repository first, and then checks the brief against what the product does today.

## 2. Scope

Ask in rounds. Each round covers one topic and asks at most three questions, so the human's attention lasts. When the human says up front to decide small things yourself, treat it as "whatever's sensible" for every edge except money, limited things, and access. Show each choice you made as a `glance` item on the review page, so it's seen at approval. Ask the questions that settle the most first. Put each one as a concrete story with named people and specific details, with two or three outcomes to pick from. A story gets a real answer where an abstract rule gets a "yes". Offer a proposed answer when you have a reason for it.

For a new product, or a change with more than one goal, write the roadmap before any EARS line:

1. **Actors.** Who uses the product, and through which app: web, admin, mobile, or an API client.
2. **Goals.** What each actor is trying to get done, one line each. One goal is one outcome, such as "share a list with the team", not a screen. Don't walk edges yet.
3. **Milestones.** Propose an order, and let the human change it:
   - M1 is the smallest release in which the main actor reaches their main goal end to end.
   - M1 also holds the foundation any later goal needs: sign-in, accounts, and who owns which data. Those are the costly choices to change later.
   - Each later milestone adds one outcome the human can check.
   - Everything else goes under Later.

Save it where the human asks, or as `docs/roadmap.md` in the product repository, in this format, and run the checker on it:

```md
# Roadmap: Family dinners

## Actors
- Parent: plans the week and locks it, on a phone browser.
- Teenager: suggests and votes, on a phone browser.

## Milestones

### M1: Plan one week together
Status: current
Outcome: The family agrees on seven dinners for next week in the app.
- Goal: sign in with an emailed link.
- Goal: suggest a dinner for a day, and vote.
- Goal: a parent locks the week.

### M2: Shopping list
Status: planned
Outcome: A locked week produces a shopping list.
- Goal: see every ingredient for the week in one list.

## Later
- A native phone app.
```

Goals are plain sentences, not EARS. Show the roadmap, or a change to it, in your reply, and ask for approval there. It can share a round with the first questions. Only the builder changes `Status:` after handover. When a repository already has a roadmap, fit the request into its current or next milestone. When it doesn't fit, propose a roadmap change and write the updated roadmap next to the brief.

A small change to an existing product needs no roadmap. Its brief says `Milestone: none`.

When the human wants a number pushed as far as it will go, such as build time or page weight, it isn't a line. Tell them to hand it to the builder as a goal. A threshold users rely on, such as "search answers within 300 ms", is a line.

## 3. Interview

Detail only the current milestone. Later milestones stay one-line goals until their turn, because building the earlier ones will change what the human wants. For each goal in this brief:

1. **Research.** When the goal is something many products do, such as recurring events, billing, invitations, or import, look up how 3 to 5 of them handle it, including the market leader, and which standards apply. Use a subagent when the host has one. Bring the findings into the rounds as proposed answers with sources: "Google Calendar and Outlook both ask whether an edit applies to this occurrence, the following ones, or all. I recommend the same." Note the words they use for the things in this goal too, for Glossary. Only approved lines go into the brief, never the research itself.
2. **Journey.** Write the main path as a journey: who, where they start, what they want, and each ordered step with what they do and see. Keep this order, because the lines come from it. Name the flow it belongs to, and its criticality: `critical` when the product is broken without it, `important` when it's a real loss with a workaround, `other` for the rest. A goal with one step needs no journey.
3. **States.** Pick each glossary noun from the journey that changes over time: it gets created, changes, or ends. Find its states in the human's own words: verbs like "lock", "cancel", "approve", and words like "until", "after", "once", "still". Add the endings people forget: cancelled, expired, failed, undone. Keep only states a person can see, or that change what they can do. Screen states such as loading belong to Edges. In an existing repository, also sweep the code for status fields, flags, and dates like `cancelledAt` on that noun, and cite file and line. Never ask the human to list states. Each mix of states nobody decided, such as a lesson request still waiting when its hour has passed, becomes a story question in the rounds. The states feed the review page's `chart`.
4. **Edges.** Walk this list along the journey's steps. Each answer becomes a bad case on its step or a line under it, and every journey needs at least one bad case:
   - Invalid input and errors
   - Permissions: who may, and who may not
   - Empty states: nothing there yet
   - Limits: counts, sizes, lengths, rates, and durations
   - Waiting and failure: slow responses, offline, a dependency that is down
   - Concurrency: two actors at once, a repeated submit, a second device, a stale tab
   - Changing context: signing in partway through
   - Reversal: a final state undone, or arriving late after something took its place
   - Data lifetime: edit, delete, undo, retention
5. **Limited things.** Name what this goal can run out of or double, such as seats, stock, credits, or sent messages. Write one line for each, with no trigger: `THE SYSTEM SHALL NOT send more than one reminder for a todo's due date.` Many goals have none, so skip this step, Doors, Door table, and Group the questions for those.
6. **Doors.** For each limited thing, list everything that can change it: every action, scheduled job, message from an outside system, and other feature, not only the main path. In an existing repository, sweep the code for everything that writes the limited thing, and cite file and line, because the human can't list doors they've forgotten. Check for half-built or reverted attempts at the same rule too, since why they died is usually the trap. Use the sweep only to list doors. Each door then gets a decided outcome: it keeps the rule, or it has an exception the human approved, written as its own line. Whether the code does that today is the job of the **prove-behavior** skill, so don't check it. If you happen to see the code break an approved line, don't ask the human about it or turn it into a line. Record it as a `Suspected bug:` note. Ask only when it shows that nobody has decided the behavior.
7. **Door table.** For each limited thing, write one rule and a table. Rows are its doors. Columns are the limited thing's states from States, including while something else has reserved it. Fill each cell from an approved line, citing its ID if it has one. Read a line as covering only what it literally names: its trigger, its state, and its actor. How the code behaves today doesn't answer a cell. A cell with no answer is a question. Note whether no line covers it, only the code decides it, or two lines disagree. A row or column whose cells all match is one question, not many.
8. **Group the questions.** Merge open cells that one answer would settle, and name the decision they share, such as "does a snoozed todo get a second reminder?". Order the groups so those settling the most cells come first. They go to the human in Review, not in chat rounds. When an answer settles other cells, fill them in and drop those questions.
9. **Glossary.** A one-sentence definition for every domain noun the lines use. Choose them with care for the main nouns and their states. When the field or the products from Research use a standard word for the same thing, such as "expired" where the human says "drops", propose it with the reason, as a `glance` item in Review. When no standard word exists, or the human's word is already precise, keep the human's word.

Skip a topic when the human says it doesn't apply. Always ask about edges that touch money, limited things, or access, with a proposed answer, because people often can't tell they'd care until it happens. There, "whatever's sensible" accepts your proposal. Ask about other edges only when the human is likely to care how they turn out. When they answer "whatever's sensible" to one of those, drop it. The builder writes derived expectations for those cases itself.

For a change to an existing product, start at the goal of the change, and walk the edges only for what changes. Walk the doors of every limited thing the change touches.

## 4. Draft and check

Write each behavior as one EARS line on one physical line:

| Pattern | Shape |
|---|---|
| Ubiquitous | THE SYSTEM SHALL `<response>` |
| Event | WHEN `<trigger>`, THE SYSTEM SHALL `<response>` |
| State | WHILE `<state>`, THE SYSTEM SHALL `<response>` |
| Unwanted | IF `<condition>`, THEN THE SYSTEM SHALL `<response>` |
| Optional | WHERE `<feature or data is present>`, THE SYSTEM SHALL `<response>` |
| Complex | WHILE `<state>`, WHEN `<trigger>`, THE SYSTEM SHALL `<response>` |

`SHALL NOT` is allowed. `THE SYSTEM` may name the product, but keep `THE` first, as in `THE CHORE BOARD SHALL`, or the checker refuses the line. Keep the human's words where they are precise.

Check every line. When one fails, propose a rewrite in the next round.

| Check | Fails when | Fix |
|---|---|---|
| EARS shape | No pattern fits | Rewrite it into a pattern |
| Observable | A user or API client could not see the result | Name what the actor sees: "show", "list", "say", "send", "return" |
| Measurable | fast, relevant, friendly, secure, easy, or similar, with no number or rule | Propose a number or a rule: "within 300 ms for up to 10,000 todos" |
| Behavior, not design | It names a tool, library, database, table, or pattern | Ask what behavior the choice guarantees. Keep the choice under Not expectations |
| One behavior | Two responses that could fail separately | Split it into two lines |
| Consistent terms | The same thing has two names, or a name differs from the glossary | Pick one word and use it everywhere |
| One meaning | One word names two things that can change apart, such as "booking" for both a request and a confirmed lesson | Split it into two glossary terms, and use each in its own lines |
| One door | A line protects data but names only a button, a screen, or a signed-in state | Split it into a rule on the outcome and the button's message |
| No conflict | Two lines give incompatible responses to the same trigger or state, or both can fire and leave an invalid stored result | Ask which one holds |
| Not covered | An existing line already says it | Drop it and tell the human the existing ID |

Tool, stack, layout, and style preferences go under Not expectations. The builder reads them when it picks the stack and designs the interface. When a preference hides a behavior, such as "use Redis" for speed, the behavior becomes a line with a number, and the preference stays a note.

## 5. Reconcile

With an existing repository, compare each drafted line with the existing human and derived lines. Then sweep every filed line the change touches, not only the drafted ones, because a new rule can break a line the human never named. A merge that replaces a refusal, for example, also changes the lines about adding and about a full list.

- **Same behavior.** Drop it and name the existing ID.
- **Contradicts or changes an existing line.** Ask the human. When the new wording wins, write it as `Replace <ID>`. When it doesn't, drop it. A change the human asked for still goes on the review page, as a `glance` item that proposes the replacement. When a line loses only part of what it says, replace it with the shorter text. When a replacement depends on another open decision, put its text in that decision's option instead of a second item.
- **Changes a filed journey's steps.** Write the journey again under its filed name, with the new steps, and add a Not expectations note saying it replaces the filed one.
- **Leaves a mix of states nobody decided.** Using the states from the interview, check whether the new lines and the filed lines together let a thing reach a mix no line decides, such as an order paid and then cancelled with no line about the refund. Ask the human with a story.
- **Two existing lines this change touches disagree.** Ask the human which holds, even when no new line is involved. Compare them against each other, and with what the person is told on each screen.
- **The human wants a behavior gone.** Write `Withdraw <ID>` with the reason in the human's words.
- **Contradicts a derived line.** Ask the human, and quote the line. If the new line wins, keep it. Derived lines are the builder's, so it changes that one, and neither `Replace` nor `Withdraw` applies.

Leave new lines without IDs. The builder assigns them. Group new lines under the feature whose data or screen the response changes. A rule that spans features goes under the feature that owns the limited thing. Use an existing feature's name and ID prefix. For a new feature, suggest a kebab-case name and a prefix of 2 to 6 capital letters that no feature uses.

## 6. Review

A wall of lines wears the human down until they accept everything, and lines hide what's missing between them, so review on a page with the `expectations-viewer` skill. Start its server with `--open`, so the page opens by itself in the human's browser. Write `draft.json` in a folder such as `expectations-m2/`, next to the brief:

- `context`: what the product is, how it works today, what changes, and what's left out, for a human who hasn't read this conversation.
- `chart`: a Mermaid `stateDiagram-v2` of the states and doors from the interview. It charts behavior, so it isn't a design of the system.
- `journeys`: each journey, with its lines and bad cases on the steps they belong to. The viewer draws its diagram.
- `rules`: each door table. An open cell points to its decision.
- `decisions`: each grouped question, as a story with named people that says why it's open, and each `Replace` or `Withdraw`. Use tier `decide` when the answer changes money, a limited thing, or access, and you have no sourced reason to propose one option. Use `glance`, with a proposal, for the rest. A long list of `decide` items means the grouping isn't finished. When an option would add or change a brief line, its text quotes that line exactly.
- `lowStakes`: every other brief line and glossary entry. A line that exists only if a decision goes one way sits in that decision's option, not here.

Quote every brief line exactly, so the human approves the words that get filed. A pick then needs no second approval, because the human already saw the words it files. When the human says "done" without approving, read `answers.json`, apply the picks and notes, refresh the draft, and ask again. When a note asks for wording the draft doesn't hold, write it into the draft and ask again too. The brief is approved when the viewer's `scripts/check-approval.mjs <draft-dir>` passes. From then on, leave `draft.json` alone, because any edit makes the approval stale.

If nothing in the brief has states to chart, or the viewer isn't installed or can't run, review in your reply instead. Show the decisions first, then any chart and door tables, then the whole brief as it will be written, and ask the human to approve it or change it.

## 7. Write the brief

Save it where the human asks, or as `docs/brief-<milestone>.md` in the product repository, such as `docs/brief-m1.md`. Use exactly this format. A section with nothing in it says `None.`

```md
# Brief: Due dates

Reconciled with: a1b2c3d
Milestone: M2

## Glossary
- Due date: The calendar day a todo should be done by, in the team's time zone.

## New

### todos (TODO)
- WHERE a todo has a due date, THE SYSTEM SHALL show the date next to its title.
- WHEN the due date of an active todo has passed, THE SYSTEM SHALL mark the todo as overdue.

### reminders (REM)
- WHEN a todo is due tomorrow, THE SYSTEM SHALL email its creator at 09:00 in the team's time zone.
- THE SYSTEM SHALL NOT send more than one reminder for a todo's due date.

## Changes
- Replace TODO-5: WHILE the done list has more than 100 todos, THE SYSTEM SHALL show only the 100 most recently completed.
- Withdraw TODO-6: The team now works from one device, so shared loading no longer matters.

## Journeys

### Get reminded of a due todo
Flow: reminders
Criticality: important
Persona: A team member who set a due date on their todo
Context: Signed in, one active todo due tomorrow
Intent: Hear about the todo before it's late
Steps:
1. Set tomorrow as the todo's due date
2. Open the reminder email the next morning
Lines:
- WHEN a todo is due tomorrow, THE SYSTEM SHALL email its creator at 09:00 in the team's time zone.
- THE SYSTEM SHALL NOT send more than one reminder for a todo's due date.

## Not expectations
- The human prefers Postgres. Input for the builder's stack choice.
- Every path: THE SYSTEM SHALL NOT send more than one reminder for a todo's due date.

## Open questions
None.
```

Write each journey from the interview under Journeys, with the exact text of the lines it proves, new or existing, bad cases included. The builder turns each one into a journey test with the **prove-behavior** skill, and since the human approved it here, nobody asks again. A line that belongs to no journey stays only under New. A small change with no journey says `None.`

Add an `Every path:` note under Not expectations for each line from Limited things, and for each existing rule the doors touch, using its exact text or its ID. It tells the builder that one test isn't enough: that line needs proof across every door. Add a note such as `- Suspected bug: A retried job can email a second reminder. src/reminders/send-reminder.ts:42` for each suspected bug from the sweep. The builder never files these notes as lines.

Save the approved chart next to the brief, as `brief-m2.chart.md`: a `#` heading, then the chart in a `mermaid` code block. Keep `expectations-m2/` too, with its `draft.json` and `answers.json`. It's the record of what the human decided, and the builder doesn't need it.

A picked option that settles only a door-table cell still files a line: write the line its text quotes. When the outcome can't be tested, write it as a Not expectations note in the option's words.

Then run the checker and fix every error it prints. With `--repo`, it reads existing lines from expectation files and from journey test titles that start with an ID, such as `TODO-7: WHEN ...`:

```sh
node <this skill's folder>/scripts/check-brief.mjs docs/brief-m2.md --repo <repository root>
node <this skill's folder>/scripts/check-brief.mjs docs/roadmap.md
```

Leave out `--repo` for a new product. Then check the brief against the approval, which fails on any line or glossary entry the human never saw:

```sh
node <expectations-viewer folder>/scripts/check-approval.mjs <draft-dir> --brief docs/brief-m2.md
```

**Size.** A brief holds at most 3 features and 25 lines, counting new, replaced, and withdrawn lines. The builder turns each feature into one small plan per session. When a milestone needs more, write several briefs for it, split by feature in dependency order: `brief-m1-1.md`, `brief-m1-2.md`.

**Drafts.** After every round, save the brief with its remaining questions under `## Open questions`, including the ones that go to Review, and check it with `--draft`. The final check without `--draft` requires `None.` there. Wrap a word in backticks when it is a name rather than a vague word or a design choice, such as a product called `Fast Notes`. The checker skips text in backticks.

A small correction after trying the product needs no brief. The human tells the builder in their own words, and the builder proposes lines for approval.

Commit the roadmap, the brief, and its files on a branch. When main is guarded by a gate, land them with the gate's merge, as the repository's README says. Otherwise commit to main. Finish by telling the human how to hand over: start a new session with `/nnn-stack:nnn-mode`, then give it the roadmap, the brief, and any chart, pasted or as paths. If the brief has `Suspected bug:` notes, list them. The builder audits each one with the **prove-behavior** skill before it builds on that code. For the next milestone, come back to this skill after the builder reports the current one done.

## Never

- Write code, choose a stack, or design screens, APIs, or schemas.
- Put a line in the brief that the human has not approved.
- Give new lines IDs, or renumber existing ones.
- Edit files in the product repository other than the roadmap, the brief, its chart, and the viewer's draft folder. The builder files the lines.
