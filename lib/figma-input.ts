export type FigmaSelection = { fileKey: string; nodeId: string };

/** Accept a Figma file URL or key, plus an explicit node ID or URL node-id. */
export function parseFigmaSelection(input: string, nodeInput: string): FigmaSelection {
  let fileKey = input.trim();
  let urlNode = "";
  if (/^https?:\/\//i.test(fileKey)) {
    const url = new URL(fileKey);
    if (url.protocol !== "https:" || !["figma.com", "www.figma.com"].includes(url.hostname)) {
      throw new Error("Enter a Figma file URL from figma.com.");
    }
    const match = url.pathname.match(/^\/(?:file|design)\/([a-zA-Z0-9]+)(?:\/|$)/);
    if (!match) throw new Error("Enter a Figma design file URL.");
    fileKey = match[1];
    urlNode = url.searchParams.get("node-id") ?? "";
  }
  if (!/^[a-zA-Z0-9]{8,128}$/.test(fileKey)) throw new Error("Enter a valid Figma file key.");
  const nodeId = (nodeInput.trim() || urlNode).replace(/-/g, ":");
  if (!/^\d+:\d+(?::\d+)*$/.test(nodeId)) throw new Error("Enter a node ID or use a Figma URL with node-id.");
  return { fileKey, nodeId };
}

