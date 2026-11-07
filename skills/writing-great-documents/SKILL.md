---
name: writing-great-documents
description: Write a clear document — technical or not — by clarifying intent before drafting, then writing to a proven structure. Use when the user wants to draft a README, guide, design doc, proposal, report, update, announcement, or email; when a draft rambles or buries its point; or when another skill needs the document-writing procedure.
---

# Writing Great Documents

A good document serves **one reader** doing **one job**. Name both before you write a word, put the answer first, and cut everything that job doesn't need. These rules hold whether the document is technical or not.

This skill writes prose deliverables. For a code-shaped architecture handoff use `../tech-spec/`; for a product/feature spec use `../spec-driven-development/`; If the request itself is awkwardly worded, run `../reframe-request/` first so the draft tracks intent, not phrasing.

## 1. Interview before drafting

Do not draft until you can name the **reader** and the **job**. Ask only the questions that change the document; infer the rest. The ones that always matter:

- Who is the one primary reader, and what do they already know?
- What should that reader do or believe after reading? (the job)
- What is the single most important thing — the line they must not miss? (the **BLUF**)
- Where does it live, and how long can it be?

Ask "why" until you reach the real need, not the first ask. Then paraphrase the reader and the job back in one sentence and get a yes.

Completion criterion: the primary reader and the after-reading job are both named and confirmed by the user; no drafting happened before that.

## 2. Choose one document type

Each type has a fixed shape, and blurring two into one document is the most common failure. Pick exactly one:

- **Technical** — the four **Diátaxis** modes: *tutorial* (learning by doing), *how-to* (steps to a goal), *reference* (lookup facts), *explanation* (why and background).
- **Non-technical** — *decision memo*, *proposal*, *status update*, *narrative*, or *announcement*.

Read `doc-types.md` for each type's shape and template. If the material needs two types, write two documents (or two clearly separated sections), not one blurred one.

Completion criterion: exactly one type is named, and any mode-mixing is a deliberate, stated exception.

## 3. Put the answer first

Lead with the conclusion, recommendation, or answer — then the supporting points, then the detail (**BLUF** / the **pyramid**: top-down, one idea per section). Readers scan, they don't read; the first paragraph and the section headers must carry the whole message on their own.

Completion criterion: a reader who reads only the opening paragraph and the headers still gets the point.

## 4. Draft to the five C's

**Clear, concise, cohesive, complete, correct.** Plain words, active voice, short sentences; define each term once; every claim is self-evident, supported, or cut. Match the **register** to the reader and the type — never to how the request happened to be phrased.

Completion criterion: each paragraph advances the reader's job and survives the no-op test — would the reader miss it if it were gone?

## 5. Revise by subtraction

Read it once as the reader. Cut every sentence that fails the no-op test. Then check **completeness** (can the reader finish the job from the text alone?) and **correctness** (facts, names, numbers, links). Tighten; never pad to look thorough.

Completion criterion: nothing remains that the reader's job doesn't need, and the job is achievable from the text alone.

## Deliver

Return the document inline unless the user asked for a file.
