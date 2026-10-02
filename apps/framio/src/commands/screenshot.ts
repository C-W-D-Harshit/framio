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
import { validateScreenshot } from "../domain/screenshot";
import { InvalidInput } from "../domain/errors";
import { TerminalUI } from "../services/terminal-ui";

export const screenshot = Effect.fn("screenshot")(function* (options: {
  frames: readonly string[];
  page: Option.Option<string>;
  all: boolean;
  scale: number;
  layers: readonly string[];
  url: Option.Option<string>;
  compare: Option.Option<string>;
  into: Option.Option<string>;
  width: Option.Option<number>;
  height: Option.Option<number>;
}) {
  const payload = yield* validateScreenshot(
    {
      frames: options.frames,
      page: Option.getOrUndefined(options.page),
      scale: options.scale,
      layers: options.layers,
      url: Option.getOrUndefined(options.url),
      compare: Option.getOrUndefined(options.compare),
      into: Option.getOrUndefined(options.into),
      width: Option.getOrUndefined(options.width),
      height: Option.getOrUndefined(options.height),
    },
    options.all,
  );
  const p = projectPaths(yield* requireProject);
  const ui = yield* TerminalUI;
  const { info } = yield* (yield* ServerLauncher).ensure(p, true);
  const client = yield* HttpApiClient.make(Api, { baseUrl: info.url });
  const response = yield* client.project.screenshot({
    payload,
  });
  let failed = false;
  for (const r of response.results) {
    if (r.path || r.crops?.length) {
      const provenance =
        r.generation !== undefined && r.revision
          ? `generation ${r.generation}, revision ${r.revision}`
          : "external capture";
      yield* Console.log(
        `Capture ${r.frame}${r.viewportWidth ? ` at ${r.viewportWidth}px` : ""}: ${provenance}`,
      );
    }
    if (r.path)
      yield* ui.interactive
        ? ui.message(
            "success",
            `${relative(process.cwd(), r.archivePath ?? r.path)}  (${r.width}×${r.height}, ${r.frame}${r.captureId ? `, capture ${r.captureId}` : ""})`,
          )
        : Console.log(
            `${relative(process.cwd(), r.archivePath ?? r.path)}  (${r.width}×${r.height}, ${r.frame}${r.captureId ? `, capture ${r.captureId}` : ""})`,
          );
    if (r.archivePath && r.path)
      yield* Console.log(`  Latest: ${relative(process.cwd(), r.path)}`);
    if (r.report) {
      for (const warning of r.report.warnings)
        yield* ui.message("warning", `in ${r.frame}: ${warning.message}`);
      for (const node of flattenLayers(r.report.tree))
        yield* Console.log(
          `  ${node.path}  (${Math.round(node.box.width)}×${Math.round(node.box.height)})`,
        );
    }
    for (const crop of r.crops ?? []) {
      yield* Console.log(
        `${relative(process.cwd(), crop.archivePath ?? crop.path)}  (${crop.width}×${crop.height}, ${crop.layer}${crop.viewportWidth ? `, viewport ${crop.viewportWidth}px` : ""}${crop.captureId ? `, capture ${crop.captureId}` : ""})`,
      );
      if (crop.archivePath)
        yield* Console.log(`  Latest: ${relative(process.cwd(), crop.path)}`);
    }
    if (r.error) {
      failed = true;
      yield* ui.message("error", `in ${r.frame}:\n${r.error}`);
    }
  }
  if (failed)
    yield* Effect.sync(() => {
      process.exitCode = 1;
    });
});
