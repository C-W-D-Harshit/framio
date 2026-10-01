import type { ServerWebSocket } from "bun";
import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { basename, join, normalize, relative, sep } from "node:path";
import { DIST_DIR, projectPaths } from "../lib/paths";
import type { ServerInfo } from "../lib/server-state";
import { FrameBundler } from "./bundler";
import { findFrame, scanProject, type Frame, type Page } from "./project";
import { Screenshotter } from "./screenshotter";
import { buildThemeCss } from "./tailwind";

const FIRST_PORT = 4747;
const UI_DIR = join(DIST_DIR, "ui");
const RUNTIME_JS = join(DIST_DIR, "runtime.js");

export type SnapshotFrame = Pick<Frame, "id" | "page" | "slug" | "relFile" | "meta" | "parent"> & {
  version: number;
  error: string | null;
};
export type Snapshot = {
  projectName: string;
  cssVersion: number;
  cssError: string | null;
  pages: (Omit<Page, "frames"> & { frames: SnapshotFrame[] })[];
};

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

export async function runServer(root: string) {
  const p = projectPaths(root);
  mkdirSync(p.state, { recursive: true });

  const bundler = new FrameBundler(p);
  const runtimeErrors = new Map<string, string>();
  const sockets = new Set<ServerWebSocket<unknown>>();
  let pages: Page[] = [];
  let css = { text: "", error: null as string | null, version: 0 };

  const allFrames = () => pages.flatMap((pg) => pg.frames);

  function snapshot(): Snapshot {
    return {
      projectName: basename(root),
      cssVersion: css.version,
      cssError: css.error,
      pages: pages.map((pg) => ({
        ...pg,
        frames: pg.frames.map((f) => {
          const built = bundler.get(f.id);
          return {
            id: f.id,
            page: f.page,
            slug: f.slug,
            relFile: f.relFile,
            meta: f.meta,
            parent: f.parent,
            version: built?.version ?? 0,
            error: f.metaError ?? built?.error ?? runtimeErrors.get(f.id) ?? null,
          };
        }),
      })),
    };
  }

  let lastErrorsJson = "";
  function writeErrorsFile() {
    const errors = allFrames().flatMap((f) => {
      const build = f.metaError ?? bundler.get(f.id)?.error;
      if (build) return [{ frame: f.id, file: f.relFile, kind: "build", message: build }];
      const runtime = runtimeErrors.get(f.id);
      return runtime ? [{ frame: f.id, file: f.relFile, kind: "runtime", message: runtime }] : [];
    });
    if (css.error) errors.unshift({ frame: "", file: ".framio/theme.css", kind: "css", message: css.error });
    const json = JSON.stringify({ errors }, null, 2);
    if (json === lastErrorsJson) return;
    lastErrorsJson = json;
    writeFileSync(p.errorsFile, json + "\n");
  }

  function broadcast() {
    writeErrorsFile();
    const msg = JSON.stringify({ type: "snapshot", snapshot: snapshot() });
    for (const ws of sockets) ws.send(msg);
  }

  async function rebuildCss() {
    const out = await buildThemeCss(p);
    css = { text: out.css, error: out.error, version: css.version + 1 };
    if (out.error) log("css error:", out.error);
  }

  // Rebuilds are serialized so overlapping file events never race each other.
  let queue: Promise<void> = Promise.resolve();
  function enqueue(job: () => Promise<void>) {
    queue = queue.then(job).catch((err) => log("rebuild failed:", err));
    return queue;
  }

  async function fullBuild() {
    const t = performance.now();
    pages = scanProject(p);
    await Promise.all([bundler.build(allFrames()), rebuildCss()]);
    log(`built ${allFrames().length} frames in ${Math.round(performance.now() - t)}ms`);
  }

  async function applyChanges(changed: Set<string>) {
    const t = performance.now();
    const before = new Set(allFrames().map((f) => f.id));
    pages = scanProject(p);
    const frames = allFrames();
    bundler.forget(new Set(frames.map((f) => f.id)));
    for (const id of runtimeErrors.keys()) if (!frames.some((f) => f.id === id)) runtimeErrors.delete(id);

    const files = [...changed];
    const isCode = (f: string) => /\.(tsx?|jsx?)$/.test(f);
    const sharedChanged = files.some(
      (f) => (isCode(f) && !f.startsWith(`pages${sep}`)) || /^(package\.json|bun\.lockb?|tsconfig\.json)$/.test(f),
    );
    const toBuild = sharedChanged
      ? frames
      : frames.filter((f) => !before.has(f.id) || changed.has(relative(p.framio, f.file)));
    const cssChanged = files.some((f) => f.endsWith(".css") || isCode(f));

    await Promise.all([bundler.build(toBuild), cssChanged ? rebuildCss() : null]);
    for (const f of toBuild) runtimeErrors.delete(f.id);
    if (toBuild.length || cssChanged)
      log(`rebuilt ${toBuild.length} frames${cssChanged ? " + css" : ""} in ${Math.round(performance.now() - t)}ms`);
    broadcast();
  }

  await fullBuild();

  // --- File watching ---------------------------------------------------------
  let pending = new Set<string>();
  let timer: Timer | null = null;
  watch(p.framio, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const f = normalize(filename.toString());
    if (f.startsWith(`node_modules${sep}`) || f.startsWith(`.state${sep}`) || f === ".state") return;
    pending.add(f);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = pending;
      pending = new Set();
      enqueue(() => applyChanges(changed));
    }, 60);
  });

  // --- HTTP ------------------------------------------------------------------
  const json = (data: unknown, status = 200) => Response.json(data, { status });

  function frameHtml(frame: Frame, canvas: boolean) {
    const built = bundler.get(frame.id);
    const boot = {
      id: frame.id,
      canvas,
      error: frame.metaError ?? built?.error ?? null,
    };
    const fvh = `${frame.meta.height / 100}px`;
    const src = `/js/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}.js?v=${built?.version ?? 0}`;
    return `<!doctype html>
<html lang="en"${frame.meta.theme === "dark" ? ' class="dark"' : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${frame.meta.width}">
<title>${frame.meta.name.replace(/</g, "&lt;")}</title>
<link rel="stylesheet" href="/_theme.css?v=${css.version}">
<style>:root{--fvh:${fvh}}html,body{margin:0}</style>
<script>window.__FRAMIO_BOOT__=${JSON.stringify(boot).replace(/</g, "\\u003c")}</script>
<script src="/_runtime.js"></script>
</head>
<body><div id="root"></div>${boot.error ? "" : `<script type="module" src="${src}"></script>`}</body>
</html>`;
  }

  function staticFile(path: string) {
    const file = Bun.file(path);
    return file.size > 0 ? new Response(file) : new Response("Not found", { status: 404 });
  }

  let screenshotter: Screenshotter | null = null;

  async function handleScreenshot(req: Request) {
    const body = (await req.json()) as { frames?: string[]; scale?: number };
    await queue; // never screenshot a stale build
    const refs = body.frames?.length ? body.frames : allFrames().map((f) => f.id);
    const results = [];
    for (const ref of refs) {
      const frame = findFrame(pages, ref);
      if ("error" in frame) {
        results.push({ frame: ref, error: frame.error });
        continue;
      }
      const out = join(p.screenshots, frame.page, `${frame.slug}.png`);
      try {
        const shot = await screenshotter!.capture(frame, out, body.scale ?? 1);
        if (shot.error) runtimeErrors.set(frame.id, shot.error);
        results.push({ frame: frame.id, file: frame.relFile, ...shot, path: shot.path });
      } catch (err) {
        results.push({ frame: frame.id, file: frame.relFile, error: `Screenshot failed: ${(err as Error).message}` });
      }
    }
    broadcast();
    return json({ results });
  }

  async function startOn(port: number) {
    return Bun.serve({
      port,
      hostname: "127.0.0.1",
      idleTimeout: 120,
      async fetch(req, server) {
        const url = new URL(req.url);
        const path = decodeURIComponent(url.pathname);

        if (path === "/ws") return server.upgrade(req) ? undefined : new Response("Upgrade failed", { status: 400 });
        if (path === "/api/health") return json({ ok: true, root });
        if (path === "/api/project") return json(snapshot());

        if (path === "/api/selection" && req.method === "POST") {
          const body = (await req.json()) as { frame: string | null; element: unknown };
          const frame = body.frame ? allFrames().find((f) => f.id === body.frame) : null;
          const selection = frame
            ? {
                page: frame.page,
                frame: frame.id,
                name: frame.meta.name,
                file: frame.relFile,
                element: body.element ?? null,
                selectedAt: new Date().toISOString(),
              }
            : { frame: null, selectedAt: new Date().toISOString() };
          writeFileSync(p.selectionFile, JSON.stringify(selection, null, 2) + "\n");
          return json({ ok: true });
        }

        if (path === "/api/canvas" && req.method === "POST") {
          const body = (await req.json()) as { page: string; positions: Record<string, { x: number; y: number }> };
          const page = pages.find((pg) => pg.id === body.page);
          if (!page) return json({ error: "unknown page" }, 404);
          const file = join(p.pages, page.id, "canvas.json");
          const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
          const positions: Record<string, { x: number; y: number }> = { ...(current.positions ?? {}), ...body.positions };
          for (const pos of Object.values(positions)) {
            pos.x = Math.round(pos.x);
            pos.y = Math.round(pos.y);
          }
          writeFileSync(file, JSON.stringify({ ...current, positions }, null, 2) + "\n");
          page.positions = positions;
          return json({ ok: true });
        }

        if (path === "/api/frame-status" && req.method === "POST") {
          const body = (await req.json()) as { id: string; error: string | null };
          const prev = runtimeErrors.get(body.id) ?? null;
          if (body.error) runtimeErrors.set(body.id, body.error);
          else runtimeErrors.delete(body.id);
          if (prev !== body.error) broadcast();
          return json({ ok: true });
        }

        if (path === "/api/screenshot" && req.method === "POST") return handleScreenshot(req);

        if (path === "/_theme.css")
          return new Response(css.text, { headers: { "content-type": "text/css; charset=utf-8" } });
        if (path === "/_runtime.js") return staticFile(RUNTIME_JS);

        const frameMatch = /^\/f\/([^/]+)\/([^/]+)$/.exec(path);
        if (frameMatch) {
          const frame = allFrames().find((f) => f.page === frameMatch[1] && f.slug === frameMatch[2]);
          if (!frame) return new Response("Frame not found", { status: 404 });
          return new Response(frameHtml(frame, url.searchParams.has("canvas")), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }

        const jsMatch = /^\/js\/([^/]+)\/([^/]+)\.js$/.exec(path);
        if (jsMatch) {
          const built = bundler.get(`${jsMatch[1]}/${jsMatch[2]}`);
          if (!built?.js) return new Response("// build failed", { status: 404 });
          return new Response(built.js, {
            headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
          });
        }

        const uiPath = normalize(join(UI_DIR, path === "/" ? "index.html" : path));
        if (uiPath.startsWith(UI_DIR) && existsSync(uiPath)) return staticFile(uiPath);
        return staticFile(join(UI_DIR, "index.html"));
      },
      websocket: {
        open(ws) {
          sockets.add(ws);
          ws.send(JSON.stringify({ type: "snapshot", snapshot: snapshot() }));
        },
        close(ws) {
          sockets.delete(ws);
        },
        message() {},
      },
    });
  }

  let server: ReturnType<typeof Bun.serve> | null = null;
  for (let port = FIRST_PORT; port < FIRST_PORT + 100 && !server; port++) {
    try {
      server = await startOn(port);
    } catch (err) {
      if ((err as { code?: string }).code !== "EADDRINUSE") throw err;
    }
  }
  if (!server) throw new Error("No free port found");

  const info: ServerInfo = {
    pid: process.pid,
    port: server.port!,
    url: `http://localhost:${server.port}`,
    startedAt: new Date().toISOString(),
  };
  screenshotter = new Screenshotter(info.url);
  writeFileSync(p.serverFile, JSON.stringify(info, null, 2) + "\n");
  writeErrorsFile();
  log(`framio running at ${info.url} for ${root}`);

  const shutdown = async () => {
    await screenshotter?.close();
    try {
      const current = JSON.parse(readFileSync(p.serverFile, "utf8")) as ServerInfo;
      if (current.pid === process.pid) rmSync(p.serverFile, { force: true });
    } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
