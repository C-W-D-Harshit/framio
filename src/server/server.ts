import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiError } from "effect/http-api";
import { Socket } from "effect/socket";
import { RpcServer, RpcSerialization } from "effect/rpc";
import { LiveRpc } from "../contracts/live";
import { join, normalize, sep } from "node:path";
import { Api } from "../contracts/api";
import type {
  ScreenshotRequest,
  ScreenshotResponse,
  ScreenshotResult,
} from "../contracts/requests";
import type { ServerInfo } from "../contracts/server-info";
import type { Frame } from "../domain/project";
import { CanvasFile } from "../domain/project";
import { Policies } from "../domain/policies";
import { PortOccupied, ServerStartupFailed } from "../domain/errors";
import { runtimeFile, uiFiles } from "../generated/assets.js";
import { projectPaths } from "../lib/paths";
import { FRAME_CSS } from "../runtime/frame-style";
import {
  ProjectState,
  projectSnapshot,
  type ProjectGeneration,
} from "../services/project-state";
import { Screenshots } from "../services/screenshots";
import { layoutFrames } from "../ui/layout";
import { findFrame } from "./project";
export type { Snapshot, SnapshotFrame } from "../contracts/snapshot";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
function frameHtml(frame: Frame, canvas: boolean, state: ProjectGeneration) {
  const built = state.artifacts.frames.get(frame.id);
  const boot = {
    id: frame.id,
    canvas,
    version: built?.version ?? 0,
    error: frame.metaError ?? built?.error ?? null,
  };
  const src = `/js/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}.js?v=${boot.version}`;
  return `<!doctype html><html lang="en"${frame.meta.theme === "dark" ? ' class="dark"' : ""}><head>
<meta charset="utf-8"><meta name="viewport" content="width=${frame.meta.width}"><title>${frame.meta.name.replace(/</g, "&lt;")}</title>
<link rel="stylesheet" href="/_theme.css?v=${state.css.version}"><style>:root{--fvh:${frame.meta.height / 100}px}${FRAME_CSS}</style>
<script>window.__FRAMIO_BOOT__=${JSON.stringify(boot).replace(/</g, "\\u003c")}</script><script src="/_runtime.js"></script>
</head><body><div id="root"></div>${boot.error ? "" : `<script type="module" src="${src}"></script>`}</body></html>`;
}

