import { flattenLayers } from "../domain/layers";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpApiClient } from "effect/http-api";
import { Api } from "../contracts/api";
import { relative } from "node:path";
import { projectPaths } from "../lib/paths";
import { ServerLauncher } from "../services/server-launcher";
import { requireProject } from "./shared";
import { ScreenshotResponse } from "../contracts/requests";
import { InvalidInput } from "../domain/errors";

export const screenshot = Effect.fn("screenshot")(function* (options: {
  frames: readonly string[];
  page: Option.Option<string>;
  all: boolean;
  scale: number;
  layers: readonly string[];
}) {
  if (!options.frames.length && Option.isNone(options.page) && !options.all)
    return yield* new InvalidInput({
      message:
        "Usage: framio screenshot <frame>... [--page <page> | --all] [--scale=2]",
    });
  const p = projectPaths(yield* requireProject);
  const { info } = yield* (yield* ServerLauncher).ensure(p, true);
  const client = yield* HttpApiClient.make(Api, { baseUrl: info.url });
  const response = yield* client.project.screenshot({
    payload: {
      frames: options.frames,
      page: Option.getOrUndefined(options.page),
      scale: options.scale,
      layers: options.layers,
    },
  });
  let failed = false;
  for (const r of response.results) {
    if (r.path)
      yield* Console.log(
        `${relative(process.cwd(), r.path)}  (${r.width}×${r.height}, ${r.frame})`,
      );
    if (r.report) {
      for (const warning of r.report.warnings)
        yield* Console.error(`warning in ${r.frame}: ${warning.message}`);
      for (const node of flattenLayers(r.report.tree))
        yield* Console.log(
          `  ${node.path}  (${Math.round(node.box.width)}×${Math.round(node.box.height)})`,
        );
    }
    for (const crop of r.crops ?? [])
      yield* Console.log(
        `${relative(process.cwd(), crop.path)}  (${crop.width}×${crop.height}, ${crop.layer})`,
      );
    if (r.error) {
      failed = true;
      yield* Console.error(`error in ${r.frame}:\n${r.error}\n`);
    }
  }
  if (failed)
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
});
