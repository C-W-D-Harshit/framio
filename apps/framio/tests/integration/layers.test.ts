import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { imageSize } from "../../src/server/image-size";
import type { LayerReport } from "../../src/contracts/layers";
import type { ScreenshotResponse } from "../../src/contracts/requests";
import type { Snapshot } from "../../src/contracts/snapshot";
import type { CaptureEvidence } from "../../src/contracts/evidence";
import { flattenLayers } from "../../src/domain/layers";

test("layer screenshot, inspect and source rename round trips use the live pipeline", async () => {
  const root = mkdtempSync(join(tmpdir(), "framio-layers-"));
  const page = join(root, ".framio/pages/01-test");
  mkdirSync(page, { recursive: true });
  mkdirSync(join(root, ".framio/components"));
  symlinkSync(
    resolve(import.meta.dir, "../../node_modules"),
    join(root, ".framio/node_modules"),
  );
  writeFileSync(
    join(root, ".framio/theme.css"),
    "body{margin:0}*{box-sizing:border-box}",
  );
  const shared = join(root, ".framio/components/Rows.tsx");
  writeFileSync(
    shared,
    'export function Rows(){return <section data-layer="Recent transactions" style={{display:"flex",flexDirection:"column",gap:8}}>{[1,2,3,4,5].map(i=><div key={i} data-layer="Transaction row" style={{height:48}}><span data-layer="Amount">Payment {i}</span></div>)}</section>}',
  );
  const file = join(page, "home.tsx");
  writeFileSync(
    file,
    'import {Rows} from "../../components/Rows";export const meta={name:"Home",width:390,height:844};export default function Frame(){return <div><header data-layer="Header" style={{height:80}}>Home</header><main data-layer="Content" style={{height:900,padding:16}}><section data-layer="Balance card" style={{height:120}}>Balance</section><Rows/></main><footer style={{height:18,lineHeight:"18px"}}>Unnamed footer</footer></div>}',
  );
  writeFileSync(
    join(page, "text.tsx"),
    `export const meta={width:390,height:844};
      const label="A long label with enough words to overflow the narrow available space";
      const clipped={width:120,whiteSpace:"nowrap",overflow:"hidden",margin:0,lineHeight:"20px"};
      export default function Frame(){return <div><section data-layer="Text cases">
        <p id="fits" style={{...clipped,textOverflow:"ellipsis"}}>Fits</p>
        <p id="ellipsis" style={{...clipped,textOverflow:"ellipsis"}}>{label}</p>
        <p id="accidental" style={clipped}>{label}</p>
        <p id="other-accidental" style={clipped}>{label}</p>
        <div id="ancestor-clip" style={{width:80,overflow:"hidden"}}>
          <p id="nested-ellipsis" style={{...clipped,width:160,textOverflow:"ellipsis"}}>{label}</p>
        </div>
        <div id="harmless-ancestor" style={{width:240,overflow:"hidden"}}>
          <p id="safe-nested-ellipsis" style={{...clipped,textOverflow:"ellipsis"}}>{label}</p>
        </div>
        <p id="inline-container" style={{...clipped,textOverflow:"ellipsis"}}><span id="inline-label">{label}</span></p>
        <div id="invalid-ellipsis" style={{width:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          <p id="block-label" style={{margin:0}}>{label}</p>
        </div>
        <p id="scroll" style={{...clipped,overflowX:"auto"}}>{label}</p>
        <p id="clamp" style={{width:120,margin:0,lineHeight:"20px",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{label}</p>
      </section></div>}`,
  );
  const run = async (...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, "../../src/cli.ts"), ...args],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  try {
    expect((await run("start", "--background", "--no-open")).code).toBe(0);
    const info = JSON.parse(
      readFileSync(join(root, ".framio/.state/server.json"), "utf8"),
    );
    const api = async (path: string, payload: unknown) => {
      const response = await fetch(info.url + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<any>;
    };
    const screenshot = await run("screenshot", "01-test/home");
    expect(screenshot.code).toBe(0);
    expect(screenshot.stdout).toContain("Transaction row[5]");
    expect(screenshot.stdout).toMatch(/generation \d+, revision [a-f0-9]{24}/);
    expect(screenshot.stdout).toMatch(
      /screenshots\/history\/[a-f0-9-]+\.png.*capture [a-f0-9-]+/,
    );
    expect(screenshot.stderr).toContain("missing data-layer");
    const shots = join(root, ".framio/.state/screenshots/01-test");
    expect(imageSize(readFileSync(join(shots, "home.png")), "png")).toEqual({
      width: 390,
      height: 998,
    });
    const header = imageSize(
      readFileSync(join(shots, "home.layers/01-Header.png")),
      "png",
    );
    expect(header?.width).toBe(780);
    expect(header?.height).toBe(176);
    const snapshot = (await (
      await fetch(info.url + "/api/project")
    ).json()) as Snapshot;
    const captured = (await api("/api/screenshot", {
      frames: ["01-test/home"],
      width: 780,
      scale: 2,
    })) as typeof ScreenshotResponse.Type;
    const full = captured.results[0]!;
    expect(full.error).toBeNull();
    expect(full.generation).toBeGreaterThan(0);
    expect(full.revision).toBe(
      snapshot.pages[0]!.frames.find((frame) => frame.id === "01-test/home")
        ?.revision,
    );
    expect(full.contextRevision).toBe(snapshot.evidenceContextRevision);
    expect(full.viewportWidth).toBe(780);
    expect(full.path).toEndWith("home@780.png");
    expect(full.captureId).toMatch(/^[a-f0-9-]+$/);
    expect(full.archivePath).toEndWith(`history/${full.captureId}.png`);
    expect(imageSize(readFileSync(full.archivePath!), "png")).toEqual({
      width: 1560,
      height: 1996,
    });
    const headerCapture = full.crops!.find((crop) => crop.layer === "Header")!;
    expect(headerCapture.viewportWidth).toBe(780);
    expect(headerCapture.captureId).toMatch(/^[a-f0-9-]+$/);
    expect(headerCapture.captureId).not.toBe(full.captureId);
    expect(headerCapture.archivePath).toEndWith(
      `history/${headerCapture.captureId}.png`,
    );
    const captureRecords = JSON.parse(
      readFileSync(join(root, ".framio/.state/captures.json"), "utf8"),
    ) as CaptureEvidence[];
    expect(
      captureRecords.find((record) => record.id === full.captureId),
    ).toMatchObject({
      generation: full.generation,
      revision: full.revision,
      viewportWidth: 780,
      width: 1560,
      height: 1996,
    });
    expect(
      captureRecords.find((record) => record.id === headerCapture.captureId),
    ).toMatchObject({
      generation: full.generation,
      revision: full.revision,
      viewportWidth: 780,
      layer: "Header",
      width: headerCapture.width,
      height: headerCapture.height,
    });
    const crop = await run(
      "screenshot",
      "01-test/home",
      "--layer",
      "Content/Recent transactions/Transaction row[2]",
      "--layer",
      "Header",
    );
    expect(crop.code).toBe(0);
    expect(crop.stdout).toContain("Transaction row[2]");
    expect(crop.stdout).toContain("Capture 01-test/home at 390px: generation");
    expect(crop.stdout).toMatch(/viewport 390px, capture [a-f0-9-]+/);
    expect(crop.stdout).toMatch(/screenshots\/history\/[a-f0-9-]+\.png/);
    const scaled = imageSize(
      readFileSync(join(shots, "home.layers/02-Content.png")),
      "png",
    )!;
    expect(
      Math.abs(Math.max(scaled.width, scaled.height) - 1500),
    ).toBeLessThanOrEqual(2);
    writeFileSync(
      join(page, "long.tsx"),
      'export const meta={width:390,height:844};export default function Frame(){return <div><section data-layer="Tall" style={{height:2000}}>Tall layer</section></div>}',
    );
    expect((await run("screenshot", "01-test/long")).code).toBe(0);
    expect(
      imageSize(readFileSync(join(shots, "long.layers/01-Tall.png")), "png"),
    ).toEqual({ width: 390, height: 2000 });
    const wider = await api("/api/inspect", {
      frame: "01-test/home",
      width: 780,
    });
    expect(wider.report.width).toBe(780);
    expect(wider.report.tree[0].box.width).toBe(780);
    const widerCli = await run("inspect", "01-test/home", "--width", "780");
    expect(widerCli.code).toBe(0);
    expect(JSON.parse(widerCli.stdout).width).toBe(780);
    expect((await run("inspect", "01-test/home", "--width", "1.5")).code).toBe(
      1,
    );
    const invalidWidth = await fetch(info.url + "/api/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frame: "01-test/home", width: 1.5 }),
    });
    expect(invalidWidth.status).toBe(400);
    const inspected = await run(
      "inspect",
      "01-test/home",
      "--layer",
      "Content/Recent transactions",
    );
    expect(inspected.code).toBe(0);
    const report = JSON.parse(inspected.stdout) as LayerReport;
    expect(report.tree[0]?.children).toHaveLength(5);
    expect(report.width).toBe(390);
    const all = (await api("/api/inspect", { frame: "01-test/home" }))
      .report as LayerReport;
    const nodes = flattenLayers(all.tree);
    const headerNode = nodes.find((n) => n.name === "Header")!;
    const rowNode = nodes.find((n) => n.name === "Transaction row")!;
    expect(
      (
        await api("/api/layers/rename", {
          source: headerNode.source,
          name: "Account header",
        })
      ).ok,
    ).toBe(true);
    expect(readFileSync(file, "utf8")).toContain('data-layer="Account header"');
    expect(
      (
        await api("/api/layers/rename", {
          source: rowNode.source,
          name: "Payment row",
        })
      ).ok,
    ).toBe(true);
    expect(readFileSync(shared, "utf8")).toContain('data-layer="Payment row"');
    const updated = await run("inspect", "01-test/home");
    expect(updated.code).toBe(0);
    const updatedReport = JSON.parse(updated.stdout) as LayerReport;
    expect(
      flattenLayers(updatedReport.tree).filter((n) => n.name === "Payment row"),
    ).toHaveLength(5);
    const updatedCapture = (await api("/api/screenshot", {
      frames: ["01-test/home"],
      layers: ["Account header"],
      width: 780,
    })) as typeof ScreenshotResponse.Type;
    expect(updatedCapture.results[0]?.error).toBeNull();
    expect(updatedCapture.results[0]?.revision).not.toBe(full.revision);
    expect(updatedCapture.results[0]?.generation).toBeGreaterThan(
      full.generation!,
    );
    expect(updatedCapture.results[0]?.captureId).toBeUndefined();
    expect(updatedCapture.results[0]?.crops?.[0]?.captureId).toMatch(
      /^[a-f0-9-]+$/,
    );
    expect(updatedCapture.results[0]?.crops?.[0]?.viewportWidth).toBe(780);
    expect(
      (
        await api("/api/layers/rename", {
          source: headerNode.source,
          name: "Stale",
        })
      ).ok,
    ).toBe(false);
    expect(
      (await run("screenshot", "01-test/home", "--layer", "Missing")).code,
    ).toBe(1);
    const diagnostics = JSON.parse(
      readFileSync(join(root, ".framio/.state/errors.json"), "utf8"),
    );
    expect(diagnostics.errors).toEqual([]);
    expect(diagnostics.warnings[0]?.frame).toBe("01-test/home");
    const inspectedText = await api("/api/inspect", { frame: "01-test/text" });
    expect(inspectedText.error).toBeUndefined();
    expect(inspectedText.report).toBeDefined();
    const textReport = inspectedText.report as LayerReport;
    const overflowChecks = textReport.checks.filter((check) => check.overflow);
    expect(overflowChecks.every((check) => check.path === "Text cases")).toBe(
      true,
    );
    expect(
      overflowChecks.some(
        (check) => check.overflow?.element.selector === "#root #fits",
      ),
    ).toBe(false);
    const ellipsis = overflowChecks.find(
      (check) => check.overflow?.element.selector === "#root #ellipsis",
    );
    expect(ellipsis?.severity).toBe("warning");
    expect(ellipsis?.overflow?.kind).toBe("ellipsis");
    expect(ellipsis?.overflow?.excess).toBeGreaterThan(1);
    expect(ellipsis?.overflow?.actual).toBeGreaterThan(
      ellipsis?.overflow?.available ?? 0,
    );
    expect(ellipsis?.overflow?.element.tag).toBe("p");
    expect(ellipsis?.overflow?.element.text).toContain("A long label");
    for (const id of ["accidental", "other-accidental"])
      expect(
        overflowChecks.find(
          (check) => check.overflow?.element.selector === `#root #${id}`,
        )?.severity,
      ).toBe("error");
    const nested = overflowChecks.filter(
      (check) => check.overflow?.element.selector === "#root #nested-ellipsis",
    );
    expect(
      nested.some(
        (check) =>
          check.severity === "warning" &&
          check.overflow?.container.selector === "#root #nested-ellipsis",
      ),
    ).toBe(true);
    const safeNested = overflowChecks.filter(
      (check) =>
        check.overflow?.element.selector === "#root #safe-nested-ellipsis",
    );
    expect(safeNested).toHaveLength(1);
    expect(safeNested[0]?.severity).toBe("warning");
    expect(
      overflowChecks.find(
        (check) => check.overflow?.element.selector === "#root #inline-label",
      )?.severity,
    ).toBe("warning");
    const blockLabel = overflowChecks.filter(
      (check) => check.overflow?.element.selector === "#root #block-label",
    );
    expect(blockLabel.length).toBeGreaterThan(0);
    expect(blockLabel.every((check) => check.severity === "error")).toBe(true);
    expect(
      nested.some(
        (check) =>
          check.severity === "error" &&
          check.overflow?.container.selector === "#root #ancestor-clip",
      ),
    ).toBe(true);
    expect(
      overflowChecks.find(
        (check) => check.overflow?.element.selector === "#root #scroll",
      )?.overflow?.kind,
    ).toBe("scroll");
    expect(
      overflowChecks.find(
        (check) =>
          check.overflow?.element.selector === "#root #clamp" &&
          check.overflow.axis === "vertical",
      )?.severity,
    ).toBe("warning");
  } finally {
    await run("stop");
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
