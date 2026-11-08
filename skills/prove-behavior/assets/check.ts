// Copy to tools/journey-spec/check.ts. Written for Vitest. On another runner, change the lines marked RUNNER.
import { test } from "vitest"; // RUNNER

import type { Law } from "./law.ts";

export type CheckSpec = {
  readonly type: "property" | "model" | "simulation" | "reachability";
  readonly proves: ReadonlyArray<Law>;
  readonly flow?: string;
  readonly breakWith?: ReadonlyArray<string>;
  readonly knownFailing?: string;
};

// With fast-check, call fc.configureGlobal({ includeErrorInReport: true }) here, so a failed property
// reports its assertion and the break check doesn't count it as a crash.

// knownFailing uses the runner's expected-failure mode. The break check sets IGNORE_KNOWN_FAILING=1.
export function check(spec: CheckSpec, title: string, body: () => unknown): void {
  const expectFailure = spec.knownFailing !== undefined && process.env["IGNORE_KNOWN_FAILING"] !== "1";
  if (expectFailure) {
    test.fails(title, body); // RUNNER
  } else {
    test(title, body);
  }
}
