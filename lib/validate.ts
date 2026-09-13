export type SduiNode = {
  type?: string;
  id?: string;
  props?: Record<string, unknown>;
  children?: SduiNode[];
  action?: { type?: string; target?: string };
  [key: string]: unknown;
};

const widgetTypes = new Set([
  "column", "row", "box", "text", "button", "image", "icon", "spacer",
  "divider", "textInput", "checkbox", "switch", "tabs", "bottomNavigation",
  "repeater", "list", "grid", "chip", "badge", "progressBar", "rating"
]);

const actionTypes = new Set([
  "navigate", "back", "analytics", "refreshData", "openUrl", "toggleState", "apiCall"
]);

const bindingRoots = new Set(["user", "wallet", "transactions", "item", "index"]);

export function validateSduiDocument(value: unknown): string[] {
  const errors: string[] = [];

  function validateNode(node: unknown, path: string) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push(path + " must be an object.");
      return;
    }

    const valueNode = node as SduiNode;
    if (!valueNode.type || !widgetTypes.has(valueNode.type)) {
      errors.push(path + " has an unsupported widget type.");
    }

    if (valueNode.action?.type && !actionTypes.has(valueNode.action.type)) {
      errors.push(path + " has an unsupported action type.");
    }

    const serialized = JSON.stringify(valueNode);
    const bindings = serialized.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/g);
    for (const binding of bindings) {
      const root = binding[1].split(".")[0];
      if (!bindingRoots.has(root)) {
        errors.push(path + " uses an unapproved binding root: " + root + ".");
      }
    }

    if (valueNode.children && !Array.isArray(valueNode.children)) {
      errors.push(path + ".children must be an array.");
      return;
    }

    valueNode.children?.forEach((child, index) => validateNode(child, path + ".children[" + index + "]"));
  }

  validateNode(value, "root");
  return errors;
}
