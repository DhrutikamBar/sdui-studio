export type SduiValue = string | number | boolean | null | SduiValue[] | { [key: string]: SduiValue };

export interface FigmaLikePaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number };
}

export interface FigmaLikeNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  characters?: string;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  children?: FigmaLikeNode[];
  fills?: FigmaLikePaint[];
  cornerRadius?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
}

export interface ConversionWarning {
  nodeId: string;
  nodeName: string;
  message: string;
}

export interface ConversionResult {
  document: SduiValue;
  warnings: ConversionWarning[];
}

const supportedOverrides = new Set(["column", "row", "box", "button", "repeater", "text"]);

export function convertSelectedNode(node: FigmaLikeNode): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const component = convertNode(node, warnings);
  return {
    document: component ?? {
      type: "column",
      props: { padding: "md" },
      children: [],
    },
    warnings,
  };
}

function convertNode(
  node: FigmaLikeNode,
  warnings: ConversionWarning[],
): { [key: string]: SduiValue } | null {
  if (node.visible === false) {
    warnings.push(warning(node, "Hidden layer was omitted."));
    return null;
  }

  const directive = parseDirective(node.name);
  const binding = parseBinding(node.name);
  const route = parseRoute(node.name);

  if (directive?.kind === "repeater") {
    const template = childrenOf(node, warnings);
    return {
      type: "repeater",
      props: {
        items: "{{" + directive.value + "}}",
        ...(styleOf(node, warnings)),
      },
      children: template,
    };
  }

  if (node.type === "TEXT" || directive?.kind === "text") {
    const value = binding ? "{{" + binding + "}}" : node.characters?.trim() || "";
    if (!value) warnings.push(warning(node, "Empty text layer was converted to an empty text value."));
    return {
      type: "text",
      props: {
        value,
        ...(styleOf(node, warnings)),
      },
    };
  }

  if (directive?.kind === "button") {
    const label = findFirstText(node) || directive.value || "Button";
    return {
      type: "button",
      props: {
        text: label,
        ...(styleOf(node, warnings)),
      },
      action: route
        ? { type: "navigate", target: route }
        : { type: "analytics", target: normalizeName(node.name) },
    };
  }

  if (isUnsupportedVisual(node.type)) {
    warnings.push(warning(node, `${node.type} needs an exported asset or a supported SDK image source, so it was omitted.`));
    return null;
  }

  const type = directive?.kind && supportedOverrides.has(directive.kind)
    ? directive.kind
    : containerTypeFor(node);
  const children = childrenOf(node, warnings);

  if (!children.length && !isContainer(node)) {
    warnings.push(warning(node, `Unsupported layer type ${node.type} was omitted.`));
    return null;
  }

  return {
    type,
    props: styleOf(node, warnings),
    ...(children.length ? { children } : {}),
  };
}

function childrenOf(node: FigmaLikeNode, warnings: ConversionWarning[]) {
  return (node.children ?? [])
    .map((child) => convertNode(child, warnings))
    .filter((child): child is { [key: string]: SduiValue } => child !== null);
}

function containerTypeFor(node: FigmaLikeNode) {
  if (node.layoutMode === "HORIZONTAL") return "row";
  if (node.layoutMode === "VERTICAL") return "column";
  return "box";
}

function isContainer(node: FigmaLikeNode) {
  return ["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION", "GROUP"].includes(node.type);
}

function isUnsupportedVisual(type: string) {
  return ["VECTOR", "STAR", "LINE", "ELLIPSE", "POLYGON", "SLICE", "BOOLEAN_OPERATION"].includes(type);
}

function styleOf(node: FigmaLikeNode, warnings: ConversionWarning[]) {
  const props: { [key: string]: SduiValue } = {};
  const padding = Math.max(node.paddingTop ?? 0, node.paddingRight ?? 0, node.paddingBottom ?? 0, node.paddingLeft ?? 0);
  if (padding > 0) props.padding = spacingToken(padding);
  if (node.itemSpacing && node.itemSpacing > 0) props.gap = spacingToken(node.itemSpacing);
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    props.cornerRadius = Math.round(node.cornerRadius);
  }

  const fill = node.fills?.find((paint) => paint.visible !== false);
  if (fill?.type === "SOLID" && fill.color) {
    props.backgroundColor = toHex(fill.color);
  } else if (fill && fill.type !== "SOLID") {
    warnings.push(warning(node, "Gradient and image fills need a manual SDUI resource/style choice."));
  }
  return props;
}

function spacingToken(value: number) {
  if (value <= 4) return "xs";
  if (value <= 8) return "sm";
  if (value <= 16) return "md";
  if (value <= 24) return "lg";
  return "xl";
}

function toHex(color: { r: number; g: number; b: number }) {
  const part = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, "0");
  return "#" + part(color.r) + part(color.g) + part(color.b);
}

function parseDirective(name: string): { kind: string; value: string } | null {
  const match = name.trim().match(/^sdui:([a-z-]+)(?::(.+))?$/i);
  return match ? { kind: match[1].toLowerCase(), value: match[2]?.trim() ?? "" } : null;
}

function parseBinding(name: string) {
  const match = name.trim().match(/^bind:(.+)$/i);
  return match?.[1]?.trim() || null;
}

function parseRoute(name: string) {
  const match = name.match(/route:([a-z0-9/_-]+)/i);
  return match?.[1] ?? null;
}

function findFirstText(node: FigmaLikeNode): string | null {
  if (node.type === "TEXT" && node.characters?.trim()) return node.characters.trim();
  for (const child of node.children ?? []) {
    const text = findFirstText(child);
    if (text) return text;
  }
  return null;
}

function normalizeName(name: string) {
  return name
    .replace(/^(sdui|bind):/i, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase() || "figma_component";
}

function warning(node: FigmaLikeNode, message: string): ConversionWarning {
  return { nodeId: node.id, nodeName: node.name, message };
}
