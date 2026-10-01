import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectPaths } from "../lib/paths";
import type { Frame } from "./project";

export type BuildResult = { js: string | null; error: string | null; version: number };

/**
 * Bundles each frame into a standalone ES module that mounts the frame's default export.
 * Packages resolve from .framio/node_modules only, never from the user's project.
 */
export class FrameBundler {
  private results = new Map<string, BuildResult>();
  private version = 0;

  constructor(private p: ProjectPaths) {}

  get(id: string) {
    return this.results.get(id);
  }

  forget(keep: Set<string>) {
    for (const id of this.results.keys()) if (!keep.has(id)) this.results.delete(id);
  }

  async build(frames: Frame[]) {
    await Promise.all(frames.map((f) => this.buildOne(f)));
  }

  private entryFor(frame: Frame) {
    const dir = join(this.p.entries, frame.page);
    mkdirSync(dir, { recursive: true });
    const entry = join(dir, `${frame.slug}.tsx`);
    writeFileSync(
      entry,
      [
        `import { createElement } from "react";`,
        `import { createRoot } from "react-dom/client";`,
        `import * as mod from ${JSON.stringify(frame.file)};`,
        `const Frame = mod.default;`,
        `if (typeof Frame !== "function") throw new Error("${frame.relFile} must \`export default\` a React component.");`,
        `createRoot(document.getElementById("root")!, {`,
        `  onUncaughtError: (error, info) => (window as any).__framio?.reportError(error, info.componentStack),`,
        `}).render(createElement(Frame));`,
      ].join("\n"),
    );
    return entry;
  }

  private formatLog(log: BuildMessage | ResolveMessage) {
    const pos = log.position;
    if (!pos?.file) return log.message;
    const where = `${relative(this.p.root, pos.file)}:${pos.line}:${pos.column}`;
    return `${where}: ${log.message}${pos.lineText ? `\n    ${pos.lineText.trim()}` : ""}`;
  }

  private async buildOne(frame: Frame) {
    const version = ++this.version;
    try {
      const out = await Bun.build({
        entrypoints: [this.entryFor(frame)],
        target: "browser",
        format: "esm",
        sourcemap: "inline",
        define: { "process.env.NODE_ENV": JSON.stringify("development") },
        throw: false,
      });
      if (!out.success) {
        const error = out.logs.map((l) => this.formatLog(l)).join("\n\n") || "Build failed";
        this.results.set(frame.id, { js: null, error, version });
        return;
      }
      this.results.set(frame.id, { js: await out.outputs[0]!.text(), error: null, version });
    } catch (err) {
      const e = err as AggregateError;
      const error = e.errors?.length ? e.errors.map((x) => this.formatLog(x as BuildMessage)).join("\n\n") : String(e.message ?? e);
      this.results.set(frame.id, { js: null, error, version });
    }
  }
}
