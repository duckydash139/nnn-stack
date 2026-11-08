import { expect, it } from "@effect/vitest";
import type { TestContext, Vitest } from "@effect/vitest";
import { Data, Predicate } from "effect";
import type { Scope } from "effect";

import { expectsFailure } from "#/known-failing.ts";
import type { Law } from "#/law.ts";

export interface CheckSpec {
  readonly type: "property" | "model" | "simulation" | "reachability";
  readonly proves: readonly Law[];
  readonly flow?: string;
  readonly breakWith?: readonly string[];
  readonly knownFailing?: string;
}

type EffectBody = Parameters<typeof it.effect>[1];

export class Property extends Data.TaggedClass("Property")<{
  readonly register: (title: string) => void;
}> {}

export const property = <const Arbs extends Vitest.Arbitraries>(
  arbitraries: Arbs,
  body: Vitest.TestFunction<
    unknown,
    unknown,
    Scope.Scope,
    [{ [K in keyof Arbs]: Vitest.ArbitraryValue<Arbs[K]> }, TestContext]
  >
): Property =>
  new Property({
    register: (title) => {
      it.effect.prop(title, arbitraries, body);
    },
  });

const isProperty = (body: EffectBody | Property): body is Property =>
  Predicate.isTagged(body, "Property");

export const check = (
  spec: CheckSpec,
  title: string,
  body: EffectBody | Property
) => {
  if (isProperty(body)) {
    if (spec.knownFailing !== undefined) {
      it(title, () => {
        expect.fail(
          `${title}: a property can't be marked knownFailing. Fix: prove the known bug with an Effect body, and keep the property for after the fix.`
        );
      });

      return;
    }

    body.register(title);

    return;
  }

  const register = expectsFailure(spec.knownFailing)
    ? it.effect.fails
    : it.effect;

  register(title, body);
};
