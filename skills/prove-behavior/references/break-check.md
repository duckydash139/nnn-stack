# Break check

A proof that never failed proves little. Patches are optional: most breaks are planted once in the session, then repeated by a mutation run. Each patch in `breaks/` is a break a mutation tool can't make, and removes behavior a journey or law depends on, and the break check confirms that the proofs naming it fail when it's applied. It runs only the proofs each patch names, so it costs minutes per patch. It's a [deep run](../SKILL.md#deep-runs): queue it, and run it in the session only for a new or rewritten patch, or when the human asks.

## Run it

`node tools/journey-spec/journey-spec.mjs patches` prints each patch as JSON: who names it, the fix to apply first for a known bug, and each proof's file and title. Read that rather than parsing the sources again. For every patch:

1. Start from a clean checkout of the commit under test, in a scratch worktree. For a [known bug](laws.md#a-law-the-product-breaks-today), apply its fix and set `IGNORE_KNOWN_FAILING=1`.
2. Run the proofs that name the patch, unpatched, each by its file and test title. They must all pass. If one fails, report the patch as already failing and stop, because a proof that fails without the patch proves nothing.
3. Apply the patch with `git apply`, and run the same proofs.
4. Sort each result: failed on an assertion, failed on a timeout, failed on a compile or setup error, or passed. Read each test's own error message, because some runners report a timeout as a generic error.
5. Run browser, model, and simulation proofs at least three times, because one failure says little about a timing-sensitive proof. A proof that flips between runs is unstable, and that's a defect in the proof.
6. Remove the scratch worktree.

On a branch, run the same steps against the branch's own patches and proofs, so an agent sees its new and rewritten patches fail before the change lands.

## Read the result

A patch is proven when at least one of its proofs fails on an assertion, every time. A law is proven when each of its proofs fails on at least one of its patches. A journey with `breakWith` is proven when one of its tests fails.

Report every other outcome. None of them counts as proven:

| Outcome | Meaning |
|---|---|
| Unproven | The proofs still pass with the patch applied, or one of a law's proofs never fails |
| Stale | The patch no longer applies |
| Already failing | A proof fails without the patch |
| Unstable | A proof flips between runs |
| Timeout only | The proofs failed by timing out, so the reason is weak |
| No result | The run failed before the proof started |

A stale patch gets rewritten against the current code, and the rewrite needs the same sign-off as the law or journey that names it. An unproven law loses the claim on the proof that never fails, or gains a proof that can.
