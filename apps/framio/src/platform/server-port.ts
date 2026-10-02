import * as Effect from "effect/Effect";
import { PortOccupied, ServerStartupFailed } from "../domain/errors";
import * as Predicate from "effect/Predicate";

// macOS permits wildcard and specific listeners to overlap on the same port.
export const probeServerPort = (host: string, port: number) =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.try({
        try: () =>
          Bun.listen({
            hostname: host,
            port,
            socket: {
              open: (socket) => {
                socket.end();
              },
              data() {},
            },
          }),
        catch: (cause): PortOccupied | ServerStartupFailed =>
          Predicate.hasProperty(cause, "code") && cause.code === "EADDRINUSE"
            ? new PortOccupied({ port })
            : new ServerStartupFailed({
                message: `Could not reserve ${host}:${port}: ${String(cause)}`,
              }),
      }),
      (listener) => Effect.sync(() => listener.stop(true)),
    ),
  );
