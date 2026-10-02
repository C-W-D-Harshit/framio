import * as Effect from "effect/Effect";
import { ServerStartupFailed } from "../domain/errors";

/** The OS owns the browser launcher after spawning. It must outlive CLI scopes. */
export const launchBrowser = (command: string[]) =>
  Effect.try({
    try: () => {
      Bun.spawn(command, {
        windowsHide: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }).unref();
    },
    catch: (cause) => new ServerStartupFailed({ message: String(cause) }),
  });
