import { join } from "node:path";

// Keep browser tests in separate processes so Bun/Puppeteer stack traces stay reliable.
const directory = join(import.meta.dir, "../tests/integration");
for (const file of [...new Bun.Glob("*.test.ts").scanSync(directory)].sort()) {
  const child = Bun.spawn([process.execPath, "test", join(directory, file)], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}
