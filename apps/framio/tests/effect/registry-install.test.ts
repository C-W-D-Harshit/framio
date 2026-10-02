import { describe, expect, it } from "@effect/vitest";
import { registryReceipt } from "../../src/domain/registry-install";

const observed = (
  before: string | null,
  after: string | null,
  preserve = true,
) => ({
  completed: true,
  error: null,
  files: [
    { path: "components/ui/button.tsx", before, after, preserve, issue: null },
  ],
});

describe("registry receipt policy", () => {
  it("rejects an existing source changed without overwrite", () => {
    const result = registryReceipt(observed("custom", "upstream"), false);
    expect(result.complete).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.files[0]?.reason).toContain("Existing file changed");
  });

  it("allows explicit overwrite and supplemental config updates", () => {
    for (const [overwrite, preserve] of [
      [true, true],
      [false, false],
    ] as const) {
      const result = registryReceipt(
        observed("before", "after", preserve),
        overwrite,
      );
      expect(result.complete).toBe(true);
      expect(result.installed).toBe(1);
      expect(result.files[0]?.reason).toBe("Existing file updated.");
    }
  });

  it("retains partial output counts without claiming completion", () => {
    const result = registryReceipt(
      { ...observed(null, "created"), completed: false },
      false,
    );
    expect(result.complete).toBe(false);
    expect(result.installed).toBe(1);
  });

  it("marks expected missing files as failed and retains installer errors", () => {
    const result = registryReceipt(
      { ...observed(null, null), error: "Installer failed" },
      false,
    );
    expect(result.complete).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.error).toBe("Installer failed");
    expect(result.files[0]?.reason).toBe("Expected file was not installed.");
  });

  it("distinguishes preserved source from unchanged configuration", () => {
    expect(
      registryReceipt(observed("same", "same"), false).files[0]?.reason,
    ).toBe("Existing file preserved.");
    expect(
      registryReceipt(observed("same", "same", false), false).files[0]?.reason,
    ).toBe("File is unchanged.");
  });
});
