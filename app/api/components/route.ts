import { randomUUID } from "node:crypto";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { validateFlexflowDocument } from "../../../lib/validate";
import { validateReleaseActions } from "../../../lib/release-policy";
import type { ComponentNode, StudioComponent } from "../../../lib/component-library";

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

function projectIdFrom(value: unknown) {
  if (typeof value !== "string" || !/^(?:legacy|[a-z0-9][a-z0-9-]{0,127})$/.test(value)) throw new RequestError(400, "Choose a valid project.");
  return value;
}

async function access(request: NextRequest, projectId: string, edit: boolean) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new RequestError(401, "Sign in to use the component library.");
  let uid: string;
  try { uid = (await getAuth(adminApp()).verifyIdToken(token, true)).uid; }
  catch { throw new RequestError(401, "Your session expired. Sign in again."); }
  const db = getFirestore(adminApp());
  const member = await db.collection("studioUsers").doc(uid).get();
  const role = member.data()?.role;
  if (!member.exists || member.data()?.active === false || !["admin", "designer", "reviewer"].includes(role)) throw new RequestError(403, "Your account cannot access the component library.");
  if (edit && !["admin", "designer"].includes(role)) throw new RequestError(403, "Only designers and admins can change components.");
  if (projectId !== "legacy") {
    const project = await db.collection("studioProjects").doc(projectId).get();
    if (!project.exists || !project.data()?.memberIds?.includes(uid)) throw new RequestError(403, "You do not have access to this project.");
  }
  return { db, uid, label: String(member.data()?.displayName || member.data()?.email || uid) };
}

async function bodyFrom(request: NextRequest) {
  let value: unknown;
  try { value = await request.json(); }
  catch { throw new RequestError(400, "Request body is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, "Invalid request body.");
  return value as Record<string, unknown>;
}

function componentInput(body: Record<string, unknown>) {
  const projectId = projectIdFrom(body.projectId);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!name || name.length > 80 || category.length > 40 || description.length > 300) throw new RequestError(400, "Enter a name of up to 80 characters, category of up to 40, and description of up to 300.");
  const document = body.document;
  const serialized = JSON.stringify(document);
  if (!serialized || Buffer.byteLength(serialized, "utf8") > 100_000) throw new RequestError(400, "The component is empty or too large.");
  const errors: string[] = [];
  let count = 0;
  const inspect = (node: ComponentNode, depth: number) => {
    count += 1;
    if (depth > 12) errors.push("Component nesting is limited to 12 levels.");
    if (count > 100) errors.push("A component can contain at most 100 widgets.");
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (Array.isArray(node.children) && depth <= 12 && count <= 100) node.children.forEach((child) => inspect(child, depth + 1));
  };
  if (document && typeof document === "object" && !Array.isArray(document)) inspect(document as ComponentNode, 1);
  if (errors.length) throw new RequestError(400, errors.slice(0, 4).join(" "));
  errors.push(...validateFlexflowDocument(document));
  const allowedOrigins = (process.env.FLEXFLOW_ALLOWED_URL_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  errors.push(...validateReleaseActions(document, allowedOrigins));
  if (errors.length) throw new RequestError(400, errors.slice(0, 4).join(" "));
  return { projectId, name, category: category || "General", description, document: document as ComponentNode };
}

function failure(error: unknown) {
  const status = error instanceof RequestError ? error.status : 500;
  return NextResponse.json({ error: error instanceof RequestError ? error.message : "Component library request failed." }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  try {
    const projectId = projectIdFrom(request.nextUrl.searchParams.get("projectId"));
    const { db } = await access(request, projectId, false);
    const snapshot = await db.collection("studioComponents").where("projectId", "==", projectId).get();
    const components = snapshot.docs.filter((item) => item.data().archived !== true).map((item) => ({ id: item.id, ...item.data() } as StudioComponent));
    components.sort((left, right) => left.name.localeCompare(right.name));
    return NextResponse.json({ components }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await bodyFrom(request);
    const input = componentInput(body);
    const { db, uid, label } = await access(request, input.projectId, true);
    const now = Date.now();
    const id = randomUUID();
    const component: StudioComponent = { id, ...input, revision: 1, createdAt: now, updatedAt: now, updatedBy: label };
    await db.collection("studioComponents").doc(id).create({ ...component, createdBy: uid, archived: false });
    return NextResponse.json({ component }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await bodyFrom(request);
    const input = componentInput(body);
    const id = typeof body.id === "string" ? body.id : "";
    const revision = body.revision;
    if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(revision)) throw new RequestError(400, "Choose a valid component revision.");
    const { db, label } = await access(request, input.projectId, true);
    const ref = db.collection("studioComponents").doc(id);
    const component = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists || current.data()?.projectId !== input.projectId || current.data()?.archived === true) throw new RequestError(404, "Component not found in this project.");
      if (current.data()?.revision !== revision) throw new RequestError(409, "This component changed elsewhere. Reload it before saving.");
      const updated = { id, ...input, revision: (revision as number) + 1, createdAt: current.data()?.createdAt as number, updatedAt: Date.now(), updatedBy: label };
      transaction.update(ref, { ...input, revision: updated.revision, updatedAt: updated.updatedAt, updatedBy: label });
      return updated;
    });
    return NextResponse.json({ component }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await bodyFrom(request);
    const projectId = projectIdFrom(body.projectId);
    const id = typeof body.id === "string" ? body.id : "";
    const revision = body.revision;
    if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(revision)) throw new RequestError(400, "Choose a valid component revision.");
    const { db, label } = await access(request, projectId, true);
    const ref = db.collection("studioComponents").doc(id);
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists || current.data()?.projectId !== projectId || current.data()?.archived === true) throw new RequestError(404, "Component not found in this project.");
      if (current.data()?.revision !== revision) throw new RequestError(409, "This component changed elsewhere. Reload it before archiving.");
      transaction.update(ref, { archived: true, revision: (revision as number) + 1, updatedAt: Date.now(), updatedBy: label });
    });
    return NextResponse.json({ archived: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

