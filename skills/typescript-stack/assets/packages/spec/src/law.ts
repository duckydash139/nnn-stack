export interface Law {
  readonly kind: "always" | "never" | "eventually" | "reachable";
  readonly over: string;
  readonly says: string;
  readonly breakWith?: readonly string[];
  readonly knownBroken?: { readonly bug: string; readonly fix: string };
}

export interface Flow {
  readonly title: string;
  readonly summary: string;
  readonly chart: string;
  readonly terms?: Readonly<Record<string, string>>;
  readonly code?: readonly string[];
  readonly decisions?: readonly string[];
}

export const law = (spec: Law): Law => spec;

export const flow = (spec: Flow): Flow => spec;
