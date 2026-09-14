import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";
import { writeStudioAudit } from "./studio-governance";

export type RemoteScreen = {
  id: string;
  route: string;
  title: string;
  status: "Draft" | "Published";
  version: number;
  updatedAt: number;
  updatedBy?: string;
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
};

export function watchRemoteScreens(callback: (screens: RemoteScreen[]) => void, onError: (message: string) => void) {
  const db = firestore();
  if (!db) return () => undefined;
  return onSnapshot(query(collection(db, "sduiScreens"), orderBy("updatedAt", "desc")), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RemoteScreen)));
  }, (error) => onError(error.message));
}

export async function loadRemoteVersions(screenId: string): Promise<RemoteVersion[]> {
  const db = firestore();
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db, "sduiScreens", screenId, "versions"), orderBy("createdAt", "desc")));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as RemoteVersion));
}

export type StudioActor = {
  uid: string;
  label: string;
};

export type SaveRemoteVersionInput = Omit<RemoteVersion, "id" | "createdAt" | "createdBy"> & { screenId: string };

export async function saveRemoteVersion(input: SaveRemoteVersionInput, actor: StudioActor) {
  const db = firestore();
  if (!db) throw new Error("Firebase is not configured.");
  const createdAt = Date.now();
  const versionId = input.status.toLowerCase() + "-" + createdAt;
  await setDoc(doc(db, "sduiScreens", input.screenId), {
    title: input.title,
    route: input.route,
    status: input.status,
    version: input.number,
    updatedAt: createdAt,
    updatedBy: actor.label,
  }, { merge: true });
  const { screenId, ...version } = input;
  await setDoc(doc(db, "sduiScreens", screenId, "versions", versionId), {
    ...version,
    createdAt,
    createdBy: actor.label,
  });
  await writeStudioAudit(input.status === "Published" ? "screen_published" : "draft_saved", actor, {
    screenId: input.screenId,
    targetLabel: input.title,
  });
}

