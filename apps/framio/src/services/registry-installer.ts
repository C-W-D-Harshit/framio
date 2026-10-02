import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { PackageCommandFailed } from "../domain/errors";
import {
  RegistryObservation,
  registryReceipt,
} from "../domain/registry-install";
import {
  REGISTRY_INSTALLER_SOURCE,
  SHADCN_PACKAGE,
  SHADCN_VERSION,
} from "../platform/registry-installer";

export const installRegistryItems = Effect.fn("installRegistryItems")(
  function* (
    directory: string,
    items: readonly string[],
    overwrite: boolean,
    options: { verbose?: boolean; path: string },
  ) {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const temporary = yield* fs.makeTempDirectoryScoped({
      prefix: "framio-registry-",
    });
    const adapter = join(temporary, "install.mjs");
    const receipt = join(temporary, "receipt.json");
    yield* fs.writeFileString(adapter, REGISTRY_INSTALLER_SOURCE);
    const child = yield* spawner.spawn(
      ChildProcess.make(
        "npx",
        [
          "--yes",
          `--package=${SHADCN_PACKAGE}`,
          "--",
          "node",
          adapter,
          JSON.stringify({
            items,
            overwrite,
            receipt,
            verbose: !!options.verbose,
            version: SHADCN_VERSION,
          }),
        ],
        {
          cwd: directory,
          env: { PATH: options.path, NO_COLOR: "1" },
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "10 seconds",
        },
      ),
    );
    const [code, output] = yield* Effect.all(
      [
        child.exitCode,
        child.all.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (output, chunk) => output + chunk,
          ),
        ),
      ],
      { concurrency: 2 },
    );
    if (!(yield* fs.exists(receipt)))
      return yield* new PackageCommandFailed({
        message: `The registry installer exited ${code} without a completion receipt. No files were verified.\n${output}\nRetry with \`framio add ${items.join(" ")} --verbose\`.`,
      });
    const observation = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(RegistryObservation),
    )(yield* fs.readFileString(receipt)).pipe(
      Effect.mapError(
        (error) =>
          new PackageCommandFailed({
            message: `The registry installer returned an invalid receipt: ${error.message}\n${output}`,
          }),
      ),
    );
    const canonical = yield* fs.realPath(directory);
    const files = yield* Effect.forEach(
      observation.files,
      Effect.fnUntraced(
        function* (file) {
          const target = resolve(directory, file.path);
          const path = relative(directory, target);
          if (
            isAbsolute(path) ||
            path === ".." ||
            path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
          )
            return {
              ...file,
              issue: "Receipt destination is outside .framio.",
            };
          let after = null;
          if (yield* fs.exists(target)) {
            const actual = relative(canonical, yield* fs.realPath(target));
            if (
              isAbsolute(actual) ||
              actual === ".." ||
              actual.startsWith(
                `..${process.platform === "win32" ? "\\" : "/"}`,
              )
            )
              return {
                ...file,
                issue: "Receipt destination follows a link outside .framio.",
              };
            after = createHash("sha256")
              .update(yield* fs.readFile(target))
              .digest("hex");
          }
          return after === file.after
            ? file
            : {
                ...file,
                after,
                issue:
                  "File does not match the installer receipt. Verify it before continuing.",
              };
        },
        (effect, file) =>
          effect.pipe(
            Effect.catch((error) =>
              Effect.succeed({
                ...file,
                issue: `Could not verify installed file: ${error.message}`,
              }),
            ),
          ),
      ),
      { concurrency: 8 },
    );
    const result = registryReceipt({ ...observation, files }, overwrite);
    return {
      ...result,
      complete: code === 0 && result.complete,
      error:
        result.error ??
        (code !== 0 ? `Registry installer exited ${code}.` : null),
      output,
    };
  },
  Effect.scoped,
);
