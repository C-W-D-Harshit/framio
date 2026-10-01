import { existsSync, readFileSync } from "node:fs";

/**
 * Turns the YAML tokens of .framio/DESIGN.md (Google's DESIGN.md format) into CSS that is applied
 * on top of theme.css, so DESIGN.md is the single source of truth for the design system:
 *
 * - colors.<name>        → --<name> on :root, plus a Tailwind color (bg-<name>, text-<name>...).
 *                          Use shadcn names (background, foreground, primary, muted, border...)
 *                          to restyle every shadcn component.
 * - colors.<name>-dark   → --<name> inside .dark
 * - typography.<name>    → a `type-<name>` utility; body* sets font-sans, display/h1/heading* sets
 *                          font-heading. Google Fonts are loaded automatically.
 * - rounded.<name>       → --radius-<name> (rounded-<name>)
 *
 * spacing and components tokens are guidance for the agent and are not turned into CSS.
 */
export type DesignCss = { imports: string; rules: string };

type Typography = {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string | number;
  lineHeight?: string | number;
  letterSpacing?: string;
  fontFeature?: string;
  fontVariation?: string;
};
type Tokens = {
  colors?: Record<string, string>;
  typography?: Record<string, Typography>;
  rounded?: Record<string, string>;
};

const SYSTEM_FONTS = /^(system-ui|ui-[a-z-]+|-apple-system|sans-serif|serif|monospace|cursive|inherit|helvetica( neue)?|arial|georgia|times( new roman)?|courier( new)?|sf pro.*|sf mono|menlo|monaco|consolas|segoe ui)$/i;

export function readDesignCss(path: string, themeSource: string): DesignCss | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  let tokens: Tokens;
  try {
    tokens = (Bun.YAML.parse(match[1]!) ?? {}) as Tokens;
  } catch (err) {
    throw new Error(`DESIGN.md front matter is not valid YAML: ${(err as Error).message}`);
  }
  if (!isRecord(tokens)) throw new Error("DESIGN.md front matter must be a YAML object");
  for (const group of ["colors", "rounded", "typography"] as const) {
    const values = tokens[group];
    if (values === undefined) continue;
    if (!isRecord(values)) throw new Error(`DESIGN.md ${group} must be a YAML object`);
    for (const [name, value] of Object.entries(values)) {
      if (!ident(name)) throw new Error(`DESIGN.md ${group} contains an empty token name`);
      if (group === "typography") {
        if (!isRecord(value)) throw new Error(`DESIGN.md typography.${name} must be a YAML object`);
        for (const [property, v] of Object.entries(value)) {
          if (typeof v !== "string" && typeof v !== "number") throw new Error(`DESIGN.md typography.${name}.${property} must be a string or number`);
          if (property === "fontFamily" && typeof v !== "string") throw new Error(`DESIGN.md typography.${name}.fontFamily must be a string`);
        }
      } else if (typeof value !== "string" || !value.trim()) throw new Error(`DESIGN.md ${group}.${name} must be a nonempty string`);
    }
  }
  return generate(tokens, themeSource);
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const ident = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

