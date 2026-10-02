import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  buildLayerTree,
  resolveLayer,
  inspectLayers,
  layerCrop,
  type LayerRecord,
} from "../../src/domain/layers";
import {
  injectLayerSources,
  editLayerSource,
} from "../../src/server/layers/source";
const record = (
  name: string,
  parent: number | null,
  x = 0,
  y = 0,
): LayerRecord => ({
  name,
  parent,
  box: { x, y, width: 100, height: 100 },
  styles: {},
  textOverflow: false,
  interactive: false,
  hasText: false,
  childBoxes: [],
});
const location = (
  text: string,
  file = "/project/.framio/pages/home.tsx",
  index = 0,
) => {
  const injected = injectLayerSources(text, file);
  const matches = [
    ...injected.matchAll(/data-framio-layer-source=\{("(?:\\.|[^"\\])*")\}/g),
  ];
  return JSON.parse(matches[index]![1]!);
};
describe("layers", () => {
  it.effect(
    "builds named ancestry and indexes repeated siblings independently",
    () =>
      Effect.sync(() => {
        const tree = buildLayerTree([
          record("Content", null),
          record("Row", 0),
          record("Amount", 1),
          record("Row", 0),
          record("Amount", 3),
        ]);
        expect(resolveLayer(tree, "Content/Row/Amount")?.path).toBe(
          "Content/Row[1]/Amount",
        );
        expect(resolveLayer(tree, "Content/Row[2]/Amount")?.path).toBe(
          "Content/Row[2]/Amount",
        );
        expect(resolveLayer(tree, "Content/Row[0]")).toBeUndefined();
        expect(resolveLayer(tree, "Missing")).toBeUndefined();
      }),
  );
  it.effect("warns without blocking unnamed frames and root children", () =>
    Effect.sync(() => {
      expect(inspectLayers([], [], 390, 2).warnings).toHaveLength(2);
      const records = [record("Header", null)];
      expect(
        inspectLayers(buildLayerTree(records), records, 390).warnings,
      ).toEqual([]);
    }),
  );
  it.effect(
    "checks overflow, stack gaps, near edges, grid, contrast, and mobile targets",
    () =>
      Effect.sync(() => {
        const r = record("Actions", null);
        r.styles = {
          display: "flex",
          flexDirection: "column",
          paddingTop: "7px",
          color: "rgb(150, 150, 150)",
          effectiveBackground: "rgb(255, 255, 255)",
          fontSize: "16px",
          fontWeight: "400",
        };
        r.textOverflow = true;
        r.hasText = true;
        r.interactive = true;
        r.box = { x: 0, y: 0, width: 30, height: 100 };
        r.childBoxes = [
          { x: 0, y: 0, width: 40, height: 10 },
          { x: 2, y: 18, width: 20, height: 10 },
          { x: 0, y: 45, width: 20, height: 10 },
        ];
        const report = inspectLayers(buildLayerTree([r]), [r], 390);
        expect(report.checks).toHaveLength(7);
        expect(report.checks.every((c) => c.path === "Actions")).toBe(true);
        expect(report.tree[0]?.spacing).toEqual([8, 17]);
        expect(
          inspectLayers(buildLayerTree([r]), [r], 1440).checks.some((c) =>
            c.message.includes("target"),
          ),
        ).toBe(false);
      }),
  );
  it.effect("scales context crops between 1x and 2x without splitting", () =>
    Effect.sync(() => {
      expect(
        layerCrop({ x: 0, y: 0, width: 390, height: 100 }, 390, 900).scale,
      ).toBe(2);
      expect(
        layerCrop({ x: 0, y: 0, width: 1440, height: 900 }, 1440, 900).scale,
      ).toBeCloseTo(1500 / 1440);
      expect(
        layerCrop({ x: 0, y: 0, width: 390, height: 3000 }, 390, 3000).scale,
      ).toBe(1);
    }),
  );
  it.effect("edits only the exact literal among identical names", () =>
    Effect.gen(function* () {
      const text =
        '<div><section data-layer="Card">A</section><section data-layer="Card">B</section></div>';
      const next = yield* editLayerSource(
        text,
        location(text, undefined, 1),
        'Balance "card"',
      );
      expect(next).toBe(
        '<div><section data-layer="Card">A</section><section data-layer="Balance &quot;card&quot;">B</section></div>',
      );
    }),
  );
  it.effect(
    "refuses expressions, stale revisions, ambiguous locations and invalid names",
    () =>
      Effect.gen(function* () {
        const text = "<div data-layer={name} />";
        expect(
          (yield* editLayerSource(text, location(text), "Header").pipe(
            Effect.result,
          ))._tag,
        ).toBe("Failure");
        const literal = '<div data-layer="Header" />';
        const source = location(literal);
        expect(
          (yield* editLayerSource(literal + " ", source, "New").pipe(
            Effect.result,
          ))._tag,
        ).toBe("Failure");
        const token = JSON.parse(source);
        token.start++;
        expect(
          (yield* editLayerSource(literal, JSON.stringify(token), "New").pipe(
            Effect.result,
          ))._tag,
        ).toBe("Failure");
        expect(
          (yield* editLayerSource(literal, source, "Bad/path").pipe(
            Effect.result,
          ))._tag,
        ).toBe("Failure");
      }),
  );
  it.effect(
    "does not expose unsafe duplicate or overriding spread locations",
    () =>
      Effect.sync(() => {
        expect(
          injectLayerSources(
            '<div data-layer="First" data-layer="Second" />',
            "frame.tsx",
          ),
        ).not.toContain("data-framio-layer-source");
        expect(
          injectLayerSources(
            '<div data-layer="First" {...props} />',
            "frame.tsx",
          ),
        ).not.toContain("data-framio-layer-source");
        expect(
          injectLayerSources(
            '<div {...props} data-layer="First" />',
            "frame.tsx",
          ),
        ).toContain("data-framio-layer-source");
      }),
  );
  it.effect(
    "shared components and mapped instances use their producing source",
    () =>
      Effect.gen(function* () {
        const file = "/project/.framio/components/Transactions.tsx";
        const text =
          'export const Rows = () => <>{[1,2,3,4,5].map(i => <div key={i} data-layer="Transaction row">{i}</div>)}</>';
        const source = location(text, file);
        expect(JSON.parse(source).file).toBe(file);
        expect(yield* editLayerSource(text, source, "Payment row")).toBe(
          text.replace(
            'data-layer="Transaction row"',
            'data-layer="Payment row"',
          ),
        );
      }),
  );
});
