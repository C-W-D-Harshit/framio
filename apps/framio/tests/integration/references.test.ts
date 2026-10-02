import { expect, test } from "bun:test";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { saveReferenceCapture } from "../../src/commands/references";
import { referenceById } from "../../src/domain/references";
import { projectPaths } from "../../src/lib/paths";
import { imageSize } from "../../src/server/image-size";
import { Screenshots } from "../../src/services/screenshots";

function firstPixel(path: string) {
  const png = readFileSync(path);
  expect(png[24]).toBe(8);
  expect([2, 6]).toContain(png[25]!);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  // Every PNG row filter uses zero for the first pixel's absent neighbours.
  return [...inflateSync(Buffer.concat(chunks)).subarray(1, 4)];
}

test("URL references settle, retain readable viewport size, and reject HTTP failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-reference-test-"));
  let imageRequests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/unavailable")
        return new Response("Unavailable", { status: 503 });
      if (path === "/lazy.svg") {
        imageRequests++;
        return new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',
          { headers: { "content-type": "image/svg+xml" } },
        );
      }
      return new Response(
        `<!doctype html><html><body style="margin:0;min-height:3200px;background:rgb(255,0,0)">
        <h1 style="margin:0;padding:20px">Reference fixture</h1>
        <img id="lazy" style="position:absolute;top:2500px" width="100" height="100" alt="Lazy content">
        <script>
          let ready = false;
          function paint() { document.body.style.background = ready ? (scrollY === 0 ? 'rgb(0,128,0)' : 'rgb(0,0,255)') : 'rgb(255,0,0)'; }
          setTimeout(() => { ready = true; paint(); }, 500);
          addEventListener('scroll', paint);
          const image = document.getElementById('lazy');
          new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) image.src = '/lazy.svg'; }).observe(image);
        </script></body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  const url = server.url.href;
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const shots = yield* Screenshots;
        const viewport = yield* shots.captureUrl(
          url,
          join(root, "viewport.png"),
          600,
          400,
          1,
          true,
        );
        expect(viewport.height).toBe(400);
        expect(imageSize(readFileSync(viewport.path), "png")).toEqual({
          width: 600,
          height: 400,
        });
        expect(firstPixel(viewport.path)).toEqual([0, 128, 0]);
        expect(imageRequests).toBe(0);

        const full = yield* shots.captureUrl(
          url,
          join(root, "full.png"),
          600,
          400,
        );
        expect(full.height).toBe(3200);
        expect(imageSize(readFileSync(full.path), "png")).toEqual({
          width: 600,
          height: 3200,
        });
        expect(firstPixel(full.path)).toEqual([0, 128, 0]);
        expect(imageRequests).toBeGreaterThan(0);

        const reference = {
          ...(yield* referenceById("axis")),
          previewUrl: url,
        };
        const saved = yield* saveReferenceCapture(
          projectPaths(root),
          reference,
          {
            results: [{ frame: url, ...viewport }],
          },
        );
        expect(readFileSync(saved.path)).toEqual(readFileSync(viewport.path));
        expect(JSON.parse(readFileSync(saved.sidecarPath, "utf8")).source).toBe(
          url,
        );

        const failedPath = join(root, "unavailable.png");
        const failed = yield* shots
          .captureUrl(`${url}unavailable`, failedPath, 600, 400, 1, true)
          .pipe(Effect.result);
        expect(failed._tag).toBe("Failure");
        if (failed._tag === "Failure")
          expect(failed.failure.message).toContain("HTTP 503");
        expect(existsSync(failedPath)).toBe(false);
      }).pipe(
        Effect.provide(Screenshots.layer(url)),
        Effect.provide(BunFileSystem.layer),
        Effect.scoped,
      ),
    );
  } finally {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("reference discovery works outside a project and unknown IDs fail before capture", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-reference-cli-"));
  const run = async (args: string[]) => {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../../src/cli.ts"),
        "references",
        ...args,
      ],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  try {
    const listed = await run(["crm", "--json"]);
    expect(listed.code).toBe(0);
    const result = JSON.parse(listed.stdout);
    expect(result.references.map((item: { id: string }) => item.id)).toEqual([
      "axis",
      "dusk-landing-1",
    ]);
    const failed = await run(["--capture", "not-a-reference"]);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('Unknown reference "not-a-reference"');
    expect(existsSync(join(root, ".framio"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
