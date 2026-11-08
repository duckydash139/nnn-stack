// Copy to tools/journey-spec/law.ts. It imports no test runner, because laws.ts and flow files are
// read from more than one runner.

export type Law = {
  readonly kind: "always" | "never" | "eventually" | "reachable";
  readonly over: string;
  readonly says: string;
  readonly breakWith?: ReadonlyArray<string>;
  readonly knownBroken?: { readonly bug: string; readonly fix: string };
};

export type Flow = {
  readonly title: string;
  readonly summary: string;
  readonly chart: string;
  readonly terms?: Readonly<Record<string, string>>;
  readonly code?: ReadonlyArray<string>;
  readonly decisions?: ReadonlyArray<string>;
};

export const law = (spec: Law): Law => spec;

export const flow = (spec: Flow): Flow => spec;