export const runServer = Effect.fn("Server.start")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const p = projectPaths(root);
  yield* fs.makeDirectory(p.state, { recursive: true });
  const project = Context.get(
    yield* Layer.build(ProjectState.layer(p)),
    ProjectState,
  );
  let server: HttpServer.HttpServer["Service"] | undefined;
  for (
    let port = Policies.firstPort;
    port < Policies.firstPort + Policies.portCount;
    port++
  ) {
    const attempt = yield* BunHttpServer.make({
      port,
      hostname: "127.0.0.1",
      idleTimeout: 120,
      disablePreemptiveShutdown: true,
    }).pipe(
      Effect.catchDefect((cause) =>
        Predicate.hasProperty(cause, "code") && cause.code === "EADDRINUSE"
          ? Effect.fail(new PortOccupied({ port }))
          : Effect.die(cause),
      ),
      Effect.result,
    );
    if (attempt._tag === "Success") {
      server = attempt.success;
      break;
    }
    if (attempt.failure._tag !== "PortOccupied") return yield* attempt.failure;
  }
  if (!server || server.address._tag === "UnixPathAddress")
    return yield* new ServerStartupFailed({ message: "No free port found" });
  const info: ServerInfo = {
    pid: process.pid,
    port: server.address.port,
    url: `http://localhost:${server.address.port}`,
    startedAt: DateTime.formatIso(yield* DateTime.now),
  };
  const shots = Context.get(
    yield* Layer.build(Screenshots.layer(info.url)),
    Screenshots,
  );

  const screenshot = Effect.fn("Server.screenshot")(function* (
    body: typeof ScreenshotRequest.Type,
  ): Effect.fn.Return<typeof ScreenshotResponse.Type> {
    return yield* project.withStableState((state) =>
      Effect.gen(function* () {
        const capture = (
          frame: Frame,
          scale = 1,
        ): Effect.Effect<typeof ScreenshotResult.Type> =>
          shots
            .capture(
              frame,
              join(p.screenshots, frame.page, `${frame.slug}.png`),
              scale,
            )
            .pipe(
              Effect.map((shot) => ({
                frame: frame.id,
                file: frame.relFile,
                ...shot,
              })),
              Effect.catch((error) =>
                Effect.succeed({
                  frame: frame.id,
                  file: frame.relFile,
                  error: `Screenshot failed: ${error.message}`,
                }),
              ),
            );
        if (!body.page) {
          const refs = body.frames?.length
            ? body.frames
            : state.pages.flatMap((page) =>
                page.frames.map((frame) => frame.id),
              );
          const results = yield* Effect.forEach(
            refs,
            (ref): Effect.Effect<typeof ScreenshotResult.Type> => {
              const frame = findFrame(state.pages, ref);
              return "error" in frame
                ? Effect.succeed({ frame: ref, error: frame.error })
                : capture(frame, body.scale);
            },
            { concurrency: Policies.captureConcurrency },
          );
          return { results };
        }
        const page = state.pages.find(
          (page) =>
            page.id === body.page ||
            page.name.toLowerCase() === body.page!.toLowerCase(),
        );
        if (!page)
          return {
            results: [
              {
                frame: body.page,
                error: `No page "${body.page}". Pages: ${state.pages.map((page) => page.id).join(", ")}`,
              },
            ],
          };
        if (!page.frames.length)
          return {
            results: [
              { frame: page.id, error: `Page "${page.name}" has no frames.` },
            ],
          };
        const captures = yield* Effect.forEach(
          page.frames,
          (frame) => capture(frame),
          { concurrency: Policies.captureConcurrency },
        );
        const heights = Object.fromEntries(
          page.frames.map((frame, i) => [
            frame.id,
            captures[i]!.height ?? frame.meta.height,
          ]),
        );
        const out = join(p.screenshots, `${page.id}.png`);
        const overview = yield* shots
          .compose(
            page.frames.map((frame, i) => {
              const shot = captures[i]!;
              return {
                id: frame.id,
                name: frame.meta.name,
                parent: frame.parent,
                width: frame.meta.width,
                height: heights[frame.id] ?? frame.meta.height,
                note: frame.note,
                src:
                  "path" in shot
                    ? `/shots/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}.png?g=${state.generation}`
                    : null,
              };
            }),
            layoutFrames(
              projectSnapshot(root, { ...state, pages: [page] }).pages[0]!
                .frames,
              heights,
              page.positions,
            ),
            out,
            body.scale,
          )
          .pipe(Effect.result);
        return {
          results: [
            overview._tag === "Success"
              ? {
                  frame: page.id,
                  file: `.framio/pages/${page.id}`,
                  ...overview.success,
                }
              : { frame: page.id, error: overview.failure.message },
            ...captures.filter((shot) => shot.error),
          ],
        };
      }),
    );
  });
  const Handlers = HttpApiBuilder.group(Api, "project", (handlers) =>
    handlers.handleAll({
      health: () =>
        Effect.succeed({
          ok: true,
          root,
          pid: process.pid,
          protocol: "framio-v4-1",
        }),
      snapshot: () =>
        project.get.pipe(Effect.map((state) => projectSnapshot(root, state))),
      selection: ({ payload }) =>
        Effect.gen(function* () {
          const state = yield* project.get;
          const selected = new Set(payload.frames);
          const frames = state.pages
            .flatMap((page) => page.frames)
            .filter((frame) => selected.has(frame.id));
          yield* fs.writeFileString(
            p.selectionFile,
            JSON.stringify(
              {
                frames: frames.map((frame) => ({
                  frame: frame.id,
                  name: frame.meta.name,
                  file: frame.relFile,
                })),
                element: frames.length === 1 ? payload.element : null,
                selectedAt: DateTime.formatIso(yield* DateTime.now),
              },
              null,
              2,
            ) + "\n",
          );
          return { ok: true as const };
        }).pipe(Effect.orDie),
      canvas: ({ payload }) =>
        project.withStableState((state) =>
          Effect.gen(function* () {
            const page = state.pages.find((page) => page.id === payload.page);
            if (!page) return yield* new HttpApiError.NotFound();
            const file = join(p.pages, page.id, "canvas.json");
            const current = yield* fs.readFileString(file).pipe(
              Effect.catchReason("PlatformError", "NotFound", () =>
                Effect.succeed("{}"),
              ),
              Effect.orDie,
            );
            const decoded = yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(CanvasFile),
            )(current).pipe(Effect.orDie);
            const positions = Object.fromEntries(
              Object.entries({
                ...decoded.positions,
                ...payload.positions,
              }).map(([id, pos]) => [
                id,
                { x: Math.round(pos.x), y: Math.round(pos.y) },
              ]),
            );
            yield* fs
              .writeFileString(
                file,
                JSON.stringify({ ...decoded, positions }, null, 2) + "\n",
              )
              .pipe(Effect.orDie);
            return { ok: true as const };
          }),
        ),
      frameStatus: ({ payload }) =>
        project
          .update((state) => {
            const built = state.artifacts.frames.get(payload.id);
            if (
              !built ||
              (payload.version !== undefined &&
                built.version !== payload.version)
            )
              return state;
            if ((state.runtimeErrors.get(payload.id) ?? null) === payload.error)
              return state;
            const runtimeErrors = new Map(state.runtimeErrors);
            if (payload.error) runtimeErrors.set(payload.id, payload.error);
            else runtimeErrors.delete(payload.id);
            return { ...state, runtimeErrors };
          })
          .pipe(Effect.as({ ok: true as const })),
      screenshot: ({ payload }) => screenshot(payload),
    }),
  );
  const ApiRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(Handlers));
  const connections = yield* Ref.make<ReadonlySet<Socket.Socket>>(new Set());
  const closeSocket = (socket: Socket.Socket) =>
    Effect.scoped(
      Effect.flatMap(socket.writer, (writer) =>
        writer.write(new Socket.CloseEvent(1001, "Framio shutting down")),
      ),
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Socket cleanup failed", error),
      ),
    );
  const SocketOwnership = HttpRouter.middleware(
    (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (request.url.split("?")[0] !== "/ws") return yield* effect;
        const upgrade = Effect.acquireRelease(
          request.upgrade.pipe(
            Effect.tap((socket) =>
              Ref.update(
                connections,
                (sockets) => new Set([...sockets, socket]),
              ),
            ),
          ),
          (socket) =>
            closeSocket(socket).pipe(
              Effect.andThen(
                Ref.update(
                  connections,
                  (sockets) =>
                    new Set(
                      [...sockets].filter((current) => current !== socket),
                    ),
                ),
              ),
            ),
        );
        const owned = new Proxy(request, {
          get(target, property) {
            return property === "upgrade"
              ? upgrade
              : Reflect.get(target, property, target);
          },
        });
        return yield* effect.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, owned),
        );
      }),
    { global: true },
  );
  const Live = RpcServer.layer(LiveRpc).pipe(
    Layer.provide(
      LiveRpc.toLayer({
        snapshotsV1: () =>
          project.changes.pipe(
            Stream.buffer({ capacity: 1, strategy: "sliding" }),
            Stream.map((state) => projectSnapshot(root, state)),
          ),
      }),
    ),
    Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws" })),
    Layer.provide(RpcSerialization.layerJson),
  );
  const thumbnails = yield* Cache.make({
    capacity: 128,
    lookup: (key: string) =>
      project.withStableState((state) =>
        Effect.gen(function* () {
          const id = key.slice(0, key.lastIndexOf("|"));
          const frame = state.pages
            .flatMap((page) => page.frames)
            .find((frame) => frame.id === id);
          if (!frame)
            return yield* new ServerStartupFailed({
              message: "Frame not found",
            });
          return yield* shots.capture(
            frame,
            join(p.state, "thumbs", frame.page, `${frame.slug}.png`),
            0.5,
          );
        }),
      ),
  });
  const staticFile = (file: string, contentType?: string) =>
    HttpServerResponse.file(file, { contentType }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Not found", { status: 404 })),
      ),
    );
  const Static = HttpRouter.add("GET", "/*", (request) =>
    Effect.gen(function* () {
      const url = new URL(request.url, info.url);
      const path = decodeURIComponent(url.pathname);
      const state = yield* project.get;
      const all = state.pages.flatMap((page) => page.frames);
      if (path === "/_theme.css")
        return HttpServerResponse.text(
          [state, ...state.retained].find(
            (assets) =>
              assets.css.version === Number(url.searchParams.get("v")),
          )?.css.text ?? state.css.text,
          { contentType: "text/css; charset=utf-8" },
        );
      if (path === "/_runtime.js")
        return HttpServerResponse.uint8Array(runtimeFile, {
          contentType: "text/javascript; charset=utf-8",
        });
      const frameMatch = /^\/f\/([^/]+)\/([^/]+)$/.exec(path);
      if (frameMatch) {
        const frame = all.find(
          (frame) =>
            frame.page === frameMatch[1] && frame.slug === frameMatch[2],
        );
        if (!frame)
          return HttpServerResponse.text("Frame not found", { status: 404 });
        if (frame.kind === "image")
          return HttpServerResponse.empty({
            status: 302,
            headers: {
              location: `/img/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}`,
            },
          });
        return HttpServerResponse.text(
          frameHtml(frame, url.searchParams.has("canvas"), state),
          { contentType: "text/html; charset=utf-8" },
        );
      }
      if (path.startsWith("/js/")) {
        const rel = path.slice(4);
        const version = url.searchParams.get("v");
        const assets =
          version === null
            ? state
            : [state, ...state.retained].find((assets) =>
                [...assets.artifacts.frames].some(
                  ([id, built]) =>
                    `${id}.js` === rel && built.version === Number(version),
                ),
              );
        const js =
          assets?.artifacts.files.get(rel) ??
          (rel.startsWith("chunks/")
            ? [state, ...state.retained]
                .map((assets) => assets.artifacts.files.get(rel))
                .find((text) => text !== undefined)
            : undefined);
        return js === undefined
          ? HttpServerResponse.text("// not built", { status: 404 })
          : HttpServerResponse.text(js, {
              contentType: "text/javascript; charset=utf-8",
              headers: {
                "cache-control": rel.startsWith("chunks/")
                  ? "public, max-age=31536000, immutable"
                  : "no-store",
              },
            });
      }
      const thumbMatch = /^\/thumb\/([^/]+)\/([^/]+)\.png$/.exec(path);
      if (thumbMatch) {
        const frame = all.find(
          (frame) =>
            frame.page === thumbMatch[1] && frame.slug === thumbMatch[2],
        );
        if (!frame)
          return HttpServerResponse.text("Frame not found", { status: 404 });
        const key = `${frame.id}|${frame.kind === "image" ? state.imageVersions.get(frame.id) : state.artifacts.frames.get(frame.id)?.version}-${state.css.version}`;
        return yield* Cache.get(thumbnails, key).pipe(
          Effect.flatMap((shot) => staticFile(shot.path, "image/png")),
          Effect.catch((error) =>
            Cache.invalidate(thumbnails, key).pipe(
              Effect.as(
                HttpServerResponse.text(error.message, { status: 500 }),
              ),
            ),
          ),
        );
      }

      const imgMatch = /^\/img\/([^/]+)\/([^/]+)$/.exec(path);
      if (imgMatch) {
        const frame = all.find(
          (frame) =>
            frame.kind === "image" &&
            frame.page === imgMatch[1] &&
            frame.slug === imgMatch[2],
        );
        if (!frame)
          return HttpServerResponse.text("Not found", { status: 404 });
        const version = url.searchParams.get("v");
        const assets =
          version === null
            ? state
            : ([state, ...state.retained].find(
                (assets) =>
                  assets.imageVersions.get(frame.id) === Number(version),
              ) ?? state);
        return yield* staticFile(assets.imageFiles.get(frame.id) ?? frame.file);
      }
      for (const [prefix, base] of [
        ["/assets/", p.assets],
        ["/shots/", p.screenshots],
      ]) {
        if (!path.startsWith(prefix!)) continue;
        const file = normalize(join(base!, path.slice(prefix!.length)));
        if (!file.startsWith(base! + sep))
          return HttpServerResponse.text("Not found", { status: 404 });
        const response = yield* staticFile(file);
        return prefix === "/assets/"
          ? HttpServerResponse.setHeader(response, "cache-control", "no-cache")
          : response;
      }
      const asset = uiFiles[path.slice(1)];
      return HttpServerResponse.uint8Array(asset ?? uiFiles["index.html"]!, {
        contentType:
          MIME[path.slice(path.lastIndexOf("."))] ?? "text/html; charset=utf-8",
      });
    }),
  );
  yield* Layer.build(
    HttpRouter.serve(Layer.mergeAll(ApiRoutes, Live, Static, SocketOwnership), {
      disableLogger: true,
      disableListenLog: true,
    }).pipe(
      Layer.provide(Layer.succeed(HttpServer.HttpServer, server)),
      Layer.provide(BunHttpServer.layerHttpServices),
    ),
  );
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Effect.forEach(yield* Ref.get(connections), closeSocket, {
        concurrency: "unbounded",
        discard: true,
      });
      yield* Effect.gen(function* () {
        while ((yield* Ref.get(connections)).size > 0) yield* Effect.sleep(10);
      }).pipe(
        Effect.timeout("5 seconds"),
        Effect.catch(() =>
          Effect.logWarning("Timed out draining live connections"),
        ),
      );
      // Let protocol disconnects drain while the RPC server is still running.
      yield* Effect.yieldNow;
    }),
  );
  yield* Effect.logInfo(`framio running at ${info.url} for ${root}`);
  return { info };
});
