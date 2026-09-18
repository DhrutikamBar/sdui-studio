import { studioIdToken } from "./firebase";

export type ComponentNode = {
  type?: string;
  id?: string;
  props?: Record<string, unknown>;
  children?: ComponentNode[];
  action?: { type?: string; target?: string };
  [key: string]: unknown;
};

export type StudioComponent = {
  id: string;
  projectId: string;
  name: string;
  category: string;
  description: string;
  document: ComponentNode;
  revision: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export function copyComponentTree(document: ComponentNode): ComponentNode {
  const copy = JSON.parse(JSON.stringify(document)) as ComponentNode;
  const removeSourceIds = (node: ComponentNode) => {
    delete node.id;
    node.children?.forEach(removeSourceIds);
  };
  removeSourceIds(copy);
  return copy;
}

async function componentRequest(method: "GET" | "POST" | "PUT" | "DELETE", projectId: string, body?: Record<string, unknown>) {
  const token = await studioIdToken();
  const response = await fetch("/api/components?projectId=" + encodeURIComponent(projectId), {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify({ ...body, projectId }) } : {}),
    cache: "no-store",
  });
  const result = await response.json() as { components?: StudioComponent[]; component?: StudioComponent; error?: string };
  if (!response.ok) throw new Error(result.error || "Component library request failed.");
  return result;
}

export async function loadStudioComponents(projectId: string) {
  return (await componentRequest("GET", projectId)).components ?? [];
}

export async function saveStudioComponent(input: { id?: string; projectId: string; name: string; category: string; description: string; document: ComponentNode; revision?: number }) {
  const result = await componentRequest(input.id ? "PUT" : "POST", input.projectId, input);
  if (!result.component) throw new Error("The component save could not be confirmed.");
  return result.component;
}

export async function archiveStudioComponent(projectId: string, id: string, revision: number) {
  await componentRequest("DELETE", projectId, { id, revision });
}

