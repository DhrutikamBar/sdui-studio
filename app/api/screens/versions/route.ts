import { randomUUID } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { nextVersionNumber, publishedVersionNumber, validateReleaseActions, type VersionKind } from "../../../../lib/release-policy";
import { validateFlexflowDocument } from "../../../../lib/validate";

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

async function authenticatedRequest(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new RequestError(401, "Sign in before changing screen versions.");
  try { return await getAuth(adminApp()).verifyIdToken(token, true); }
  catch { throw new RequestError(401, "Your session expired. Sign in again."); }
}

async function requestBody(request: NextRequest): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new RequestError(400, "Request body is not valid JSON."); }
}

type Input = {
  kind: VersionKind;
  screenId: string;
  projectId?: string;
  title: string;
  route: string;
  document: string;
  note: string;
  previewConfirmed: boolean;
};

function parseInput(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, "Invalid request body.");
  const body = value as Record<string, unknown>;
  const kind = body.kind;
  const screenId = typeof body.screenId === "string" ? body.screenId.trim() : "";
  const projectId = typeof body.projectId === "string" && body.projectId !== "legacy" ? body.projectId.trim() : undefined;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const route = typeof body.route === "string" ? body.route.trim() : "";
  const document = typeof body.document === "string" ? body.document : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (kind !== "Draft" && kind !== "Published") throw new RequestError(400, "Choose draft or publish.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(screenId)) throw new RequestError(400, "Invalid screen ID.");
  if (projectId && !/^[a-z0-9][a-z0-9-]{0,127}$/.test(projectId)) throw new RequestError(400, "Invalid project ID.");
  if (!title || title.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(route)) throw new RequestError(400, "Enter a valid screen name and route.");
  if (!document || Buffer.byteLength(document, "utf8") > 500_000) throw new RequestError(400, "Document is empty or too large.");
  if (kind === "Published" && (!note || note.length > 500 || body.previewConfirmed !== true)) throw new RequestError(400, "Preview confirmation and a release note are required.");
  let parsed: unknown;
  try { parsed = JSON.parse(document); } catch { throw new RequestError(400, "Document is not valid JSON."); }
  const errors = validateFlexflowDocument(parsed);
  if (kind === "Published") {
    const allowedOrigins = (process.env.FLEXFLOW_ALLOWED_URL_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
    errors.push(...validateReleaseActions(parsed, allowedOrigins));
  }
  if (errors.length) throw new RequestError(400, errors.slice(0, 5).join(" "));
  return { kind, screenId, projectId, title, route, document, note, previewConfirmed: body.previewConfirmed === true };
}

export async function POST(request: NextRequest) {
  try {
    const identity = await authenticatedRequest(request);
    const app = adminApp();
    const input = parseInput(await requestBody(request));
    const db = getFirestore(app);
    const storageId = input.projectId ? input.projectId + "--" + input.screenId : input.screenId;
    const screenRef = db.collection("sduiScreens").doc(storageId);
    const versionsRef = screenRef.collection("versions");
    const existing = await screenRef.get();
    let legacyLatest = 0;
    let legacyPublished = 0;
    let legacyPublishedId: string | undefined;
    if (existing.exists && typeof existing.data()?.latestVersion !== "number") {
      const oldVersions = await versionsRef.get();
      for (const version of oldVersions.docs) {
        const data = version.data();
        const number = typeof data.number === "number" ? data.number : 0;
        legacyLatest = Math.max(legacyLatest, number);
        if (data.status === "Published" && number > legacyPublished) {
          legacyPublished = number;
          legacyPublishedId = version.id;
        }
      }
    }

    if (input.kind === "Published") {
      const sameRoute = await db.collection("sduiScreens").where("route", "==", input.route).get();
      const conflict = sameRoute.docs.find((item) => {
        const data = item.data();
        return item.id !== storageId && (data.projectId || "legacy") === (input.projectId || "legacy") && data.status !== "Archived";
      });
      if (conflict) throw new RequestError(409, "This route is already used by another screen in the project.");
    }

    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection("studioUsers").doc(identity.uid);
      const user = await transaction.get(userRef);
      const member = user.data();
      if (!user.exists || member?.active === false || !["admin", "designer"].includes(member?.role)) throw new RequestError(403, "Your account cannot save screen versions.");
      if (input.projectId) {
        const project = await transaction.get(db.collection("studioProjects").doc(input.projectId));
        if (!project.exists || !project.data()?.memberIds?.includes(identity.uid)) throw new RequestError(403, "You do not have access to this project.");
      }
      const screen = await transaction.get(screenRef);
      const current = (screen.data() ?? {}) as Record<string, unknown>;
      if (screen.exists && (current.projectId || "legacy") !== (input.projectId || "legacy")) throw new RequestError(409, "Screen belongs to another project.");
      if (current.status === "Archived") throw new RequestError(409, "Restore this screen before saving a version.");
      const routeLock = input.kind === "Published" ? db.collection("studioRoutes").doc((input.projectId || "legacy") + "--" + input.route) : null;
      const lock = routeLock ? await transaction.get(routeLock) : null;
      if (lock?.exists && lock.data()?.screenId !== input.screenId) throw new RequestError(409, "This route is already reserved by another screen.");
      const oldRoute = typeof current.route === "string" ? current.route : "";
      const oldLockRef = routeLock && oldRoute && oldRoute !== input.route ? db.collection("studioRoutes").doc((input.projectId || "legacy") + "--" + oldRoute) : null;
      const oldLock = oldLockRef ? await transaction.get(oldLockRef) : null;

      const number = nextVersionNumber(current, legacyLatest);
      const previousPublished = publishedVersionNumber(current, legacyPublished);
      const publishedVersion = input.kind === "Published" ? number : previousPublished;
      const versionId = input.kind.toLowerCase() + "-" + number + "-" + randomUUID();
      const createdAt = Date.now();
      const actorLabel = identity.name || identity.email || identity.uid;
      const status = publishedVersion > 0 ? "Published" : "Draft";
      const publishedVersionId = input.kind === "Published" ? versionId : current.publishedVersionId || legacyPublishedId;
      transaction.set(screenRef, {
        screenId: input.screenId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        title: input.kind === "Published" || !previousPublished ? input.title : current.title,
        route: input.kind === "Published" || !previousPublished ? input.route : current.route,
        status,
        version: publishedVersion,
        publishedVersion,
        ...(publishedVersionId ? { publishedVersionId } : {}),
        latestVersion: number,
        latestDraftVersion: input.kind === "Draft" ? number : FieldValue.delete(),
        latestDraftVersionId: input.kind === "Draft" ? versionId : FieldValue.delete(),
        draftTitle: input.kind === "Draft" ? input.title : FieldValue.delete(),
        draftRoute: input.kind === "Draft" ? input.route : FieldValue.delete(),
        updatedAt: createdAt,
        updatedBy: actorLabel,
      }, { merge: true });
      transaction.create(versionsRef.doc(versionId), {
        number, status: input.kind, title: input.title, route: input.route,
        document: input.document, note: input.kind === "Published" ? input.note : "",
        ...(input.projectId ? { projectId: input.projectId } : {}),
        createdAt, createdBy: actorLabel,
      });
      transaction.create(db.collection("studioAudit").doc(), {
        action: input.kind === "Published" ? "screen_published" : "draft_saved",
        actorUid: identity.uid, actorLabel, screenId: input.screenId,
        targetLabel: input.projectId ? input.title + " · " + input.projectId : input.title,
        createdAt,
      });
      if (routeLock) transaction.set(routeLock, { screenId: input.screenId, projectId: input.projectId || "legacy", route: input.route });
      if (oldLockRef && oldLock?.data()?.screenId === input.screenId) transaction.delete(oldLockRef);
      return { id: versionId, number, status: input.kind, title: input.title, route: input.route, document: input.document, note: input.note, createdAt, publishedVersion, screenStatus: status };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Version save failed", error);
    return NextResponse.json({ error: "The version could not be saved. Try again or contact an administrator." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const identity = await authenticatedRequest(request);
    const app = adminApp();
    const value = await requestBody(request);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, "Invalid request body.");
    const body = value as Record<string, unknown>;
    const screenId = typeof body.screenId === "string" ? body.screenId : "";
    const projectId = typeof body.projectId === "string" && body.projectId !== "legacy" ? body.projectId : undefined;
    const requested = body.status;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(screenId) || (projectId && !/^[a-z0-9][a-z0-9-]{0,127}$/.test(projectId))) throw new RequestError(400, "Invalid screen or project ID.");
    if (requested !== "Archived" && requested !== "Draft") throw new RequestError(400, "Choose archive or restore.");
    const db = getFirestore(app);
    const storageId = projectId ? projectId + "--" + screenId : screenId;
    const screenRef = db.collection("sduiScreens").doc(storageId);
    const existing = await screenRef.get();
    let legacyPublished = 0;
    let legacyPublishedId: string | undefined;
    if (existing.exists && typeof existing.data()?.publishedVersion !== "number") {
      const versions = await screenRef.collection("versions").where("status", "==", "Published").get();
      for (const version of versions.docs) {
        const number = version.data().number;
        if (typeof number === "number" && number > legacyPublished) {
          legacyPublished = number;
          legacyPublishedId = version.id;
        }
      }
    }
    if (requested === "Draft") {
      const current = existing.data();
      if (publishedVersionNumber(current ?? {}, legacyPublished) > 0 && typeof current?.route === "string") {
        const sameRoute = await db.collection("sduiScreens").where("route", "==", current.route).get();
        if (sameRoute.docs.some((item) => item.id !== storageId && (item.data().projectId || "legacy") === (projectId || "legacy") && item.data().status !== "Archived")) {
          throw new RequestError(409, "Another screen now uses this route.");
        }
      }
    }
    const result = await db.runTransaction(async (transaction) => {
      const user = await transaction.get(db.collection("studioUsers").doc(identity.uid));
      const member = user.data();
      if (!user.exists || member?.active === false || !["admin", "designer"].includes(member?.role)) throw new RequestError(403, "Your account cannot change screen status.");
      if (projectId) {
        const project = await transaction.get(db.collection("studioProjects").doc(projectId));
        if (!project.exists || !project.data()?.memberIds?.includes(identity.uid)) throw new RequestError(403, "You do not have access to this project.");
      }
      const snapshot = await transaction.get(screenRef);
      const current = (snapshot.data() ?? {}) as Record<string, unknown>;
      if (snapshot.exists && (current.projectId || "legacy") !== (projectId || "legacy")) throw new RequestError(409, "Screen belongs to another project.");
      if (requested === "Draft" && current.status !== "Archived") throw new RequestError(409, "Screen is not archived.");
      const title = typeof current.title === "string" ? current.title : typeof body.title === "string" ? body.title : screenId;
      const route = typeof current.route === "string" ? current.route : typeof body.route === "string" ? body.route : screenId;
      const publishedVersion = publishedVersionNumber(current, legacyPublished);
      const screenStatus = requested === "Archived" ? "Archived" : publishedVersion > 0 ? "Published" : "Draft";
      const routeLockRef = publishedVersion > 0 ? db.collection("studioRoutes").doc((projectId || "legacy") + "--" + route) : null;
      const routeLock = routeLockRef ? await transaction.get(routeLockRef) : null;
      if (requested === "Draft" && routeLock?.exists && routeLock.data()?.screenId !== screenId) throw new RequestError(409, "Another screen has reserved this route.");
      const createdAt = Date.now();
      const actorLabel = identity.name || identity.email || identity.uid;
      transaction.set(screenRef, {
        screenId, ...(projectId ? { projectId } : {}), title, route,
        status: screenStatus,
        version: publishedVersion,
        publishedVersion,
        ...(legacyPublishedId && !current.publishedVersionId ? { publishedVersionId: legacyPublishedId } : {}),
        updatedAt: createdAt,
        updatedBy: actorLabel,
      }, { merge: true });
      transaction.create(db.collection("studioAudit").doc(), {
        action: requested === "Archived" ? "screen_archived" : "screen_restored",
        actorUid: identity.uid, actorLabel, screenId,
        targetLabel: projectId ? title + " · " + projectId : title,
        createdAt,
      });
      if (routeLockRef && requested === "Archived" && routeLock?.data()?.screenId === screenId) transaction.delete(routeLockRef);
      if (routeLockRef && requested === "Draft") transaction.set(routeLockRef, { screenId, projectId: projectId || "legacy", route });
      return { screenStatus };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Screen status update failed", error);
    return NextResponse.json({ error: "Screen status could not be updated. Try again or contact an administrator." }, { status: 500 });
  }
}
