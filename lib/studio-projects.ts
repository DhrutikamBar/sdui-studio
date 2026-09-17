import { collection, onSnapshot, query, setDoc, doc, where } from "firebase/firestore";
import { firestore, studioIdToken } from "./firebase";

export type StudioProject = {
  id: string;
  name: string;
  packageName: string;
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
};

export const legacyProject: StudioProject = {
  id: "legacy",
  name: "Demo workspace",
  packageName: "com.example.flexflow",
  memberIds: [],
  createdAt: 0,
  updatedAt: 0,
  updatedBy: "Studio",
};

export type ProjectActor = { uid: string; label: string };

function projectFromSnapshot(item: { id: string; data: () => Record<string, unknown> }): StudioProject {
  const data = item.data();
  return {
    id: item.id,
    name: typeof data.name === "string" ? data.name : "Untitled project",
    packageName: typeof data.packageName === "string" ? data.packageName : "com.example.app",
    memberIds: Array.isArray(data.memberIds) ? data.memberIds.filter((value): value is string => typeof value === "string") : [],
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : "",
  };
}

export function watchStudioProjects(uid: string, callback: (projects: StudioProject[]) => void, onError: (message: string) => void) {
  const db = firestore();
  if (!db) return () => undefined;
  return onSnapshot(query(collection(db, "studioProjects"), where("memberIds", "array-contains", uid)), (snapshot) => {
    callback(snapshot.docs
      .map((item) => projectFromSnapshot({ id: item.id, data: () => item.data() }))
      .sort((left, right) => left.name.localeCompare(right.name)));
  }, (error) => onError(error.message));
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export async function createStudioProject(input: { name: string; packageName: string; memberIds?: string[] }, actor: ProjectActor): Promise<StudioProject> {
  const db = firestore();
  if (!db) throw new Error("Firebase is not configured.");
  const now = Date.now();
  const id = slugify(input.name) + "-" + now.toString(36);
  const memberIds = Array.from(new Set([actor.uid, ...(input.memberIds ?? [])]));
  const project: StudioProject = {
    id,
    name: input.name.trim(),
    packageName: input.packageName.trim(),
    memberIds,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.label,
  };
  await setDoc(doc(db, "studioProjects", id), project);
  return project;
}

export async function changeStudioProjectMember(input: { projectId: string; targetUid: string; action: "add" | "remove" }) {
  const token = await studioIdToken();
  const response = await fetch("/api/projects/members", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json() as { memberIds?: string[]; error?: string };
  if (!response.ok || !result.memberIds) throw new Error(result.error || "Project membership could not be updated.");
  return result.memberIds;
}
