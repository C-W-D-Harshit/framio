import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as Option from "effect/Option";
import { HttpApiClient } from "effect/http-api";
import { Api } from "../contracts/api";
import { ServerLauncher } from "../services/server-launcher";
import { requireProject } from "./shared";
import { projectPaths } from "../lib/paths";
import { InvalidInput } from "../domain/errors";
export const inspect = Effect.fn("inspect")(function* (options: {
  frame: string;
  layer: Option.Option<string>;
  width: Option.Option<number>;
}) {
  const p = projectPaths(yield* requireProject);
  const { info } = yield* (yield* ServerLauncher).ensure(p, true);
  const client = yield* HttpApiClient.make(Api, { baseUrl: info.url });
  const response = yield* client.project.inspect({
    payload: {
      frame: options.frame,
      width: Option.getOrUndefined(options.width),
      layer: Option.getOrUndefined(options.layer),
    },
  });
  if (response.error)
    return yield* new InvalidInput({ message: response.error });
  yield* Console.log(JSON.stringify(response.report, null, 2));
});
