import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { join } from "node:path";
import pkg from "../package.json";
import { buildUi } from "./services/ui-build";
import { InvalidInput } from "../src/domain/errors";
const root = join(import.meta.dir, "..");
const target = `${process.platform}-${process.arch}`;
const outDir = join(root, "dist/bin");
const executable = `framio-${target}${process.platform === "win32" ? ".exe" : ""}`;
const outfile = join(outDir, executable);
const archive = join(outDir, `framio-${target}.tar.gz`);
Effect.scoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.scoped(buildUi(root));
    yield* fs.makeDirectory(outDir, { recursive: true });
    const result = yield* Effect.tryPromise(() =>
      Bun.build({
        entrypoints: [join(root, "src/cli.ts")],
        compile: { outfile },
        minify: true,
        define: { FRAMIO_VERSION: JSON.stringify(pkg.version) },
        plugins: [
          {
            name: "static-native-addons",
            setup(build) {
              build.onLoad(
                { filter: /lightningcss[/\\]node[/\\]index\.js$/ },
                async (args) => {
                  const source = await Bun.file(args.path).text();
                  const addon = `lightningcss-${target}${process.platform === "linux" ? "-gnu" : process.platform === "win32" ? "-msvc" : ""}`;
                  const patched = source.replace(
                    /let native;[\s\S]*?\n}\n/,
                    `let native = require(${JSON.stringify(addon)});\n`,
                  );
                  if (patched === source)
                    throw new Error(
                      "lightningcss loader changed; update the build plugin",
                    );
                  return { contents: patched, loader: "js" };
                },
              );
            },
          },
        ],
      }),
    );
    if (!result.success)
      return yield* new InvalidInput({
        message: result.logs.map((log) => log.message).join("\n"),
      });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const tar = yield* spawner.spawn(
      ChildProcess.make(
        "tar",
        ["--format=ustar", "-czf", archive, "-C", outDir, executable],
        {
          stdout: "inherit",
          stderr: "inherit",
          env: { ...process.env, COPYFILE_DISABLE: "1" },
        },
      ),
    );
    if ((yield* tar.exitCode) !== 0)
      return yield* new InvalidInput({
        message: "Binary archive creation failed",
      });
    const size = Number((yield* fs.stat(outfile)).size) / 1024 / 1024;
    yield* Effect.logInfo(
      `built ${outfile} (${size.toFixed(1)} MB) v${pkg.version}`,
    );
  }),
).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
