import { isIP } from "node:net";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { networkAddresses } from "../platform/network-addresses";
import { serverUrls, type TailscaleAddress } from "../domain/server-addresses";

const IP = Schema.String.check(Schema.makeFilter((value) => isIP(value) !== 0));
const DNSName = Schema.String.check(
  Schema.isPattern(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\.?$/i),
);
export const TailscaleStatus = Schema.Struct({
  BackendState: Schema.String,
  Self: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        TailscaleIPs: Schema.Array(IP),
        DNSName: Schema.optional(Schema.String),
      }),
    ),
  ),
  CurrentTailnet: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        MagicDNSEnabled: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
});

export const parseTailscale = Effect.fn("ServerAddresses.parseTailscale")(
  function* (
    text: string,
  ): Effect.fn.Return<TailscaleAddress | null, Schema.SchemaError> {
    const status = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(TailscaleStatus),
    )(text);
    if (status.BackendState !== "Running" || !status.Self) return null;
    const dns =
      status.CurrentTailnet?.MagicDNSEnabled && status.Self.DNSName
        ? yield* Schema.decodeUnknownEffect(DNSName)(status.Self.DNSName).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
        : undefined;
    return { ips: status.Self.TailscaleIPs, dnsName: dns?.replace(/\.$/, "") };
  },
);

export const readTailscale = Effect.fn("ServerAddresses.readTailscale")(
  function* () {
    let command = Bun.which("tailscale");
    if (!command && process.platform === "darwin") {
      const candidate = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
      if (yield* (yield* FileSystem.FileSystem).exists(candidate))
        command = candidate;
    }
    if (!command) return null;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make(command!, ["status", "--json"], {
            stdin: "ignore",
            stderr: "ignore",
            forceKillAfter: "100 millis",
          }),
        );
        const [text, code] = yield* Effect.all(
          [
            Stream.mkString(child.stdout.pipe(Stream.decodeText())),
            child.exitCode,
          ],
          { concurrency: 2 },
        );
        return code === 0 ? yield* parseTailscale(text) : null;
      }),
    ).pipe(
      Effect.timeout("1 second"),
      Effect.catch(() => Effect.succeed(null)),
    );
  },
  Effect.catch(() => Effect.succeed(null)),
);

export const discoverServerUrls = Effect.fn("ServerAddresses.discover")(
  function* (host: string, port: number) {
    if (host === "localhost" || host === "::1" || host.startsWith("127."))
      return serverUrls(host, port, [], null);
    const [interfaces, tailscale] = yield* Effect.all(
      [networkAddresses, readTailscale()],
      { concurrency: 2 },
    );
    return serverUrls(host, port, interfaces, tailscale);
  },
);
