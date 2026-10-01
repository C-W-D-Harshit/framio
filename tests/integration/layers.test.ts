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
    'import {Rows} from "../../components/Rows";export const meta={name:"Home",width:390,height:844};export default function Frame(){return <div><header data-layer="Header" style={{height:80}}>Home</header><main data-layer="Content" style={{height:900,padding:16}}><section data-layer="Balance card" style={{height:120}}>Balance</section><Rows/></main><footer>Unnamed footer</footer></div>}',
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
  } finally {
    await run("stop");
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);
