# Cloud resources and deploys

Alchemy declares the cloud as an Effect program. One Stack in `apps/infra/alchemy.run.ts` includes every resource. A cartridge Layer can declare the resources it needs, so providing the Layer provisions them on the next deploy. Removing a binding should become a type error in the code that used it.

Read the installed Alchemy docs, or its `llms.txt`, for the pinned version before writing resources. Alchemy 2 is in beta, and its API moves.

## Rules

- Every cloud resource is in the Stack. No console clicks, no ad hoc CLI-created resources.
- Importing the Stack file deploys nothing. Only the deploy command applies it.
- Authenticate through Alchemy profiles, not env vars committed to the repo.
- Bindings reach code through the Layer that declared them, typed.
- Cartridges own their resources. Removing a cartridge removes its resources from the plan, and nothing else.

## Commands

Add these to the root `package.json`, pointing at `apps/infra`:

```json
"infra:plan": "pnpm --filter infra exec alchemy plan",
"infra:deploy": "pnpm --filter infra exec alchemy deploy",
"infra:destroy": "pnpm --filter infra exec alchemy destroy"
```

Check the subcommand names in the pinned Alchemy CLI.

## Deploy

1. Run the gate.
2. Run `infra:plan` and read every line. Name each resource it creates, updates, replaces, or deletes.
3. Deploy without asking only when the plan creates or updates what you intended. A replace or delete needs the owner's sign-off, and so does `infra:destroy`.
4. After the deploy, smoke-test the real URL: one happy path and one error path.
5. If the smoke test fails, roll back first, then investigate.

nnn-mode's autonomy rules still hold: a deploy is an irreversible write unless the project's `AGENTS.md` says otherwise.

## Report

The plan summary (create, update, replace, delete), who approved any replace or delete, the deploy result, and the smoke checks with what each showed.
