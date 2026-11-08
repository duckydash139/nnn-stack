# Evals

Each scenario runs in a fresh agent session with only this skill loaded. The grader plays the human, answering only from the persona fixture, then reads the transcript and the brief and marks every `expected_behavior` and `must_not` line as pass or fail. A scenario passes when every line passes.

Setups that name a repository use the output of the `bootstrap-new-product` eval in `building-from-expectations`.

Run each scenario once without the skill before changing the skill. Keep a change only when it moves a failing line to pass without breaking another. Run on every model the skill targets.

To check the handoff end to end, give the brief from `new-product-interview` to a fresh `building-from-expectations` session. Every line should file without a question about its wording.