function generate(tokens: Tokens, themeSource: string): DesignCss {
  const lookup = (ref: unknown, visited: string[] = []): string => {
    const s = String(ref);
    const m = /^\{([a-z]+)\.([^}]+)\}$/i.exec(s.trim());
    if (!m) return s;
    const key = `${m[1]}.${m[2]}`;
    if (visited.includes(key)) throw new Error(`DESIGN.md has a circular token reference: ${[...visited, key].join(" -> ")}`);
    const group = (tokens as Record<string, unknown>)[m[1]!];
    if (!isRecord(group) || !Object.hasOwn(group, m[2]!)) throw new Error(`DESIGN.md references an unknown token: ${key}`);
    const value = lookup(group[m[2]!], [...visited, key]);
    return m[1] === "colors" ? `var(--${ident(m[2]!.replace(/-dark$/, ""))})` : value;
  };

  const light: string[] = [];
  const dark: string[] = [];
  const themeInline: string[] = [];
  const seen = new Set<string>();
  for (const [rawName, value] of Object.entries(tokens.colors ?? {})) {
    const isDark = /-dark$/.test(rawName);
    const name = ident(rawName.replace(/-dark$/, ""));
    (isDark ? dark : light).push(`  --${name}: ${lookup(value)};`);
    if (!seen.has(name)) {
      seen.add(name);
      themeInline.push(`  --color-${name}: var(--${name});`);
    }
  }

  for (const [name, value] of Object.entries(tokens.rounded ?? {})) themeInline.push(`  --radius-${ident(name)}: ${lookup(value)};`);

  const fonts = new Map<string, Set<string>>();
  const utilities: string[] = [];
  let sans: string | undefined;
  let heading: string | undefined;
  for (const [rawName, t] of Object.entries(tokens.typography ?? {})) {
    if (!t || typeof t !== "object") continue;
    const name = ident(rawName);
    const family = t.fontFamily ? lookup(t.fontFamily).replace(/^["']|["']$/g, "") : undefined;
    const decls: string[] = [];
    if (family) {
      decls.push(`font-family: ${fontStack(family)};`);
      const weights = fonts.get(family) ?? new Set<string>();
      weights.add(String(t.fontWeight ?? 400));
      fonts.set(family, weights);
      if (!sans && /^body/.test(name)) sans = family;
      if (!heading && /^(display|h1|headline|heading|title)/.test(name)) heading = family;
    }
    if (t.fontSize !== undefined) decls.push(`font-size: ${lookup(t.fontSize)};`);
    if (t.fontWeight !== undefined) decls.push(`font-weight: ${lookup(t.fontWeight)};`);
    if (t.lineHeight !== undefined) decls.push(`line-height: ${lookup(t.lineHeight)};`);
    if (t.letterSpacing !== undefined) decls.push(`letter-spacing: ${lookup(t.letterSpacing)};`);
    if (t.fontFeature) decls.push(`font-feature-settings: ${lookup(t.fontFeature)};`);
    if (t.fontVariation) decls.push(`font-variation-settings: ${lookup(t.fontVariation)};`);
    if (decls.length) utilities.push(`@utility type-${name} {\n  ${decls.join("\n  ")}\n}`);
  }
  sans ??= [...fonts.keys()][0];
  heading ??= sans;
  if (sans) themeInline.push(`  --font-sans: ${fontStack(sans)};`);
  if (heading) themeInline.push(`  --font-heading: ${fontStack(heading)};`);

  // Each family gets its own import so one unknown font never blocks the others.
  const imports = [...fonts]
    .filter(([family]) => !SYSTEM_FONTS.test(family))
    .map(([family, weights]) => {
      const list = [...weights].map(Number).filter(Boolean).sort((a, b) => a - b);
      const wght = list.length ? `:wght@${list.join(";")}` : "";
      const encoded = encodeURIComponent(family).replace(/%20/g, "+");
      return `@import url("https://fonts.googleapis.com/css2?family=${encoded}${wght}&display=swap");`;
    })
    .filter((rule) => !themeSource.includes(rule));

  const rules = [
    "/* Generated from DESIGN.md by framio */",
    light.length && `:root {\n${light.join("\n")}\n}`,
    dark.length && `.dark {\n${dark.join("\n")}\n}`,
    themeInline.length && `@theme inline {\n${themeInline.join("\n")}\n}`,
    ...utilities,
  ].filter(Boolean);
  return { imports: imports.join("\n"), rules: rules.join("\n\n") };
}

function fontStack(family: string) {
  const quoted = /[\s\d]/.test(family) ? `"${family}"` : family;
  const generic = /mono/i.test(family) ? "ui-monospace, monospace" : /serif/i.test(family) && !/sans/i.test(family) ? "ui-serif, Georgia, serif" : "ui-sans-serif, system-ui, sans-serif";
  return `${quoted}, ${generic}`;
}
