import { injectLayerSources } from "./layers/source";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as FileSystem from "effect/FileSystem";
import { join, relative } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import type { Frame } from "../domain/project";

export type BuildArtifacts = {
  frames: ReadonlyMap<
    string,
    { error: string | null; version: number; hash: number }
  >;
  files: ReadonlyMap<string, string>;
  nextVersion: number;
};
export const emptyArtifacts: BuildArtifacts = {
  frames: new Map(),
  files: new Map(),
  nextVersion: 1,
};
const entryOutput = (frame: Frame) => `${frame.page}/${frame.slug}.js`;
const formatLogs = (
  p: ProjectPaths,
  logs: readonly (BuildMessage | ResolveMessage)[],
) =>
  logs
    .map((log) => {
      const pos = log.position;
      return pos?.file
        ? `${relative(p.root, pos.file)}:${pos.line}:${pos.column}: ${log.message}${pos.lineText ? `\n    ${pos.lineText.trim()}` : ""}`
        : log.message;
    })
    .join("\n\n") || "Build failed";

export const buildFrames = Effect.fn("Frames.build")(function* (
  p: ProjectPaths,
  frames: readonly Frame[],
  previous: BuildArtifacts,
) {
  const fs = yield* FileSystem.FileSystem;
  if (!frames.length)
    return {
      artifacts: { ...emptyArtifacts, nextVersion: previous.nextVersion },
      changed: Array<string>(),
    };
  const entries = new Map<string, Frame>();
  for (const frame of frames) {
    const entry = join(p.entries, frame.page, `${frame.slug}.tsx`);
    const source = [
      'import { createElement } from "react";',
      'import { createRoot } from "react-dom/client";',
      `import * as mod from ${JSON.stringify(frame.file)};`,
      "const Frame = mod.default;",
      `if (typeof Frame !== "function") throw new Error(${JSON.stringify(`${frame.relFile} must \`export default\` a React component.`)});`,
      'createRoot(document.getElementById("root"), { onUncaughtError: (error, info) => window.__framio?.reportError(error, info.componentStack) }).render(createElement(Frame));',
    ].join("\n");
    const current = yield* fs
      .readFileString(entry)
      .pipe(
        Effect.catchReason("PlatformError", "NotFound", () =>
          Effect.succeed(""),
        ),
      );
    if (current !== source) {
      yield* fs.makeDirectory(join(p.entries, frame.page), { recursive: true });
      yield* fs.writeFileString(entry, source);
    }
    entries.set(entry, frame);
  }
  const sourceFrames = new Map(frames.map((frame) => [frame.file, frame]));
  const buildPermits = yield* Semaphore.make(4);
  const run = (entrypoints: string[], splitting: boolean) =>
    Effect.tryPromise(async () => {
      const out = await Bun.build({
        entrypoints,
        root: p.entries,
        splitting,
        target: "browser",
        format: "esm",
        naming: {
          entry: "[dir]/[name].[ext]",
          chunk: "chunks/[name]-[hash].[ext]",
        },
        define: { "process.env.NODE_ENV": JSON.stringify("development") },
        plugins: [
          {
            name: "generation-frame-sources",
            setup(build) {
              build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
                const frame = sourceFrames.get(args.path);
                if (
                  !args.path.startsWith(p.pages + "/") &&
                  !args.path.startsWith(join(p.framio, "components") + "/")
                )
                  return undefined;
                const content =
                  frame?.content ?? (await Bun.file(args.path).text());
                return {
                  contents: injectLayerSources(content, args.path),
                  loader: args.path.endsWith(".jsx") ? "jsx" : "tsx",
                };
              });
            },
          },
        ],
        throw: false,
      });
      if (!out.success)
        return { ok: false as const, error: formatLogs(p, out.logs) };
      const outputs = await Promise.all(
        out.outputs.map(async (output) => ({
          path: output.path.replace(/^\.\//, ""),
          text: await output.text(),
        })),
      );
      return { ok: true as const, outputs };
    }).pipe(
      Semaphore.withPermits(buildPermits, 1),
      Effect.catch((error) =>
        Effect.succeed({ ok: false as const, error: error.message }),
      ),
    );
  const combined = yield* run([...entries.keys()], true);
  const files = new Map<string, string>();
  const results = new Map<
    string,
    { text: string | null; error: string | null }
  >();
  if (combined.ok) {
    for (const output of combined.outputs) files.set(output.path, output.text);
    for (const frame of frames)
      results.set(frame.id, {
        text: files.get(entryOutput(frame)) ?? null,
        error: null,
      });
  } else {
    // Bisect only failing groups. Healthy groups retain shared chunks.
    const recover = (group: [string, Frame][]): Effect.Effect<void> =>
      Effect.gen(function* () {
        const result = yield* run(
          group.map(([entry]) => entry),
          group.length > 1,
        );
        if (result.ok) {
          for (const output of result.outputs)
            files.set(output.path, output.text);
          for (const [, frame] of group)
            results.set(frame.id, {
              text: files.get(entryOutput(frame)) ?? null,
              error: null,
            });
        } else if (group.length === 1) {
          results.set(group[0]![1].id, { text: null, error: result.error });
        } else {
          const middle = Math.ceil(group.length / 2);
          yield* Effect.all(
            [recover(group.slice(0, middle)), recover(group.slice(middle))],
            { concurrency: 2 },
          );
        }
      });
    const group = [...entries];
    const middle = Math.ceil(group.length / 2);
    if (group.length === 1) yield* recover(group);
    else
      yield* Effect.all(
        [recover(group.slice(0, middle)), recover(group.slice(middle))],
        { concurrency: 2 },
      );
  }
  const changed: string[] = [];
  const builds = new Map<
    string,
    { error: string | null; version: number; hash: number }
  >();
  let nextVersion = previous.nextVersion;
  for (const frame of frames) {
    const result = results.get(frame.id)!;
    const hash = Number(Bun.hash(result.error ?? result.text ?? ""));
    const old = previous.frames.get(frame.id);
    if (old && old.hash === hash && old.error === result.error)
      builds.set(frame.id, old);
    else {
      builds.set(frame.id, {
        error: result.error,
        hash,
        version: nextVersion++,
      });
      changed.push(frame.id);
    }
  }
  return {
    artifacts: { frames: builds, files, nextVersion } satisfies BuildArtifacts,
    changed,
  };
});
