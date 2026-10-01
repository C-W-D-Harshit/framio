import { findProjectRoot } from "../lib/paths";

export class CliError extends Error {}

export function requireProject(): string {
  const root = findProjectRoot();
  if (!root) throw new CliError("No .framio found here or in any parent directory. Run `framio init` first.");
  return root;
}
