import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, where, writeBatch } from "firebase/firestore";
import { firestore } from "./firebase";
import { writeStudioAudit } from "./studio-governance";

export type RemoteScreen = {
  id: string;
  route: string;
  title: string;
  status: "Draft" | "Published" | "Archived";
  version: number;
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
  const snapshot = await getDocs(query(collection(db, "sduiScreens", screenStorageId(screenId, projectId), "versions"), orderBy("createdAt", "desc")));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RemoteVersion));
}

export type StudioActor = {
  uid: string;
  label: string;
};

export async function saveRemoteScreenStatus(input: {
  screenId: string;
  projectId?: string;
  title: string;
  route: string;
  version: number;
  status: "Draft" | "Archived";
}, actor: StudioActor) {
  const db = firestore();
  if (!db) throw new Error("Firebase is not configured.");
  const projectId = input.projectId && input.projectId !== "legacy" ? input.projectId : undefined;
  const batch = writeBatch(db);
  batch.set(doc(db, "sduiScreens", screenStorageId(input.screenId, projectId)), {
    screenId: input.screenId,
    ...(projectId ? { projectId } : {}),
    title: input.title,
    route: input.route,
    version: input.version,
    status: input.status,
    updatedAt: Date.now(),
    updatedBy: actor.label,
  }, { merge: true });
  batch.set(doc(collection(db, "studioAudit")), {
    action: input.status === "Archived" ? "screen_archived" : "screen_restored",
    actorUid: actor.uid,
    actorLabel: actor.label,
    screenId: input.screenId,
    targetLabel: projectId ? input.title + " · " + projectId : input.title,
    createdAt: Date.now(),
  });
  await batch.commit();
}

export type SaveRemoteVersionInput = Omit<RemoteVersion, "id" | "createdAt" | "createdBy"> & {
  screenId: string;
  projectId?: string;
};

export async function saveRemoteVersion(input: SaveRemoteVersionInput, actor: StudioActor) {
  const db = firestore();
  if (!db) throw new Error("Firebase is not configured.");
  const createdAt = Date.now();
  const versionId = input.status.toLowerCase() + "-" + createdAt;
  const storageId = screenStorageId(input.screenId, input.projectId);
  const projectId = input.projectId && input.projectId !== "legacy" ? input.projectId : undefined;

  await setDoc(doc(db, "sduiScreens", storageId), {
    screenId: input.screenId,
    ...(projectId ? { projectId } : {}),
    title: input.title,
    route: input.route,
    status: input.status,
    version: input.number,
    updatedAt: createdAt,
    updatedBy: actor.label,
  }, { merge: true });

  const { screenId, projectId: _projectId, ...version } = input;
  await setDoc(doc(db, "sduiScreens", storageId, "versions", versionId), {
    ...version,
    ...(projectId ? { projectId } : {}),
    createdAt,
    createdBy: actor.label,
  });

  await writeStudioAudit(input.status === "Published" ? "screen_published" : "draft_saved", actor, {
    screenId: input.screenId,
    targetLabel: projectId ? input.title + " · " + projectId : input.title,
  });
}
