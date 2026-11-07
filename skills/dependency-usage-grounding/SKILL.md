---
name: dependency-usage-grounding
description: Ground how you use a dependency in authoritative sources before reverse-engineering its intended usage from installed package source. Use when you need to know how to use a library, framework, or API and are tempted to read node_modules / site-packages / vendored source / a .d.ts to work it out; when picking the idiomatic pattern for an external dependency; or when another skill needs the where-to-look-first reflex.
---

# Dependency Usage Grounding

Installed source shows what's **possible**; docs, skills, and MCPs show what's **intended**. When you need to know how to *use* a dependency, someone has already written down the intended way — your job is to find it, not re-derive it. **Reverse-engineering** usage from `node_modules` / `site-packages` / `vendor/` / the module cache / a `.d.ts` is the last resort, not the first move: it's slow, it lands on non-idiomatic patterns, and it misses the recommended approach the docs state outright.

## The fact/intent test

Before you open any source, route the question with one check: **"Could my answer be wrong even if it matched the installed source exactly?"**

- **No → it's a *fact*.** Signature, exported types, accepted config keys, default value, installed version. The source *is* the spec — read it directly; nothing is more authoritative. `Read` / `Grep` over the installed source or `.d.ts` is the right tool, and reaching for it here is correct, not a smell.
- **Yes → it's *intent*.** Which option to pick, the idiomatic setup, how the pieces compose, the recommended pattern. You could match the source perfectly and still be using the library wrong. Ground via the ladder first.

Fuzzy questions decompose — route each half. "What options does this config take?" splits into *what keys exist* (fact → read the types) and *which key fits my goal* (intent → ground). Enumerate from source; choose from docs.

## The grounding ladder

For an *intent* question, walk these in order and stop at the first that answers — don't jump to the bottom:

1. **The project's own docs and existing usages** — README, `CLAUDE.md`, ADRs, and how *this* codebase already calls the dependency. Cheapest, most context-specific, and matches local convention.
2. **Installed skills** — a skill that already encodes the library's usage (e.g. a framework's own skill). Check before the web.
3. **A docs/library MCP** — a context7-style or vendor docs MCP, if one is available. Precise and cheap.
4. **Official docs on the web** — `WebSearch` / `WebFetch` to the authoritative documentation site. The general fallback.

If a rung isn't available — no MCP, no matching skill — fall through to the next; don't stall hunting for a tool that isn't installed. Only when *every* rung comes up silent do you reverse-engineer from the installed source — and say so when you do.

## The circuit-breaker

Even a fact lookup can drift into inferring intent. The trip signal: **you're inferring how the pieces are meant to fit, not confirming a single fact.** The tells — you've opened a third file to "see how it's wired," you're reconstructing a call sequence from implementation, or you're guessing default behavior from the body of a function. When you catch yourself, stop and escalate to the ladder. Source you've already read is sunk cost, not a reason to keep digging.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "The source is right here — faster to just read it." | For a *fact*, yes. For *intent*, you'll spend five reads inferring what the quickstart shows in one fetch, and still miss the idiom. |
| "The installed source is the real truth; docs lie." | True for version-exact *behavior* — a fact. Not for *intended usage*: the source can't tell you which of three valid paths is recommended. |
| "Searching wastes tokens." | Reverse-engineering wastes more, and ships a non-idiomatic pattern the user maintains forever. |
| "There probably aren't docs for this." | Then that's the answer — walk the ladder first. If every rung is silent, reverse-engineering is justified, and you say so. |

## Red flags

- Opening `node_modules` / `site-packages` / `vendor/` / a `.d.ts` to answer "how do I *use* this" before checking the ladder.
- Reconstructing intended usage or a call sequence by reading dependency implementation.
- Continuing to dig through source because you've already read some of it.
- Treating a signature you reverse-engineered as evidence of the *recommended* pattern — it shows the surface, not the intent.

This skill stops at *where to look*.

Completion criterion: every "how do I use this" question was routed by the fact/intent test — facts confirmed straight from source, intent grounded through the ladder before any spelunking — and reverse-engineering from installed source happened only after every ladder rung came up silent.
