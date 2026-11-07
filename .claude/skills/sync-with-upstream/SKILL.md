---
name: sync-with-upstream
description: Check pstack for changes, decide what each one means for this repo's skills, merge what fits, and report. Use for /sync-with-upstream, "what's new upstream", "update from pstack", or a periodic sync.
---

# Sync with upstream

This repo copies and edits skills from pstack. `sync/upstreams.json` pins each one to a commit, maps upstream paths to local ones, lists rewrites applied before merging, lists skills we chose to ignore, and lists watched files that we adapt by hand. `scripts/sync.mjs` does the mechanics. Your job is the judgment: what changed, whether it matters here, and what to do about it.

The goal is to keep the local version without losing upstream improvements. Local edits are deliberate. Never overwrite one to make a merge clean.

## 1. See what's new

```sh
npm run sync          # status: read-only
```

For each upstream it prints the commits since the pin and sorts the changed files into these groups:

| Group | Meaning | What you do |
| --- | --- | --- |
| `update`, `add`, `delete` | Upstream changed a file we never edited | Apply takes it as-is. Still read the diff (step 2) |
| `merge` | Both sides changed the file | Apply runs a three-way merge. Review the result |
| `conflict-*` | The merge failed or needs a call | Resolve by hand (step 4) |
| `skip-deleted-here` | Upstream changed a file we deleted | Usually ignore. Read it if the change is big |
| new upstream skills | Not in `map` or `ignore.skills` | Decide whether to adopt it (step 3) |
| ignored skills that changed | A skill we left out moved | Check whether it became worth taking |
| watched files | The upstream router and skills we replaced | Port the ideas into `nnn-mode` by hand |

If pstack is up to date, say so and stop.

## 2. Read the changes that matter

Read the diff for each `merge`, `conflict-*`, and watched file, plus any `update` to a skill `nnn-mode` routes to:

```sh
node scripts/sync.mjs diff pstack skills/how
```

For each change, answer three questions:

1. **What changed?** A new rule, a renamed skill, a new step, a fix, or just wording?
2. **Does it touch something we changed on purpose?** Check `PROVENANCE.md` for the local edits: no `arena`, `swarm`, `tdd`, or `no-comments`; Claude Code models and paths; tests only for real coverage gaps, not failing-test-first. An upstream change that brings back an excluded skill is not taken. Keep the improvement and drop the dependency.
3. **Does it ripple?** If upstream renamed or removed a skill, a principle, or a playbook step, find the local skills that name it (`grep -rn <name> skills/`). Pay special attention to `skills/nnn-mode/SKILL.md`, which indexes everything.

## 3. Decide about new and ignored skills

For each new upstream skill, or ignored skill that changed, read its SKILL.md and decide:

- **Adopt.** It strengthens principles or verification, and works without Cursor-only features. Add it to `map` in `sync/upstreams.json`, run apply, adapt it like the others, and add it to the `nnn-mode` index.
- **Ignore.** Add it to `ignore.skills` so it stops showing up, and give the reason in your report.
- **Ask.** When you can't tell whether the owner wants it, recommend one and ask.

## 4. Apply and resolve

```sh
npm run sync:apply    # or: node scripts/sync.mjs apply --only pstack
```

Apply writes the files and moves each pin to the new commit. Conflicts leave `<<<<<<< ours` / `>>>>>>> upstream` markers. Resolve each one by keeping the local intent and taking the upstream improvement. For example, if upstream reworded a passage we rewrote to drop `arena`, carry the new wording into our version, still without `arena`.

For watched files, port what matters by hand. A new principle or playbook trigger in `poteto-mode` goes into the `nnn-mode` index or triggers if it fits.

If a rewrite would have prevented a conflict (a rename we always make), add it to the upstream's `rewrites` so the next sync does it automatically.

## 5. Prove it

```sh
npm run check
```

It must pass. It catches conflict markers, links to missing skills, references to replaced pstack config, Cursor paths and models, broken links, and frontmatter errors. When it fails because of something new, fix the skill. If the same kind of fix keeps coming back, add a rule to `scripts/check.mjs` (the **encode-lessons-in-structure** principle skill).

Update `PROVENANCE.md` when the set of copied, adapted, or excluded skills changes.

## Report

- The old and new pin for each upstream, and the number of commits.
- What you took as-is, what merged cleanly, and what you resolved by hand, with how you resolved each conflict.
- Each new or ignored skill and the decision made, with a reason.
- What you ported by hand from watched files, and what you chose not to port.
- The `npm run check` result.
- Anything left for the owner to decide.
