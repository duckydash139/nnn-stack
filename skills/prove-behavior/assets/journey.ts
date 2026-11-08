// Copy to journeys/support/journey.ts, and import the project's own test object so its fixtures keep
// working. Written for Playwright. On another runner, change the lines marked RUNNER.
import { test } from "@playwright/test"; // RUNNER

import type { Law } from "../../tools/journey-spec/law.ts";

export type JourneySpec = {
  readonly title: string;
  readonly criticality: "critical" | "important" | "other";
  readonly level: "api" | "dom" | "browser";
  readonly flow: string;
  readonly paths: ReadonlyArray<string>;
  readonly persona: string;
  readonly context: string;
  readonly intent: string;
  readonly breakWith?: ReadonlyArray<string>;
  readonly productionSafe?: boolean;
};

export type ProofSpec = {
  readonly proves: ReadonlyArray<Law>;
  readonly knownFailing?: string;
};

type Body = Extract<Parameters<typeof test>[number], (...args: never[]) => unknown>; // RUNNER

export function journey(spec: JourneySpec, body: () => void): void {
  test.describe(spec.title, body); // RUNNER
}

// knownFailing uses the runner's expected-failure mode. The break check sets IGNORE_KNOWN_FAILING=1.
export function prove(spec: ProofSpec, title: string, body: Body): void {
  const expectFailure = spec.knownFailing !== undefined && process.env["IGNORE_KNOWN_FAILING"] !== "1";
  if (expectFailure) {
    test.fail(title, body); // RUNNER
  } else {
    test(title, body);
  }
}

// On a runner with no step API, such as Vitest, return Promise.resolve().then(body) instead.
export function step<T>(name: string, body: () => T | Promise<T>): Promise<T> {
  return test.step(name, async () => body()); // RUNNER
}
