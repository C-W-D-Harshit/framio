/** Builds the canvas UI and the in-frame runtime into dist/. Pass --watch to rebuild on change. */
import tailwind from "bun-plugin-tailwind";
import { rmSync, watch } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

async function build() {
  const t = performance.now();
  rmSync(dist, { recursive: true, force: true });
  const [ui, runtime] = await Promise.all([
    Bun.build({
      entrypoints: [join(root, "src/ui/index.html")],
      outdir: join(dist, "ui"),
      plugins: [tailwind],
      minify: true,
      target: "browser",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      throw: false,
    }),
    Bun.build({
      entrypoints: [join(root, "src/runtime/runtime.ts")],
      outdir: dist,
      naming: "runtime.js",
      format: "iife",
      minify: true,
      target: "browser",
      throw: false,
    }),
  ]);
  for (const out of [ui, runtime]) if (!out.success) for (const l of out.logs) console.error(l);
  console.log(`built ui + runtime in ${Math.round(performance.now() - t)}ms`);
}

await build();

if (process.argv.includes("--watch")) {
  let timer: Timer | null = null;
  for (const dir of ["src/ui", "src/runtime"]) {
    watch(join(root, dir), { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(build, 80);
    });
  }
  console.log("watching src/ui and src/runtime");
}
