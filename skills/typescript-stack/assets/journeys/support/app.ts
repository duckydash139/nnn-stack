import { QuoteRpcs } from "@<scope>/features/quote/shared/quote.contract.ts";
import { makeRpcHandler } from "@<scope>/web/server/rpc";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

const APP_ORIGIN = "http://localhost";

const servedByTheApp = Layer.effect(
  FetchHttpClient.Fetch,
  Effect.acquireRelease(Effect.sync(makeRpcHandler), (app) =>
    Effect.promise(() => app.dispose())
  ).pipe(
    Effect.map(
      (app): typeof globalThis.fetch =>
        (input, init) =>
          app.handler(new Request(input, init))
    )
  )
);

const protocol = RpcClient.layerProtocolHttp({
  url: `${APP_ORIGIN}/api/rpc`,
}).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(servedByTheApp)
);

export const openQuoteDesk = Layer.build(protocol).pipe(
  Effect.flatMap((context) =>
    RpcClient.make(QuoteRpcs).pipe(Effect.provideContext(context))
  )
);

export const runOnTheApp = <A, E>(
  command: Readonly<{ effect: Effect.Effect<A, E, RpcClient.Protocol> }>
) =>
  Layer.build(protocol).pipe(
    Effect.flatMap((context) =>
      command.effect.pipe(Effect.provideContext(context))
    )
  );
