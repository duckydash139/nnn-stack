import { describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { expectsFailure } from "#/known-failing.ts";
import type { Law } from "#/law.ts";

export interface JourneySpec {
  readonly title: string;
  readonly criticality: "critical" | "important" | "other";
  readonly level: "api" | "dom" | "browser";
  readonly flow: string;
  readonly paths: readonly string[];
  readonly persona: string;
  readonly context: string;
  readonly intent: string;
  readonly breakWith?: readonly string[];
  readonly productionSafe?: boolean;
}

export interface ProofSpec {
  readonly proves: readonly Law[];
  readonly knownFailing?: string;
}

type EffectBody = Parameters<typeof it.effect>[1];

export const journey = (spec: JourneySpec, body: () => void): void => {
  describe(spec.title, body);
};

export const prove = (spec: ProofSpec, title: string, body: EffectBody) => {
  const register = expectsFailure(spec.knownFailing)
    ? it.effect.fails
    : it.effect;

  register(title, body);
};

export const step = <A, E, R>(name: string, self: Effect.Effect<A, E, R>) =>
  Effect.withSpan(self, name);
