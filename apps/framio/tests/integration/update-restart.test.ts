import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const appRoot = resolve(import.meta.dir, "../..");
// Resolve imports in the workspace before writing an owner into a temp directory.
const ownerImports = {
  effect: Bun.resolveSync("effect", appRoot),
  platformBun: Bun.resolveSync("@effect/platform-bun", appRoot),
  http: Bun.resolveSync("effect/http", appRoot),
};
const supervisor = resolve(
    import.meta.dir,
    "../../src/services/session-supervisor.ts",
  ),
  registry = resolve(import.meta.dir, "../../src/services/server-registry.ts");
const updaterStorage = resolve(
  import.meta.dir,
  "../../src/platform/update-storage.ts",
);
const fixtureSource = `
import {mkdirSync,writeFileSync,rmSync,realpathSync} from "node:fs";
const root=realpathSync(process.argv[2]),version=process.argv[3],state=root+"/.framio/.state"; mkdirSync(state,{recursive:true});
const host=process.argv[process.argv.indexOf("--host")+1]; if(host!=="127.0.0.1") process.exit(41);
const server=Bun.serve({hostname:host,port:Number(process.env.FRAMIO_SERVER_PORT??0),fetch(req){
 if(new URL(req.url).pathname==="/api/health") return Response.json({ok:true,root,pid:process.pid,protocol:"framio-v4-1",version});
 if(new URL(req.url).pathname==="/restart") {writeFileSync(state+"/restart.json",JSON.stringify({phase:"requested",port:server.port,version:"2.0.0",error:null})); queueMicrotask(()=>finish(75)); return Response.json({ok:true});}
 return Response.json({ok:true});
}});
writeFileSync(state+"/server.lock",String(process.pid)); writeFileSync(state+"/server.json",JSON.stringify({pid:process.pid,host,port:server.port,url:"http://127.0.0.1:"+server.port,version,supervisorPid:Number(process.env.FRAMIO_SUPERVISOR_PID),startedAt:new Date().toISOString()}));
async function finish(code){ await server.stop(true); rmSync(state+"/server.json",{force:true}); rmSync(state+"/server.lock",{force:true}); process.exit(code); }
process.on("SIGTERM",()=>void finish(0));
`;
async function waitFor<A>(read: () => A | null, ms = 10000): Promise<A> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = read();
    if (result) return result;
    await Bun.sleep(30);
  }
  throw new Error("Fixture readiness timed out");
}
for (const aliased of [false, true])
  for (const mode of ["foreground", "background", "recovery"])
    test(`${aliased ? "aliased" : "canonical"} ${mode} supervisor retains port and project identity while other projects run`, async () => {
      const background = mode === "background",
        recovery = mode === "recovery";
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "framio-restart-"))),
        fixture = join(dir, "server.ts"),
        target = join(dir, "installed"),
        program = join(dir, "owner.ts");
      writeFileSync(fixture, fixtureSource);
      writeFileSync(
        target,
        `#!/bin/sh\nif [ "$1" = --version ]; then printf 'framio 2.0.0\\n'; else shift; root="$1"; shift; ${recovery ? "exit 42" : `exec '${process.execPath}' '${fixture}' "$root" 2.0.0 "$@"`}; fi\n`,
      );
      chmodSync(target, 0o755);
      if (recovery) {
        const { openUpdateStorage, installationIdentity } =
          await import("../../src/platform/update-storage");
        const { emptyUpdate } = await import("../../src/contracts/update");
        const id = installationIdentity(target).id,
          data = join(dir, "updates");
        mkdirSync(join(data, id), { recursive: true });
        const backup = join(data, id, "previous");
        writeFileSync(
          backup,
          `#!/bin/sh\nif [ "$1" = --version ]; then printf 'framio 1.0.0\\n'; else shift; root="$1"; shift; exec '${process.execPath}' '${fixture}' "$root" 1.0.0 "$@"; fi\n`,
        );
        chmodSync(backup, 0o755);
        const db = openUpdateStorage(data);
        db.write(`installation:${id}`, {
          ...emptyUpdate,
          previousVersion: "1.0.0",
        });
        db.close();
      }
      const canonicalRoots = [join(dir, "a"), join(dir, "b")];
      for (const root of canonicalRoots)
        mkdirSync(join(root, ".framio/.state"), { recursive: true });
      const roots = canonicalRoots.map((root) => {
        if (!aliased) return root;
        const alias = root + "-alias";
        symlinkSync(root, alias, "dir");
        return alias;
      });
      writeFileSync(
        program,
        `import {Effect,Layer} from ${JSON.stringify(ownerImports.effect)}; import {BunServices,BunRuntime} from ${JSON.stringify(ownerImports.platformBun)}; import {FetchHttpClient} from ${JSON.stringify(ownerImports.http)}; import {supervise} from ${JSON.stringify(supervisor)}; import {ServerRegistry} from ${JSON.stringify(registry)}; supervise(process.argv[2],false,{host:"127.0.0.1",readinessTimeout:"2 seconds",command:[process.execPath,${JSON.stringify(fixture)},process.argv[2],"1.0.0","--host","127.0.0.1"],updater:{target:${JSON.stringify(target)},directory:${JSON.stringify(join(dir, "updates"))},development:false,version:"1.0.0",platform:"darwin-arm64"}}).pipe(Effect.scoped,Effect.provide(ServerRegistry.layer.pipe(Layer.provideMerge(Layer.mergeAll(BunServices.layer,FetchHttpClient.layer)))),BunRuntime.runMain);`,
      );
      const spawnOwner = (root: string) =>
        Bun.spawn([process.execPath, program, root], {
          cwd: appRoot,
          env: {
            ...process.env,
            NODE_PATH: "",
          },
          stdout: "pipe",
          stderr: "pipe",
          detached: background,
        });
      const captureOutput = (child: ReturnType<typeof spawnOwner>) => ({
        stdout: new Response(child.stdout).text(),
        stderr: new Response(child.stderr).text(),
      });
      const children = [spawnOwner(roots[0]!)];
      const output = children.map(captureOutput);
      try {
        const read = (root: string) => {
          try {
            return JSON.parse(
              readFileSync(join(root, ".framio/.state/server.json"), "utf8"),
            );
          } catch {
            return null;
          }
        };
        const first = await waitFor(() => read(roots[0]!));
        // Wait for the first owner before starting another cold Bun process.
        const second = spawnOwner(roots[1]!);
        children.push(second);
        output.push(captureOutput(second));
        const other = await waitFor(() => read(roots[1]!));
        await fetch(first.url + "/restart").catch(() => {});
        // Read after lock release so a server scoped to the lock cannot pass by racing cleanup.
        await waitFor(() => {
          try {
            const phase = JSON.parse(
              readFileSync(
                join(roots[0]!, ".framio/.state/restart.json"),
                "utf8",
              ),
            ).phase;
            return phase === (recovery ? "recovered" : "ready") ? true : null;
          } catch {
            return null;
          }
        });
        const { openUpdateStorage, installationIdentity } =
          await import("../../src/platform/update-storage");
        const storage = openUpdateStorage(join(dir, "updates"));
        try {
          const key = `installation:${installationIdentity(target).id}`;
          await waitFor(() => (!storage.owned(key) ? true : null));
        } finally {
          storage.close();
        }
        const replacement = await waitFor(() => {
          const info = read(roots[0]!);
          return info &&
            info.pid !== first.pid &&
            info.version === (recovery ? "1.0.0" : "2.0.0")
            ? info
            : null;
        });
        expect(replacement.port).toBe(first.port);
        expect(first.host).toBe("127.0.0.1");
        expect(replacement.host).toBe(first.host);
        expect(replacement.supervisorPid).toBe(children[0]!.pid);
        const health = await (await fetch(first.url + "/api/health")).json();
        expect(health.root).toBe(canonicalRoots[0]!);
        expect(health.version).toBe(recovery ? "1.0.0" : "2.0.0");
        expect(read(roots[1]!).pid).toBe(other.pid);
        expect(children[0]!.exitCode).toBeNull();
        await waitFor(() =>
          JSON.parse(
            readFileSync(
              join(roots[0]!, ".framio/.state/restart.json"),
              "utf8",
            ),
          ).phase === (recovery ? "recovered" : "ready")
            ? true
            : null,
        );
        children[0]!.kill("SIGINT");
        await children[0]!.exited;
        expect(existsSync(join(roots[0]!, ".framio/.state/server.lock"))).toBe(
          false,
        );
      } catch (error) {
        for (const child of children)
          if (child.exitCode === null) child.kill("SIGTERM");
        await Promise.all(children.map((child) => child.exited));
        const diagnostics = await Promise.all(
          output.map(
            async (streams, index) =>
              `Project ${roots[index]} exited ${children[index]!.exitCode}:\n${await streams.stdout}\n${await streams.stderr}`,
          ),
        );
        throw new Error(`${String(error)}\n${diagnostics.join("\n")}`);
      } finally {
        for (const child of children) {
          if (child.exitCode === null) child.kill("SIGTERM");
          await child.exited;
        }
        rmSync(dir, { recursive: true, force: true });
      }
    }, 25000);
