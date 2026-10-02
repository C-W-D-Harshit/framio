import { copyFile } from "node:fs/promises";
for (const file of ["install.sh", "install.ps1"]) {
  await copyFile(
    new URL(`../../../${file}`, import.meta.url),
    new URL(`../dist/${file}`, import.meta.url),
  );
}
