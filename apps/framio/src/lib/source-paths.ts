import * as path from "node:path";

export type SourcePaths = Pick<
  typeof path,
  "resolve" | "relative" | "isAbsolute" | "sep"
>;

export function isWithinSourceDirectory(
  directory: string,
  file: string,
  paths: SourcePaths = path,
) {
  const relative = paths.relative(directory, file);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  );
}

export function sourcePathSegments(
  framio: string,
  file: string,
  paths: SourcePaths = path,
) {
  const parts = file.split("/");
  if (
    parts[0] !== "pages" ||
    file.includes("\\") ||
    parts.some((part) => part === ".." || part === "." || part === "") ||
    !/\.(tsx|jsx)$/.test(file)
  )
    return null;
  const segments = parts.map((_, index) =>
    paths.resolve(framio, ...parts.slice(0, index + 1)),
  );
  return isWithinSourceDirectory(segments[0]!, segments.at(-1)!, paths)
    ? segments
    : null;
}

export function relativeSourceFile(file: string) {
  return file.replace(/\\/g, "/").replace(/^.*\/\.framio\//i, "");
}
