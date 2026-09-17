export type VersionKind = "Draft" | "Published";

export function nextVersionNumber(current: Record<string, unknown>, legacyLatest = 0): number {
  const values = [current.latestVersion, current.version, current.publishedVersion, current.latestDraftVersion, legacyLatest];
  return Math.max(0, ...values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))) + 1;
}

export function publishedVersionNumber(current: Record<string, unknown>, legacyPublished?: number): number {
  if (typeof current.publishedVersion === "number") return current.publishedVersion;
  if (typeof legacyPublished === "number") return legacyPublished;
  return current.status === "Published" && typeof current.version === "number" ? current.version : 0;
}

export function validateReleaseActions(document: unknown, allowedOrigins: string[]): string[] {
  const errors: string[] = [];
  const actionHosts = new Set(["button", "chip", "icon", "image", "box", "row", "text"]);
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as { type?: string; action?: { type?: string; target?: string }; children?: unknown[] };
    if (node.action?.type && !actionHosts.has(node.type ?? "")) errors.push(path + " cannot have a tap action.");
    if (node.action?.type === "apiCall") errors.push(path + " cannot call an API directly.");
    if (node.action?.type === "navigate" && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(node.action.target ?? "")) errors.push(path + " has an invalid destination route.");
    if (node.action?.type === "openUrl") {
      try {
        const url = new URL(node.action.target ?? "");
        if (url.protocol !== "https:" || !allowedOrigins.includes(url.origin)) errors.push(path + " uses an unapproved URL origin.");
      } catch {
        errors.push(path + " has an invalid URL.");
      }
    }
    node.children?.forEach((child, index) => visit(child, path + ".children[" + index + "]"));
  };
  visit(document, "root");
  return errors;
}
