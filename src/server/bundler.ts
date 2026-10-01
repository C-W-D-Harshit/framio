import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import type { Frame } from "./project";

export type FrameBuild = { error: string | null; version: number };

/**
 * Bundles every frame in one Bun.build with code splitting, so React and shared components are
 * downloaded once and cached across iframes. If that build fails, frames are rebuilt one by one
 * so a broken frame never takes the others down with it.
 *
 * A frame's version only changes when its output changes, so the canvas reloads exactly the
 * frames affected by an edit. Packages resolve from .framio/node_modules only.
 */
export class FrameBundler {
  private frames = new Map<string, FrameBuild & { hash: number }>();
  /** Built files keyed by path relative to /js/, e.g. "01-example/sign-in.js", "chunks/chunk-x.js". */
  private files = new Map<string, string>();
  private nextVersion = 1;

  constructor(private p: ProjectPaths) {}

  get(id: string): FrameBuild | undefined {
    return this.frames.get(id);
  }

  file(path: string) {
    return this.files.get(path);
  }

  /** Rebuilds all frames. Returns the ids whose output changed. */
  async build(frames: Frame[]): Promise<string[]> {
    for (const id of this.frames.keys()) if (!frames.some((f) => f.id === id)) this.frames.delete(id);
    if (!frames.length) {
      this.files = new Map();
      return [];
    }
    const entries = new Map(frames.map((f) => [this.writeEntry(f), f]));
    const out = await this.run([...entries.keys()], true);

    const files = new Map<string, string>();
    const results = new Map<string, { text: string | null; error: string | null }>();
    if (out.ok) {
      for (const o of out.outputs) files.set(o.path, o.text);
      for (const f of frames) results.set(f.id, { text: files.get(entryOutput(f)) ?? null, error: null });
    } else {
      await Promise.all(
        [...entries].map(async ([entry, f]) => {
          const single = await this.run([entry], false);
          const text = single.ok ? single.outputs[0]!.text : null;
          if (text) files.set(entryOutput(f), text);
          results.set(f.id, { text, error: single.ok ? null : single.error });
        }),
      );
    }
    this.files = files;

    const changed: string[] = [];
    for (const f of frames) {
      const r = results.get(f.id)!;
      const hash = Number(Bun.hash(r.error ?? r.text ?? ""));
      const prev = this.frames.get(f.id);
      if (prev && prev.hash === hash && prev.error === r.error) continue;
      this.frames.set(f.id, { error: r.error, version: this.nextVersion++, hash });
      changed.push(f.id);
    }
    return changed;
  }

  private writeEntry(frame: Frame) {
    const entry = join(this.p.entries, frame.page, `${frame.slug}.tsx`);
    const source = [
      `import { createElement } from "react";`,
      `import { createRoot } from "react-dom/client";`,
      `import * as mod from ${JSON.stringify(frame.file)};`,
      `const Frame = mod.default;`,
      `if (typeof Frame !== "function") throw new Error(${JSON.stringify(`${frame.relFile} must \`export default\` a React component.`)});`,
      `createRoot(document.getElementById("root")!, {`,
      `  onUncaughtError: (error, info) => (window as any).__framio?.reportError(error, info.componentStack),`,
      `}).render(createElement(Frame));`,
    ].join("\n");
    if (!existsSync(entry) || readFileSync(entry, "utf8") !== source) {
      mkdirSync(join(this.p.entries, frame.page), { recursive: true });
      writeFileSync(entry, source);
    }
    return entry;
  }

  private async run(entrypoints: string[], splitting: boolean) {
    try {
      const out = await Bun.build({
        entrypoints,
        root: this.p.entries,
        splitting,
        target: "browser",
        format: "esm",
        naming: { entry: "[dir]/[name].[ext]", chunk: "chunks/[name]-[hash].[ext]" },
        define: { "process.env.NODE_ENV": JSON.stringify("development") },
        throw: false,
      });
      if (!out.success) return { ok: false as const, error: this.formatLogs(out.logs) };
      const outputs = await Promise.all(
        out.outputs.map(async (o) => ({ path: o.path.replace(/^\.\//, ""), text: await o.text() })),
      );
      return { ok: true as const, outputs };
    } catch (err) {
      const e = err as AggregateError;
      return { ok: false as const, error: e.errors?.length ? this.formatLogs(e.errors) : String(e.message ?? e) };
    }
  }

  private formatLogs(logs: unknown[]) {
    return (
      logs
        .map((l) => {
          const log = l as BuildMessage;
          const pos = log.position;
          if (!pos?.file) return String(log.message ?? log);
          const where = `${relative(this.p.root, pos.file)}:${pos.line}:${pos.column}`;
          return `${where}: ${log.message}${pos.lineText ? `\n    ${pos.lineText.trim()}` : ""}`;
        })
        .join("\n\n") || "Build failed"
    );
  }
}

const entryOutput = (f: Frame) => `${f.page}/${f.slug}.js`;
