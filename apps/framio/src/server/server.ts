import * as Deferred from "effect/Deferred";
import { makeUpdater, runningVersion } from "../services/update/updater";
import { RestartJournal } from "../contracts/restart";
import { UpdateFailure } from "../contracts/update";
import { isAlive } from "../services/server-registry";
import { makeLayersApi } from "./layers/api";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { frameViewports, viewports, viewportId } from "../domain/viewports";
import { makeScreenshotHandler } from "../services/screenshot-request";
import { makeComments } from "../services/comments";
import { makeEvidence } from "../services/evidence";
import { makeCaptureEvidence } from "../services/capture-evidence";
import { emptyEvidence } from "../contracts/evidence";
import { publishIfUnchanged } from "../platform/atomic-file";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as Semaphore from "effect/Semaphore";
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
import { CanvasFile, PositiveNumber } from "../domain/project";
import { Policies } from "../domain/policies";
import { PortOccupied, ServerStartupFailed } from "../domain/errors";
import {
  runtimeFile,
  runtimeGzipFile,
  uiFiles,
  uiGzipFiles,
} from "../generated/assets.js";
import { projectPaths } from "../lib/paths";
import { FRAME_CSS } from "../runtime/frame-style";
import {
  ProjectState,
  projectSnapshot,
  type ProjectGeneration,
} from "../services/project-state";
import { Screenshots } from "../services/screenshots";
import {
  defaultHost,
  serverBaseUrl,
  serverUrls,
} from "../domain/server-addresses";
import { discoverServerUrls } from "../services/server-addresses";
import { networkAddresses } from "../platform/network-addresses";
import { probeServerPort } from "../platform/server-port";
export type { Snapshot, SnapshotFrame } from "../contracts/snapshot";

const runtimeVersion = Bun.hash(runtimeFile).toString(16);

