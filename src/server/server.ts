import type { ServerWebSocket } from "bun";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, join, normalize, relative, sep } from "node:path";
import { runtimeFile, uiFiles } from "../generated/assets.js";
import { projectPaths } from "../lib/paths";
import { registerServer, type ServerInfo } from "../lib/server-state";
import { FrameBundler } from "./bundler";
import { findFrame, scanProject, type Frame, type Page } from "./project";
import { Screenshotter } from "./screenshotter";
import { buildThemeCss } from "./tailwind";
import { layoutFrames } from "../ui/layout";
import { FRAME_CSS } from "../runtime/frame-style";

const FIRST_PORT = 4747;

export type SnapshotFrame = Pick<Frame, "id" | "kind" | "page" | "slug" | "relFile" | "meta" | "parent" | "note" | "source"> & {
  version: number;
  error: string | null;
};
export type Snapshot = {
  projectName: string;
  cssVersion: number;
  cssError: string | null;
  pages: (Omit<Page, "frames"> & { frames: SnapshotFrame[] })[];
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const mimeType = (path: string) => MIME[path.slice(path.lastIndexOf("."))];

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

export async function runServer(root: string, onReady?: (url: string) => void) {
  const p = projectPaths(root);
  mkdirSync(p.state, { recursive: true });

  const bundler = new FrameBundler(p);
  const runtimeErrors = new Map<string, string>();
  const sockets = new Set<ServerWebSocket<unknown>>();
  let pages: Page[] = [];
  let css = { text: "", error: null as string | null, version: 0 };

  const allFrames = () => pages.flatMap((pg) => pg.frames);
  const tsxFrames = () => allFrames().filter((f) => f.kind === "tsx");

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
            kind: f.kind,
            relFile: f.relFile,
            meta: f.meta,
            parent: f.parent,
            note: f.note,
            source: f.source,
            // Images version by modification time so replaced files bust the browser cache.
            version: f.kind === "image" ? Math.round(statSync(f.file).mtimeMs) : (built?.version ?? 0),
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
    if (css.error) {
      const file = css.error.startsWith("DESIGN.md") ? ".framio/DESIGN.md" : ".framio/theme.css";
      errors.unshift({ frame: "", file, kind: "css", message: css.error });
    }
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
    await Promise.all([bundler.build(tsxFrames()), rebuildCss()]);
    log(`built ${allFrames().length} frames in ${Math.round(performance.now() - t)}ms`);
  }

  const isCode = (f: string) => /\.(tsx?|jsx?)$/.test(f);
  const isDeps = (f: string) => /^(package\.json|bun\.lockb?|tsconfig\.json)$/.test(f);

  async function applyChanges(changed: Set<string>) {
    const t = performance.now();
    pages = scanProject(p);
    const frames = allFrames();
    for (const id of runtimeErrors.keys()) if (!frames.some((f) => f.id === id)) runtimeErrors.delete(id);

    const files = [...changed];
    const codeChanged = files.some((f) => isCode(f) || isDeps(f));
    const cssChanged = files.some((f) => f.endsWith(".css") || isCode(f) || f === "DESIGN.md");
    const [rebuilt] = await Promise.all([
      codeChanged ? bundler.build(tsxFrames()) : Promise.resolve([]),
      cssChanged ? rebuildCss() : null,
    ]);
    for (const id of rebuilt) runtimeErrors.delete(id);
    if (codeChanged || cssChanged)
      log(`build: ${rebuilt.length} frames changed${cssChanged ? " + css" : ""} in ${Math.round(performance.now() - t)}ms`);
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
<style>:root{--fvh:${fvh}}${FRAME_CSS}</style>
<script>window.__FRAMIO_BOOT__=${JSON.stringify(boot).replace(/</g, "\\u003c")}</script>
<script src="/_runtime.js"></script>
</head>
<body><div id="root"></div>${boot.error ? "" : `<script type="module" src="${src}"></script>`}</body>
</html>`;
  }

  function staticFile(path: string, type?: string) {
    const file = Bun.file(path, type ? { type } : undefined);
    return new Response(file);
  }

  let screenshotter: Screenshotter | null = null;

  /** Small cached renders for zoomed-out canvases, keyed by frame + css version. */
  const thumbs = new Map<string, { key: string; file: Promise<string> }>();
  async function thumbnail(frame: Frame) {
    const key = `${bundler.get(frame.id)?.version ?? 0}-${css.version}`;
    let entry = thumbs.get(frame.id);
    if (entry?.key !== key) {
      const out = join(p.state, "thumbs", frame.page, `${frame.slug}.png`);
      entry = { key, file: screenshotter!.capture(frame, out, 0.5).then((r) => r.path) };
      thumbs.set(frame.id, entry);
      entry.file.catch(() => thumbs.delete(frame.id));
    }
    try {
      return new Response(Bun.file(await entry.file), { headers: { "cache-control": "no-store" } });
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  }

  async function handleScreenshot(req: Request) {
    const body = (await req.json()) as { frames?: string[]; page?: string; scale?: number };
    await queue; // never screenshot a stale build
    if (body.page) return handlePageScreenshot(body.page, body.scale);
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

  /** One image of a whole page, laid out like the canvas, so agents can compare variations. */
  async function handlePageScreenshot(ref: string, scale = 1) {
    const page = pages.find((pg) => pg.id === ref || pg.name.toLowerCase() === ref.toLowerCase());
    if (!page) return json({ results: [{ frame: ref, error: `No page "${ref}". Pages: ${pages.map((pg) => pg.id).join(", ")}` }] });
    if (!page.frames.length) return json({ results: [{ frame: page.id, error: `Page "${page.name}" has no frames.` }] });
    const shots = await Promise.all(
      page.frames.map(async (f) => {
        const out = join(p.screenshots, f.page, `${f.slug}.png`);
        try {
          return { frame: f, ...(await screenshotter!.capture(f, out, 1)) };
        } catch (err) {
          return { frame: f, path: null, height: f.meta.height, error: `Screenshot failed: ${(err as Error).message}` };
        }
      }),
    );
    const heights = Object.fromEntries(shots.map((s) => [s.frame.id, s.height]));
    const out = join(p.screenshots, `${page.id}.png`);
    const overview = await screenshotter!.composePage(
      shots.map((s) => ({
        id: s.frame.id,
        name: s.frame.meta.name,
        parent: s.frame.parent,
        width: s.frame.meta.width,
        height: s.height,
        note: s.frame.note,
        src: !s.path
          ? null
          : `/shots/${encodeURIComponent(s.frame.page)}/${encodeURIComponent(s.frame.slug)}.png?t=${Date.now()}`,
      })),
      layoutFrames(snapshot().pages.find((pg) => pg.id === page.id)!.frames, heights, page.positions),
      out,
      scale,
    );
    const results = [
      { frame: page.id, file: `.framio/pages/${page.id}`, path: out, width: overview.width, height: overview.height },
      ...shots.filter((s) => s.error).map((s) => ({ frame: s.frame.id, file: s.frame.relFile, error: s.error })),
    ];
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
        if (path === "/api/health") return json({ ok: true, root, pid: process.pid });
        if (path === "/api/project") return json(snapshot());

        if (path === "/api/selection" && req.method === "POST") {
          const body = (await req.json()) as { frames: string[]; element: unknown };
          const frames = allFrames().filter((f) => body.frames.includes(f.id));
          const selection = {
            frames: frames.map((f) => ({ frame: f.id, name: f.meta.name, file: f.relFile })),
            element: frames.length === 1 ? (body.element ?? null) : null,
            selectedAt: new Date().toISOString(),
          };
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
        if (path === "/_runtime.js") return staticFile(runtimeFile, "text/javascript; charset=utf-8");

        const frameMatch = /^\/f\/([^/]+)\/([^/]+)$/.exec(path);
        if (frameMatch) {
          const frame = allFrames().find((f) => f.page === frameMatch[1] && f.slug === frameMatch[2]);
          if (!frame) return new Response("Frame not found", { status: 404 });
          if (frame.kind === "image") return Response.redirect(`/img/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}`);
          return new Response(frameHtml(frame, url.searchParams.has("canvas")), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }

        if (path.startsWith("/js/")) {
          const rel = path.slice(4);
          const js = bundler.file(rel);
          if (js === undefined) return new Response("// not built", { status: 404 });
          // Chunks are content-hashed, so iframes share one cached copy of React and components.
          const cache = rel.startsWith("chunks/") ? "public, max-age=31536000, immutable" : "no-store";
          return new Response(js, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": cache } });
        }

        const thumbMatch = /^\/thumb\/([^/]+)\/([^/]+)\.png$/.exec(path);
        if (thumbMatch) {
          const frame = allFrames().find((f) => f.page === thumbMatch[1] && f.slug === thumbMatch[2]);
          if (!frame) return new Response("Frame not found", { status: 404 });
          return thumbnail(frame);
        }

        const imgMatch = /^\/img\/([^/]+)\/([^/]+)$/.exec(path);
        if (imgMatch) {
          const frame = allFrames().find((f) => f.kind === "image" && f.page === imgMatch[1] && f.slug === imgMatch[2]);
          return frame ? new Response(Bun.file(frame.file)) : new Response("Not found", { status: 404 });
        }

        // Images frames use, e.g. generated illustrations: <img src="/assets/hero.png" />
        if (path.startsWith("/assets/")) {
          const file = normalize(join(p.assets, path.slice("/assets/".length)));
          if (!file.startsWith(p.assets + sep) || !existsSync(file)) return new Response("Not found", { status: 404 });
          return new Response(Bun.file(file), { headers: { "cache-control": "no-cache" } });
        }

        const shotMatch = /^\/shots\/(.+\.png)$/.exec(path);
        if (shotMatch) {
          const file = normalize(join(p.screenshots, shotMatch[1]!));
          if (!file.startsWith(p.screenshots) || !existsSync(file)) return new Response("Not found", { status: 404 });
          return new Response(Bun.file(file));
        }

        const asset = uiFiles[path.slice(1)];
        if (asset) return staticFile(asset, mimeType(path));
        return staticFile(uiFiles["index.html"]!, "text/html; charset=utf-8");
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
  registerServer(p, info);
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
  onReady?.(info.url);
}
