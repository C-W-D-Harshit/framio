/**
 * Compiles framio into a single self-contained executable for the current platform:
 * dist/bin/framio-<os>-<arch> plus a .tar.gz for GitHub releases.
 *
 * Native addons (Tailwind's oxide, lightningcss) are embedded. lightningcss picks its addon
 * with a dynamic require that Bun can't follow, so the plugin rewrites it to a static one.
 */
import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");
const target = `${process.platform}-${process.arch}`;
const outDir = join(root, "dist/bin");
const outfile = join(outDir, `framio-${target}`);

await $`bun run ${join(root, "scripts/build-ui.ts")}`.quiet();
mkdirSync(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/cli.ts")],
  compile: { outfile },
  minify: true,
  define: { FRAMIO_VERSION: JSON.stringify(pkg.version) },
  plugins: [
    {
      name: "static-native-addons",
      setup(build) {
        build.onLoad({ filter: /lightningcss[/\\]node[/\\]index\.js$/ }, async (args) => {
          const source = await Bun.file(args.path).text();
          const addon = `lightningcss-${target}${process.platform === "linux" ? "-gnu" : ""}`;
          const patched = source.replace(/let native;[\s\S]*?\n}\n/, `let native = require(${JSON.stringify(addon)});\n`);
          if (patched === source) throw new Error("lightningcss loader changed; update the build plugin");
          return { contents: patched, loader: "js" };
        });
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await $`tar -czf ${outfile}.tar.gz -C ${outDir} ${`framio-${target}`}`;
const size = (Bun.file(outfile).size / 1024 / 1024).toFixed(1);
console.log(`built ${outfile} (${size} MB) v${pkg.version}`);
