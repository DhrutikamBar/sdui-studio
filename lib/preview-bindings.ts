export function collectionBindingPath(value: unknown): string {
  return typeof value === "string" ? value.replace(/[{}\s]/g, "") : "";
}
