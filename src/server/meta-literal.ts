import { parseExpressionAt, type Expression } from "acorn";
/** Parses data only. Calls, getters, spreads and variable references never execute. */
function literal(node: Expression): unknown {
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string" || typeof node.value === "number" || typeof node.value === "boolean" || node.value === null) return node.value;
      break;
    case "TemplateLiteral":
      if (node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? "";
      break;
    case "UnaryExpression": {
      const value = literal(node.argument);
      if (typeof value === "number" && (node.operator === "-" || node.operator === "+")) return node.operator === "-" ? -value : value;
      break;
    }
    case "ArrayExpression": return node.elements.map(value => {
      if (!value || value.type === "SpreadElement") throw new Error("meta arrays must contain literal values");
      return literal(value);
    });
    case "ObjectExpression": {
      const entries = node.properties.map(property => {
        if (property.type !== "Property" || property.kind !== "init" || property.method || property.computed || property.shorthand) throw new Error("meta must use literal object properties");
        const key = property.key.type === "Identifier" ? property.key.name : literal(property.key);
        if (typeof key !== "string" && typeof key !== "number") throw new Error("Invalid meta property name");
        return [String(key), literal(property.value)] as const;
      });
      return Object.fromEntries(entries);
    }
  }
  throw new Error("meta must contain literal data; expressions and references are unsupported");
}
export function parseMetaLiteral(source: string, offset: number): unknown {
  const node = parseExpressionAt(source, offset, { ecmaVersion: "latest" });
  if (node.type !== "ObjectExpression") throw new Error("meta must be an object literal");
  return literal(node);
}
