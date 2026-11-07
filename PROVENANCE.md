# Provenance

pstack is MIT. Its license ships as `LICENSE-pstack`.

## pstack (Lauren Tan)

Source: version 0.15.36 (`plugin.json`).

Copied, then adapted for Claude Code:

- All 24 `principle-*` skills, unchanged.
- `create-verification-skill`, `maintain-verification-skill`: output goes to `.claude/skills/verify-<app>/`, not `.cursor/skills/`.
- `create-formal-verification-skill`, `maintain-formal-verification-skill`, `statechart`: unchanged.
- `architect`, `interrogate`: the `arena` dependency is replaced with an inline fan-out of Claude Code subagents.
- `how`, `why`: model slugs and Cursor paths are retargeted to `nnn-mode` roles.
- `correct`, `in-your-own-words`, `blast-radius`, `benchmark-checklist`: unchanged.
- `unslop` is not taken from pstack. This repo has its own `unslop` (see New here). pstack's `skills/unslop` is a watched file.
- Fourteen `poteto-mode` playbooks are now in `skills/nnn-mode/playbooks/`. `tdd`, `deslop`, `no-comments`, `arena`, `swarm`, and model-slug references are removed. Bug fix adds a test only when the bug exposes a real gap in behavior coverage.

Left out: `poteto-mode` (replaced by `nnn-mode`), `tdd`, `no-comments`, `arena`, `swarm`, `setup-pstack`, `poteto-help`, `make-bot-ui`, `ketchup-video`, `automate-me`, `reflect`, `show-me-your-work`, `figure-it-out`, `technical-writing`, `recall`, `teach`, `sharpen`, `ketchup`, `bro`, `typescript-best-practices`, the `babysit`, `shipping`, `orchestrate`, `autopilot-*`, `multi-phase-plan`, `eval`, `visual-parity`, and `worktree-cleanup` playbooks, and the benny automations.

## New here

- `skills/nnn-mode/SKILL.md`: the router.
- `skills/auto-research/`, `skills/dependency-usage-grounding/`, `skills/scrutinize/`, `skills/unslop/`: new skills.
- `skills/prove-behavior/`: risk tiers, time budgets, bad journeys, laws, and audits.
- `.claude-plugin/`.
