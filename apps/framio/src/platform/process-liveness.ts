import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import * as Predicate from "effect/Predicate";
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return Predicate.hasProperty(cause, "code") && cause.code === "EPERM";
  }
}
/** A changed birth identity proves the recorded owner exited even if its PID was reused. */
export function processBirth(pid: number): string | null {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
    }
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
        ],
        { encoding: "utf8", timeout: 5000, maxBuffer: 8192, windowsHide: true },
      );
      return result.status === 0 ? result.stdout.trim() || null : null;
    }
    const result = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1000,
      maxBuffer: 8192,
    });
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}
