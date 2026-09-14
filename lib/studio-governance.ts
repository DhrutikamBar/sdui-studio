import { addDoc, collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { firestore } from "./firebase";

export type StudioRole = "designer" | "reviewer" | "admin";

export type StudioMember = {
  uid: string;
  email: string;
  displayName: string;
  role: StudioRole;
  active: boolean;
  updatedAt: number;
  updatedBy?: string;
};

export type StudioAuditEntry = {
  id: string;
  action: string;
  actorUid: string;
  actorLabel: string;
  screenId?: string;
  targetLabel?: string;
  createdAt: number;
};

export type StudioActor = {
  uid: string;
  label: string;
};

function memberFromSnapshot(item: { id: string; data: () => Record<string, unknown> }): StudioMember {
  const data = item.data();
  return {
    uid: item.id,
    email: typeof data.email === "string" ? data.email : "",
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    role: data.role === "admin" || data.role === "reviewer" ? data.role : "designer",
    active: data.active !== false,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
  };
}

export async function loadStudioMember(uid: string): Promise<StudioMember | null> {
  const db = firestore();
  if (!db) return null;
  const snapshot = await getDoc(doc(db, "studioUsers", uid));
  return snapshot.exists() ? memberFromSnapshot({ id: snapshot.id, data: () => snapshot.data() }) : null;
}

export function observeStudioMembers(callback: (members: StudioMember[]) => void, onError: (message: string) => void) {
  const db = firestore();
  if (!db) return () => undefined;
  return onSnapshot(query(collection(db, "studioUsers"), orderBy("email", "asc")), (snapshot) => {
    callback(snapshot.docs.map((item) => memberFromSnapshot({ id: item.id, data: () => item.data() })));
  }, (error) => onError(error.message));
}

export function observeStudioAudit(callback: (entries: StudioAuditEntry[]) => void, onError: (message: string) => void) {
  const db = firestore();
  if (!db) return () => undefined;
  return onSnapshot(query(collection(db, "studioAudit"), orderBy("createdAt", "desc"), limit(30)), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as StudioAuditEntry)));
  }, (error) => onError(error.message));
}

export async function writeStudioAudit(action: string, actor: StudioActor, details: { screenId?: string; targetLabel?: string } = {}) {
  const db = firestore();
  if (!db) throw new Error("Firebase is not configured.");
  await addDoc(collection(db, "studioAudit"), {
    action,
    actorUid: actor.uid,
    actorLabel: actor.label,
    ...details,
    createdAt: Date.now(),
  });
}

export async function saveStudioMember(member: Pick<StudioMember, "uid" | "email" | "displayName" | "role" | "active">, actor: StudioActor) {
  const db = firestore();
  if (!db) throw new Error("Firebase is not configured.");
  const now = Date.now();
  await setDoc(doc(db, "studioUsers", member.uid), {
    email: member.email,
    displayName: member.displayName,
    role: member.role,
    active: member.active,
    updatedAt: now,
    updatedBy: actor.label,
  }, { merge: true });
  await writeStudioAudit("access_updated", actor, { targetLabel: member.email });
}