export function acceptsGzip(header: string | undefined) {
  const encodings = (header ?? "")
    .toLowerCase()
    .split(",")
    .map((part) => {
      const [name, ...params] = part.trim().split(";");
      const q = params.find((param) => param.trim().startsWith("q="));
      return { name, quality: q ? Number(q.trim().slice(2)) : 1 };
    });
  return (
    (
      encodings.find((encoding) => encoding.name === "gzip") ??
      encodings.find((encoding) => encoding.name === "*")
    )?.quality! > 0
  );
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
function frameHtml(
  frame: Frame,
  canvas: boolean,
  state: ProjectGeneration,
  generation?: string,
  preview = false,
) {
  const built = state.artifacts.frames.get(frame.id);
  const boot = {
    id: frame.id,
    canvas,
    preview,
    width: frame.meta.widths ? frame.meta.width : undefined,
    viewportId: viewportId(frame.id, frame.meta, frame.meta.width),
    version: built?.version ?? 0,
    error: frame.metaError ?? built?.error ?? null,
  };
  const pin = generation ? `&g=${generation}` : "";
  const src = `/js/${encodeURIComponent(frame.page)}/${encodeURIComponent(frame.slug)}.js?v=${boot.version}${pin}`;
  return `<!doctype html><html lang="en"${frame.meta.theme === "dark" ? ' class="dark"' : ""}><head>
<meta charset="utf-8"><meta name="viewport" content="width=${frame.meta.width}"><title>${frame.meta.name.replace(/</g, "&lt;")}</title>
<link rel="stylesheet" href="/_theme.css?v=${state.css.version}${pin}"><style>:root{--fvh:${frame.meta.height / 100}px}${FRAME_CSS}</style>
<script>window.__FRAMIO_BOOT__=${JSON.stringify(boot).replace(/</g, "\\u003c")}</script><script src="/_runtime.js?v=${runtimeVersion}"></script>
</head><body><div id="root"></div>${boot.error ? "" : `<script type="module" src="${src}"></script>`}</body></html>`;
}

export const runServer = Effect.fn("Server.start")(function* (
  root: string,
  host = defaultHost,
) {
  const fs = yield* FileSystem.FileSystem;
  const p = projectPaths(root);
  const projectId = createHash("sha256")
    .update(yield* fs.realPath(root))
    .digest("hex");
  const html = Buffer.from(
    Buffer.from(uiFiles["index.html"]!)
      .toString("utf8")
      .replace(
        "<head>",
        `<head><meta name="framio-project" content="${projectId}">`,
      ),
  );
  const htmlGzip = gzipSync(html);
  yield* fs.makeDirectory(p.state, { recursive: true });
  const project = Context.get(
    yield* Layer.build(ProjectState.layer(p)),
    ProjectState,
  );
  const requestedPort = process.env.FRAMIO_SERVER_PORT
    ? Number(process.env.FRAMIO_SERVER_PORT)
    : undefined;
  if (
    requestedPort !== undefined &&
    (!Number.isInteger(requestedPort) ||
      requestedPort < 1 ||
      requestedPort > 65535)
  )
    return yield* new ServerStartupFailed({ message: "Invalid restart port" });
  let server: HttpServer.HttpServer["Service"] | undefined;
  const wildcard = host === "0.0.0.0" || host === "::";
  const addresses = [
    host.includes(":") ? "::" : "0.0.0.0",
    ...(wildcard
      ? serverUrls(host, 0, yield* networkAddresses, null).map((entry) =>
          entry.kind === "local"
            ? host === "::"
              ? "::1"
              : "127.0.0.1"
            : new URL(entry.url).hostname.replace(/^\[|\]$/g, ""),
        )
      : []),
  ];
  for (
    let port = requestedPort ?? Policies.firstPort;
    port <
    (requestedPort === undefined
      ? Policies.firstPort + Policies.portCount
      : requestedPort + 1);
    port++
  ) {
    const attempt = yield* Effect.gen(function* () {
      for (const address of addresses) yield* probeServerPort(address, port);
      return yield* BunHttpServer.make({
        port,
        hostname: host,
        idleTimeout: 120,
        disablePreemptiveShutdown: true,
      });
    }).pipe(
      Effect.catchDefect(
        (cause): Effect.Effect<never, PortOccupied | ServerStartupFailed> =>
          Predicate.hasProperty(cause, "code") && cause.code === "EADDRINUSE"
            ? Effect.fail(new PortOccupied({ port }))
            : Effect.fail(
                new ServerStartupFailed({
                  message: `Could not listen on ${host}:${port}: ${String(cause)}`,
                }),
              ),
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
  const updater = yield* makeUpdater({ background: true });
  const info: ServerInfo = {
    pid: process.pid,
    port: server.address.port,
    url: serverBaseUrl(host, server.address.port),
    startedAt: DateTime.formatIso(yield* DateTime.now),
    version: runningVersion,
    installationId: updater.key,
    supervisorPid: process.env.FRAMIO_SUPERVISOR_PID
      ? Number(process.env.FRAMIO_SUPERVISOR_PID)
      : undefined,
    host,
    urls: yield* discoverServerUrls(host, server.address.port),
  };
  const shots = Context.get(
    yield* Layer.build(Screenshots.layer(info.url)),
    Screenshots,
  );

  const layers = yield* makeLayersApi(p.framio, project, shots);
  const recordCaptures = yield* makeCaptureEvidence(p, project);
  const screenshot = yield* makeScreenshotHandler(
    root,
    p,
    project,
    shots,
    fs,
    layers.warnings,
    recordCaptures,
  );
  const evidenceFile = join(p.framio, "evidence.json");
  const evidence = yield* makeEvidence({
    read: fs
      .readFileString(evidenceFile)
      .pipe(
        Effect.catchReason("PlatformError", "NotFound", () =>
          Effect.succeed(null),
        ),
      ),
    captures: project.get.pipe(Effect.map((state) => state.captures ?? [])),
    frames: project.get.pipe(
      Effect.map((state) =>
        state.pages.flatMap((page) => page.frames.map((frame) => frame.id)),
      ),
    ),
    commit: (previous, next) =>
      Effect.scoped(
        Effect.gen(function* () {
          const temporary = `${evidenceFile}.${randomUUID()}.tmp`;
          yield* Effect.addFinalizer(() =>
            fs
              .remove(temporary, { force: true })
              .pipe(Effect.catch((error) => Effect.logWarning(error.message))),
          );
          yield* fs.writeFileString(temporary, next);
          return yield* publishIfUnchanged(evidenceFile, temporary, previous);
        }),
      ),
  });
  const commentsFile = join(p.framio, "comments.json");
  const comments = yield* makeComments({
    read: fs
      .readFileString(commentsFile)
      .pipe(
        Effect.catchReason("PlatformError", "NotFound", () =>
          Effect.succeed(null),
        ),
      ),
    commit: (previous, next) =>
      Effect.scoped(
        Effect.gen(function* () {
          const temporary = `${commentsFile}.${randomUUID()}.tmp`;
          yield* Effect.addFinalizer(() =>
            fs
              .remove(temporary, { force: true })
              .pipe(Effect.catch((error) => Effect.logWarning(error.message))),
          );
          yield* fs.writeFileString(temporary, next);
          return yield* publishIfUnchanged(commentsFile, temporary, previous);
        }),
      ),
  });
  const serverScope = yield* Scope.Scope;
  const restart = yield* Deferred.make<void>();
  const writes = yield* Semaphore.make(1);
  const restarting = yield* Ref.make(false);
  const connections = yield* Ref.make<ReadonlySet<Socket.Socket>>(new Set());
  const journalFile = `${p.state}/restart.json`;
  const restartState = fs.readFileString(journalFile).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(RestartJournal))(text),
    ),
    Effect.catch(() => Effect.succeed(null)),
  );
  const performUpdate = Effect.fn("Server.update")(function* (
    action: "check" | "download" | "install" | "rollback" | "restart",
  ) {
    if (action === "check") {
      yield* updater.check(true);
      return;
    }
    if (action === "download") {
      yield* updater.download();
      return;
    }
    if (action === "rollback") {
      yield* updater.install(true);
      return;
    }
    if ((yield* Ref.get(connections)).size > 1)
      return yield* new UpdateFailure({
        message:
          "Close the other canvas tabs for this project before restarting. Their pending work must be saved first.",
      });
    if (!info.supervisorPid || !isAlive(info.supervisorPid))
      return yield* new UpdateFailure({
        message:
          "This server has no live session supervisor. Save your work, then run framio stop and framio start in your terminal.",
      });
    yield* Effect.gen(function* () {
      if (yield* Ref.get(restarting))
        return yield* new UpdateFailure({
          message: "This project is already restarting.",
        });
      if ((yield* Ref.get(connections)).size > 1)
        return yield* new UpdateFailure({
          message:
            "Close the other canvas tabs after saving before restarting.",
        });
      yield* Ref.set(restarting, true);
      yield* Effect.gen(function* () {
        if (action === "install") yield* updater.install();
        const status = yield* updater.status();
        if (
          !status.installedVersion ||
          status.installedVersion === runningVersion
        )
          return yield* new UpdateFailure({
            message: "There is no installed update to restart into.",
          });
        const temporary = `${journalFile}.${process.pid}.tmp`;
        yield* fs.writeFileString(
          temporary,
          JSON.stringify({
            phase: "requested",
            port: info.port,
            version: status.installedVersion,
            error: null,
          }),
        );
        yield* fs.rename(temporary, journalFile);
        yield* Deferred.succeed(restart, undefined);
      }).pipe(Effect.onError(() => Ref.set(restarting, false)));
    }).pipe(Semaphore.withPermits(writes, 1));
  });
  const Handlers = HttpApiBuilder.group(Api, "project", (handlers) =>
    handlers.handleAll({
      updateStatus: () =>
        Effect.gen(function* () {
          const status = yield* updater.status();
          const journal = yield* restartState;
          return {
            ...status,
            restartPhase:
              journal?.phase === "failed"
                ? ("failed" as const)
                : journal?.phase === "recovered"
                  ? ("recovered" as const)
                  : (yield* Ref.get(restarting))
                    ? ("restarting" as const)
                    : ("idle" as const),
            restartError: journal?.error ?? null,
          };
        }).pipe(Effect.orDie),
      updateAction: ({ payload }) =>
        payload.action === "download"
          ? Effect.gen(function* () {
              yield* performUpdate("download").pipe(
                Effect.catch((error) => Effect.logWarning(error.message)),
                Effect.forkIn(serverScope),
              );
              return { ok: true, error: null };
            })
          : performUpdate(payload.action).pipe(
              Effect.as({ ok: true, error: null }),
              Effect.catch((error) =>
                Effect.succeed({ ok: false, error: error.message }),
              ),
            ),
      renameLayer: ({ payload }) => layers.renameLayer(payload),
      inspect: ({ payload }) => layers.inspect(payload),
      health: () =>
        Effect.succeed({
          ok: true,
          root,
          pid: process.pid,
          protocol: "framio-v4-1",
          version: runningVersion,
        }),
      snapshot: () =>
        project.get.pipe(Effect.map((state) => projectSnapshot(root, state))),
      evidence: () =>
        project
          .withStableState((state) =>
            Effect.succeed({
              evidence: state.evidence ?? emptyEvidence,
              revision: state.evidenceRevision ?? null,
              contextRevision: state.evidenceContextRevision ?? "",
              captures: state.captures ?? [],
              error: state.evidenceError ?? null,
            }),
          )
          .pipe(Effect.orDie),
      writeEvidence: ({ payload }) =>
        project
          .withEvidenceWrite(
            evidence
              .write(payload)
              .pipe(Effect.andThen(project.notify("evidence.json"))),
          )
          .pipe(
            Effect.as({ ok: true }),
            Effect.catch((error) =>
              Effect.succeed({ ok: false, error: error.message }),
            ),
          ),
      comments: ({ payload }) =>
        comments.apply(payload).pipe(
          Effect.andThen(project.notify("comments.json")),
          Effect.as({ ok: true }),
          Effect.catch((error) =>
            Effect.succeed({ ok: false, error: error.message }),
          ),
        ),
      selection: ({ payload }) =>
        Effect.gen(function* () {
          const state = yield* project.get;
          const selected = new Set(payload.frames);
          const frames = state.pages
            .flatMap((page) => page.frames)
            .filter((frame) => selected.has(frame.id));
          const temporary = `${p.selectionFile}.${randomUUID()}.tmp`;
          yield* Effect.addFinalizer(() =>
            fs
              .remove(temporary, { force: true })
              .pipe(Effect.catch((error) => Effect.logWarning(error.message))),
          );
          yield* fs.writeFileString(
            temporary,
            JSON.stringify(
              {
                frames: frames.map((frame) => ({
                  frame: frame.id,
                  name: frame.meta.name,
                  file: frame.relFile,
                  ...(payload.width !== undefined
                    ? { width: payload.width }
                    : {}),
                })),
                element: frames.length === 1 ? payload.element : null,
                ...(frames.length === 1 && payload.width !== undefined
                  ? { width: payload.width }
                  : {}),
                ...(frames.length === 1 && payload.layer
                  ? { layer: payload.layer }
                  : {}),
                selectedAt: DateTime.formatIso(yield* DateTime.now),
              },
              null,
              2,
            ) + "\n",
          );
          yield* fs.rename(temporary, p.selectionFile);
          return { ok: true as const };
        }).pipe(Effect.scoped, Effect.orDie),
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
            const frame = state.pages
              .flatMap((page) => page.frames)
              .find((frame) => frame.id === payload.id);
            const id =
              frame && payload.width
                ? viewportId(payload.id, frame.meta, payload.width)
                : payload.id;
            if (
              (state.runtimeErrors.get(id) ?? null) === payload.error &&
              (payload.warnings === undefined ||
                JSON.stringify(state.layerWarnings?.get(id) ?? []) ===
                  JSON.stringify(payload.warnings))
            )
              return state;
            const runtimeErrors = new Map(state.runtimeErrors);
            if (payload.error) runtimeErrors.set(id, payload.error);
            else runtimeErrors.delete(id);
            const layerWarnings = new Map(state.layerWarnings);
            if (payload.warnings) layerWarnings.set(id, payload.warnings);
            return { ...state, runtimeErrors, layerWarnings };
          })
          .pipe(Effect.as({ ok: true as const })),
      screenshot: ({ payload }) => screenshot(payload),
    }),
  );
  const ApiRoutes = HttpApiBuilder.layer(Api).pipe(Layer.provide(Handlers));
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
        const path = request.url.split("?")[0];
        if (request.method === "POST" && path === "/api/update") {
          const origin = request.headers["origin"];
          if (
            origin &&
            origin !== info.url &&
            origin !== `http://127.0.0.1:${info.port}` &&
            !info.urls?.some((entry) => entry.url === origin)
          )
            return HttpServerResponse.text("Update origin refused", {
              status: 403,
            });
        }
        if (request.method === "POST" && path !== "/api/update")
          return yield* Effect.gen(function* () {
            if (yield* Ref.get(restarting))
              return HttpServerResponse.text(
                "Project restarting. Saves are paused.",
                { status: 409 },
              );
            return yield* effect;
          }).pipe(Semaphore.withPermits(writes, 1));
        if (path !== "/ws") return yield* effect;
        if (yield* Ref.get(restarting))
          return HttpServerResponse.text("Project restarting", { status: 409 });
        const upgrade = Effect.acquireRelease(
          Effect.gen(function* () {
            if (yield* Ref.get(restarting))
              return yield* Effect.die(new Error("Project restarting"));
            return yield* request.upgrade;
          }).pipe(
            Effect.tap((socket) =>
              Ref.update(
                connections,
                (sockets) => new Set([...sockets, socket]),
              ),
            ),
            Semaphore.withPermits(writes, 1),
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
  const thumbnailPermits = yield* Semaphore.make(2);
  const thumbnailDirectory = yield* Effect.acquireRelease(
    fs.makeTempDirectory({ directory: p.state, prefix: "previews-" }),
    (directory) =>
      fs
        .remove(directory, { recursive: true, force: true })
        .pipe(Effect.catch((error) => Effect.logWarning(error.message))),
  );
  const thumbnailSizes = new Map<string, number>();
  const thumbnailBudget = 32 * 1024 * 1024;
  const thumbnails = yield* Cache.make({
    capacity: 128,
    lookup: (key: string) =>
      project
        .withGeneration((state, generation) =>
          Effect.gen(function* () {
            const [id, width, scale] = yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(
                Schema.Tuple([Schema.String, PositiveNumber, PositiveNumber]),
              ),
            )(key.slice(0, key.lastIndexOf("|"))).pipe(
              Effect.mapError(
                (error) => new ServerStartupFailed({ message: error.message }),
              ),
            );
            const frame = state.pages
              .flatMap((page) => page.frames)
              .find((frame) => frame.id === id);
            if (!frame)
              return yield* new ServerStartupFailed({
                message: "Frame not found",
              });
            const version = `${frame.kind === "image" ? state.imageVersions.get(frame.id) : state.artifacts.frames.get(frame.id)?.hash}-${Bun.hash(state.css.text).toString(16)}`;
            if (key.slice(key.lastIndexOf("|") + 1) !== version)
              return yield* new ServerStartupFailed({
                message:
                  "Preview generation changed; request the current version",
              });
            const output = join(thumbnailDirectory, `${randomUUID()}.png`);
            return yield* Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  fs
                    .remove(output, { force: true })
                    .pipe(Effect.catch(() => Effect.void)),
                );
                const shot = yield* shots.capture(
                  {
                    ...frame,
                    meta: {
                      ...frame.meta,
                      ...frameViewports(frame, width)[0]!,
                    },
                  },
                  output,
                  scale,
                  { emitLayers: false, generation },
                );
                return {
                  height: shot.height,
                  bytes: yield* fs.readFile(output),
                };
              }),
            );
          }),
        )
        .pipe(Semaphore.withPermits(thumbnailPermits, 1)),
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
      const token = url.searchParams.get("g");
      const pinned = token ? yield* project.pinned(token) : undefined;
      if (token && !pinned && !path.startsWith("/shots/"))
        return HttpServerResponse.text("Capture generation expired", {
          status: 410,
        });
      const state = pinned ?? (yield* project.get);
      const all = state.pages.flatMap((page) => page.frames);
      if (path === "/_theme.css")
        return HttpServerResponse.text(
          [state, ...state.retained].find(
            (assets) =>
              assets.css.version === Number(url.searchParams.get("v")),
          )?.css.text ?? state.css.text,
          { contentType: "text/css; charset=utf-8" },
        );
      const gzip = acceptsGzip(request.headers["accept-encoding"]);
      if (path === "/_runtime.js")
        return HttpServerResponse.uint8Array(
          gzip ? runtimeGzipFile : runtimeFile,
          {
            contentType: "text/javascript; charset=utf-8",
            headers: {
              vary: "Accept-Encoding",
              ...(gzip ? { "content-encoding": "gzip" } : {}),
              "cache-control":
                url.searchParams.get("v") === runtimeVersion
                  ? "public, max-age=31536000, immutable"
                  : "no-cache",
            },
          },
        );
      if (
        (path.startsWith("/f/") || path.startsWith("/thumb/")) &&
        (url.searchParams.has("width") || url.searchParams.has("height"))
      ) {
        const input = Object.fromEntries(
          ["width", "height"]
            .filter((key) => url.searchParams.has(key))
            .map((key) => [key, Number(url.searchParams.get(key))]),
        );
        const dimensions = Schema.decodeUnknownResult(
          Schema.Struct({
            width: Schema.optional(PositiveNumber),
            height: Schema.optional(PositiveNumber),
          }),
        )(input);
        if (dimensions._tag === "Failure")
          return HttpServerResponse.text(
            "Viewport width and height must be positive finite numbers",
            { status: 400 },
          );
      }
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
          frameHtml(
            {
              ...frame,
              meta: {
                ...frame.meta,
                ...viewports(
                  frame.meta,
                  Number(url.searchParams.get("width") ?? frame.meta.width),
                )[0]!,
                ...(url.searchParams.has("height")
                  ? { height: Number(url.searchParams.get("height")) }
                  : {}),
              },
            },
            url.searchParams.has("canvas"),
            state,
            token ?? undefined,
            url.searchParams.has("preview"),
          ),
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
            ? [state, ...state.retained, ...(yield* project.pinnedValues)]
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
        const scale = Number(url.searchParams.get("scale") ?? 0.5);
        if (![0.0625, 0.125, 0.25, 0.5, 1].includes(scale))
          return HttpServerResponse.text("Invalid preview scale", {
            status: 400,
          });
        const key = `${JSON.stringify([frame.id, Number(url.searchParams.get("width") ?? frame.meta.width), scale])}|${frame.kind === "image" ? state.imageVersions.get(frame.id) : state.artifacts.frames.get(frame.id)?.hash}-${Bun.hash(state.css.text).toString(16)}`;
        return yield* Cache.get(thumbnails, key).pipe(
          Effect.flatMap((shot) =>
            Effect.gen(function* () {
              thumbnailSizes.delete(key);
              thumbnailSizes.set(key, shot.bytes.byteLength);
              let size = [...thumbnailSizes.values()].reduce(
                (sum, bytes) => sum + bytes,
                0,
              );
              while (size > thumbnailBudget || thumbnailSizes.size > 128) {
                const [oldest, bytes] = thumbnailSizes.entries().next().value!;
                thumbnailSizes.delete(oldest);
                size -= bytes;
                yield* Cache.invalidate(thumbnails, oldest);
              }
              return HttpServerResponse.uint8Array(shot.bytes, {
                contentType: "image/png",
                headers: {
                  "cache-control": "no-cache",
                  "x-framio-height": String(shot.height),
                },
              });
            }),
          ),
          Effect.catch((error) =>
            Cache.invalidate(thumbnails, key).pipe(
              Effect.as(
                HttpServerResponse.text(error.message, {
                  status: error._tag === "BrowserUnavailable" ? 503 : 500,
                }),
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
      const assetKey = uiFiles[path.slice(1)] ? path.slice(1) : "index.html";
      const asset =
        assetKey === "index.html"
          ? gzip
            ? htmlGzip
            : html
          : gzip
            ? uiGzipFiles[assetKey]
            : uiFiles[assetKey];
      return HttpServerResponse.uint8Array(asset!, {
        contentType:
          MIME[assetKey.slice(assetKey.lastIndexOf("."))] ??
          "text/html; charset=utf-8",
        headers: {
          vary: "Accept-Encoding",
          ...(gzip ? { "content-encoding": "gzip" } : {}),
          "cache-control":
            assetKey === "index.html" || assetKey.endsWith(".txt")
              ? "no-cache"
              : "public, max-age=31536000, immutable",
        },
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
  return { info, restart: Deferred.await(restart) };
});
