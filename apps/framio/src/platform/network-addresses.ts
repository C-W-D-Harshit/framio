import { networkInterfaces } from "node:os";
import * as Effect from "effect/Effect";
import type { NetworkAddress } from "../domain/server-addresses";

export const networkAddresses = Effect.try(() => {
  const addresses: NetworkAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? [])
      addresses.push({
        name,
        address: entry.address,
        internal: entry.internal,
      });
  }
  return addresses;
}).pipe(Effect.catch(() => Effect.succeed([])));

export function canOpenBrowser(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY || env.CI)
    return false;
  return platform !== "linux" || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}
