import { collection, getDocs, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { firestore, studioIdToken } from "./firebase";

export type RemoteScreen = {
  id: string;
  route: string;
  title: string;
  status: "Draft" | "Published" | "Archived";
  version: number;
  publishedVersion?: number;
  latestDraftVersion?: number;
  updatedAt: number;
  updatedBy?: string;
  projectId?: string;
};

export type RemoteVersion = {
  id: string;
  number: number;
  status: "Draft" | "Published";
  title: string;
  route: string;
  document: string;
  note?: string;
  createdAt: number;
  createdBy?: string;
  projectId?: string;
};

function screenStorageId(screenId: string, projectId?: string) {
  return projectId && projectId !== "legacy" ? projectId + "--" + screenId : screenId;
}

function remoteScreen(item: { id: string; data: () => Record<string, unknown> }): RemoteScreen {
  const data = item.data();
  return {
    id: typeof data.screenId === "string" ? data.screenId : item.id,
    route: typeof data.route === "string" ? data.route : item.id,
    title: typeof data.title === "string" ? data.title : item.id,
    status: data.status === "Published" || data.status === "Archived" ? data.status : "Draft",
    version: typeof data.version === "number" ? data.version : 1,
    publishedVersion: typeof data.publishedVersion === "number" ? data.publishedVersion : undefined,
    latestDraftVersion: typeof data.latestDraftVersion === "number" ? data.latestDraftVersion : undefined,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
    projectId: typeof data.projectId === "string" ? data.projectId : undefined,
  };
}

export function watchRemoteScreens(projectId: string | undefined, callback: (screens: RemoteScreen[]) => void, onError: (message: string) => void) {
  const db = firestore();
  if (!db) return () => undefined;
  const isLegacy = !projectId || projectId === "legacy";
  const source = isLegacy
    ? query(collection(db, "sduiScreens"), orderBy("updatedAt", "desc"))
    : query(collection(db, "sduiScreens"), where("projectId", "==", projectId));

  return onSnapshot(source, (snapshot) => {
    const screens = snapshot.docs
      .map((item) => remoteScreen({ id: item.id, data: () => item.data() }))
      .filter((screen) => isLegacy ? !screen.projectId || screen.projectId === "legacy" : screen.projectId === projectId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    callback(screens);
  }, (error) => onError(error.message));
}

export async function loadRemoteVersions(screenId: string, projectId?: string): Promise<RemoteVersion[]> {
  const db = firestore();
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, "sduiScreens", screenStorageId(screenId, projectId), "versions"), orderBy("number", "desc")));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RemoteVersion));
}

export async function saveRemoteScreenStatus(input: {
  screenId: string;
  projectId?: string;
  title: string;
  route: string;
  status: "Draft" | "Archived";
}): Promise<{ screenStatus: "Draft" | "Published" | "Archived" }> {
  const token = await studioIdToken();
  const response = await fetch("/api/screens/versions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(input),
  });
  const result = await response.json() as { screenStatus: "Draft" | "Published" | "Archived"; error?: string };
  if (!response.ok) throw new Error(result.error || "Screen status could not be saved.");
  return result;
}

export type SaveRemoteVersionInput = Omit<RemoteVersion, "id" | "createdAt" | "createdBy" | "number"> & {
  screenId: string;
  projectId?: string;
  previewConfirmed?: boolean;
};

export type SavedRemoteVersion = RemoteVersion & { publishedVersion: number; screenStatus: "Draft" | "Published" };

export async function saveRemoteVersion(input: SaveRemoteVersionInput): Promise<SavedRemoteVersion> {
  const token = await studioIdToken();
  const response = await fetch("/api/screens/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ ...input, kind: input.status }),
  });
  const result = await response.json() as SavedRemoteVersion & { error?: string };
  if (!response.ok) throw new Error(result.error || "Version could not be saved.");
  return result;
}
