import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("update is the primary command and upgrade accepts the same flags", async () => {
  for (const command of ["update", "upgrade"]) {
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(import.meta.dir, "../../src/cli.ts"),
        command,
        "--help",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(error).not.toContain("Unknown subcommand");
    for (const flag of [
      "--check",
      "--download",
      "--install",
      "--rollback",
      "--status",
    ])
      expect(output).toContain(flag);
    expect(output).toContain("without installing");
  }
});
