export const expectsFailure = (knownFailing: string | undefined) =>
  knownFailing !== undefined && process.env.IGNORE_KNOWN_FAILING !== "1";
