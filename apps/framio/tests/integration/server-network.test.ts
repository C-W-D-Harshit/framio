import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunServices } from "@effect/platform-bun";
import { Effect, Predicate } from "effect";
import { Policies } from "../../src/domain/policies";
import { runServer } from "../../src/server/server";

test("wildcard binding skips a port occupied by a loopback server", async () => {
  let occupied: ReturnType<typeof Bun.serve> | undefined;
  for (
    let port = Policies.firstPort;
    port < Policies.firstPort + Policies.portCount;
    port++
  ) {
    try {
      occupied = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch: () => new Response("existing server"),
      });
      break;
    } catch (error) {
      if (!Predicate.hasProperty(error, "code") || error.code !== "EADDRINUSE")
        throw error;
    }
  }
  if (!occupied) throw new Error("No free port for the loopback fixture");
  const occupiedPort = occupied.port!;
  const root = mkdtempSync(join(tmpdir(), "framio-network-"));
  mkdirSync(join(root, ".framio/pages"), { recursive: true });
  writeFileSync(join(root, ".framio/theme.css"), "");
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { info } = yield* runServer(root);
          expect(info.port).toBeGreaterThan(occupiedPort);
          yield* Effect.promise(async () => {
            const health = await (await fetch(`${info.url}/api/health`)).json();
            expect(health.pid).toBe(process.pid);
            expect(health.root).toBe(root);
            expect(
              await (await fetch(`http://127.0.0.1:${occupiedPort}`)).text(),
            ).toBe("existing server");
          });
        }),
      ).pipe(Effect.provide(BunServices.layer)),
    );
    expect(await (await fetch(`http://127.0.0.1:${occupiedPort}`)).text()).toBe(
      "existing server",
    );
  } finally {
    occupied.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
