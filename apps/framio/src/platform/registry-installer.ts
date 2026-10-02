// Pin the adapter to the registry API and path helpers validated by our tests.
export const SHADCN_VERSION = "4.21.1";
export const SHADCN_PACKAGE = `shadcn@${SHADCN_VERSION}`;

// This subprocess isolates the upstream Node installer from Framio's Effect runtime.
export const REGISTRY_INSTALLER_SOURCE = String.raw`
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const request = JSON.parse(process.argv[2]);
const observation = { completed: false, error: null, files: [] };
const targets = [];
const root = realpathSync(process.cwd());
const digest = (path) => existsSync(path)
  ? createHash("sha256").update(readFileSync(path)).digest("hex")
  : null;
const validateDestination = (destination) => {
  const path = resolve(destination);
  const label = relative(process.cwd(), path);
  if (isAbsolute(label) || label === ".." || label.startsWith("../") || label.startsWith("..\\"))
    throw new Error("Registry destination is outside .framio: " + label);
  let ancestor = path;
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = dirname(ancestor);
  const actual = relative(root, realpathSync(ancestor));
  if (isAbsolute(actual) || actual === ".." || actual.startsWith("../") || actual.startsWith("..\\"))
    throw new Error("Registry destination follows a link outside .framio: " + label);
  return { path, label };
};

try {
  const executable = process.env.PATH.split(delimiter)
    .map((directory) => process.platform === "win32" ? join(directory, "../shadcn/dist/index.js") : join(directory, "shadcn"))
    .find((path) => existsSync(path));
  if (!executable) throw new Error("The pinned shadcn package was not available.");
  const entry = realpathSync(executable);
  const metadata = JSON.parse(readFileSync(join(dirname(entry), "../package.json"), "utf8"));
  if (metadata.name !== "shadcn" || metadata.version !== request.version)
    throw new Error("The registry adapter requires shadcn " + request.version + ".");
  const require = createRequire(entry);
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  const { getConfig, getWorkspaceConfig } = await load("@shadcn/registry/internal/utils/get-config");
  const { getProjectInfo } = await load("@shadcn/registry/internal/utils/get-project-info");
  const { resolveRegistryItems } = await load("shadcn/registry");
  const { addComponents } = await load("@shadcn/registry/internal/utils/add-components");
  const { findCommonRoot, resolveFilePath } = await load("@shadcn/registry/internal/utils/updaters/update-files");
  const { findExistingEnvFile } = await load("@shadcn/registry/internal/utils/env-helpers");
  const { findLayoutFile } = await load("@shadcn/registry/internal/utils/updaters/update-fonts");
  const config = await getConfig(process.cwd());
  if (!config) throw new Error("components.json is missing or invalid.");
  for (const path of Object.values(config.resolvedPaths)) {
    if (path) validateDestination(path);
  }
  const workspace = await getWorkspaceConfig(config);
  if (workspace && Object.values(workspace).some((entry) => entry && resolve(entry.resolvedPaths.cwd) !== resolve(process.cwd())))
    throw new Error("Registry workspace destinations must stay inside .framio.");
  // Resolve the graph before framework filtering so imported pages remain available.
  const tree = await resolveRegistryItems(request.items, {
    config: { ...config, resolvedPaths: { ...config.resolvedPaths, cwd: "" } },
  });
  if (!tree) throw new Error("The registry returned no installation plan.");
  if (!(tree.files ?? []).some((file) => file.content) &&
      !(tree.dependencies?.length || tree.devDependencies?.length || tree.fonts?.length ||
        Object.keys(tree.css ?? {}).length || Object.keys(tree.cssVars ?? {}).length ||
        Object.keys(tree.envVars ?? {}).length || Object.keys(tree.tailwind?.config ?? {}).length))
    throw new Error("The registry items have no installable files, dependencies, or styles.");
  const info = await getProjectInfo(process.cwd());
  for (const file of tree.files ?? []) {
    // Imported app pages are source files to adapt, not Framio frame entry points.
    if (file.type === "registry:page" && file.target && !file.target.startsWith("@") && !file.target.startsWith("~/"))
      file.target = "~/" + file.target;
  }
  const seen = new Set();
  for (const [index, file] of (tree.files ?? []).entries()) {
    if (!file.content) continue;
    let path = resolveFilePath(file, config, {
      isSrcDir: info?.isSrcDir,
      framework: info?.framework.name,
      commonRoot: findCommonRoot((tree.files ?? []).map((entry) => entry.path), file.path),
      fileIndex: index,
    });
    if (!path) throw new Error("No installation destination for " + file.path);
    if (!config.tsx) path = path.replace(/\.tsx?$/, (extension) => extension === ".tsx" ? ".jsx" : ".js");
    const { label } = validateDestination(path);
    if (seen.has(path)) continue;
    seen.add(path);
    targets.push({ path, label, before: digest(path), preserve: true });
  }
  const supplemental = [
    join(process.cwd(), "package.json"),
    join(process.cwd(), "components.json"),
    config.resolvedPaths.tailwindCss,
    config.resolvedPaths.tailwindConfig,
    ...(Object.keys(tree.envVars ?? {}).length ? [findExistingEnvFile(process.cwd()) ?? join(process.cwd(), ".env.local")] : []),
    ...(tree.fonts?.length && info ? [await findLayoutFile(config, info)] : []),
    ...["bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "deno.lock"].map((name) => join(process.cwd(), name)),
  ].filter(Boolean);
  for (const destination of supplemental) {
    const { path, label } = validateDestination(destination);
    if (seen.has(path)) continue;
    seen.add(path);
    targets.push({ path, label, before: digest(path), preserve: false });
  }
  await addComponents(request.items, config, {
    resolvedTree: tree,
    interactive: false,
    overwrite: request.overwrite,
    overwriteCssVars: request.overwrite,
    silent: !request.verbose,
  });
  observation.completed = true;
} catch (error) {
  observation.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  for (const target of targets) {
    let after = null;
    let issue = null;
    try { after = digest(target.path); }
    catch (error) { issue = "Could not verify installed file: " + error.message; }
    if (target.preserve || after !== target.before || issue)
      observation.files.push({ path: target.label, before: target.before, after, issue, preserve: target.preserve });
  }
  writeFileSync(request.receipt, JSON.stringify(observation));
}
`;
