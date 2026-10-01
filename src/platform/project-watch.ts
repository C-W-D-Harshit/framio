import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { watch } from "node:fs";
import { normalize, sep } from "node:path";
import { InvalidInput } from "../domain/errors";
/** Bounded native ingress. Any dropped event upgrades the next delivered batch to a full scan. */
export function watchProject(path: string) {
  let overflow = false;
  return Stream.callback<string | undefined, InvalidInput>(queue => Effect.acquireRelease(
    Effect.try({ try: () => {
      const watcher = watch(path, { recursive: true }, (_event, name) => {
        if (!name) { overflow = true; Queue.offerUnsafe(queue, undefined); return; }
        const file = normalize(name.toString());
        if (file === ".state" || file.startsWith(`.state${sep}`) || file.startsWith(`node_modules${sep}`)) return;
        if (!Queue.offerUnsafe(queue, file)) overflow = true;
      });
      watcher.on("error", cause => Queue.failCauseUnsafe(queue, Cause.fail(new InvalidInput({ message: `Project watcher failed: ${cause.message}` }))));
      return watcher;
    }, catch: cause => new InvalidInput({ message: String(cause) }) }),
    watcher => Effect.sync(() => watcher.close()),
  ), { bufferSize: 1024, strategy: "dropping" }).pipe(Stream.map(file => {
    if (!overflow) return file;
    overflow = false;
    return undefined;
  }));
}
