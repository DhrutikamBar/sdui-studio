import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function adminApp() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase Admin project ID is not configured.");
  return initializeApp({ credential: applicationDefault(), projectId });
}

async function actorUid(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new RequestError(401, "Sign in before changing project access.");
  try { return (await getAuth(adminApp()).verifyIdToken(token, true)).uid; }
  catch { throw new RequestError(401, "Your session expired. Sign in again."); }
}

function parseInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, "Invalid request body.");
  const data = value as Record<string, unknown>;
  const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
  const targetUid = typeof data.targetUid === "string" ? data.targetUid.trim() : "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(projectId) || projectId === "legacy") throw new RequestError(400, "Choose a client project.");
  if (!/^[^\s/]{1,128}$/.test(targetUid)) throw new RequestError(400, "Choose a valid Studio member.");
  if (data.action !== "add" && data.action !== "remove") throw new RequestError(400, "Choose add or remove.");
  return { projectId, targetUid, action: data.action as "add" | "remove" };
}

export async function POST(request: NextRequest) {
  try {
    const uid = await actorUid(request);
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new RequestError(400, "Request body is not valid JSON."); }
    const input = parseInput(body);
    const db = getFirestore(adminApp());
    const actorRef = db.collection("studioUsers").doc(uid);
    const targetRef = db.collection("studioUsers").doc(input.targetUid);
    const projectRef = db.collection("studioProjects").doc(input.projectId);

    const result = await db.runTransaction(async (transaction) => {
      const [actor, target, project] = await Promise.all([
        transaction.get(actorRef), transaction.get(targetRef), transaction.get(projectRef),
      ]);
      const actorData = actor.data();
      const targetData = target.data();
      const projectData = project.data();
      if (!actorData || actorData.active === false || actorData.role !== "admin") throw new RequestError(403, "Only active Studio admins can manage project members.");
      if (!projectData) throw new RequestError(404, "This project no longer exists.");
      const memberIds = Array.isArray(projectData.memberIds)
        ? projectData.memberIds.filter((id): id is string => typeof id === "string")
        : [];
      if (!memberIds.includes(uid)) throw new RequestError(403, "You do not have access to this project.");
      if (input.targetUid === uid && input.action === "remove") throw new RequestError(400, "You cannot remove your own project access.");
      if (input.action === "add" && (!targetData || targetData.active === false || !["designer", "reviewer", "admin"].includes(targetData.role))) {
        throw new RequestError(400, "Choose an active Studio member before adding project access.");
      }
      if (input.action === "add" && memberIds.includes(input.targetUid)) throw new RequestError(409, "This member already has project access.");
      if (input.action === "remove" && !memberIds.includes(input.targetUid)) throw new RequestError(409, "This member does not have project access.");
      if (input.action === "add" && memberIds.length >= 100) throw new RequestError(400, "A project can have at most 100 members.");

      const nextMemberIds = input.action === "add"
        ? [...memberIds, input.targetUid]
        : memberIds.filter((id) => id !== input.targetUid);
      const actorLabel = String(actorData.displayName || actorData.email || uid);
      const targetLabel = String(targetData?.email || input.targetUid);
      transaction.update(projectRef, { memberIds: nextMemberIds, updatedAt: Date.now(), updatedBy: actorLabel });
      transaction.create(db.collection("studioAudit").doc(), {
        action: input.action === "add" ? "project_member_added" : "project_member_removed",
        actorUid: uid,
        actorLabel,
        targetLabel,
        projectId: input.projectId,
        projectName: String(projectData.name || input.projectId),
        createdAt: Date.now(),
      });
      return { memberIds: nextMemberIds };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof RequestError ? error.message : "Project membership could not be updated.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
