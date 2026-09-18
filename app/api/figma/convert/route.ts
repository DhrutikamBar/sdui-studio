import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";
import { convertSelectedNode, type FigmaLikeNode } from "../../../../packages/converter-engine/src/index";
import { parseFigmaSelection } from "../../../../lib/figma-input";
import { validateFlexflowDocument } from "../../../../lib/validate";

export const runtime = "nodejs";

class RequestError extends Error {
  constructor(public status: number, message: string, public retryAfter?: string) { super(message); }
}

function adminApp() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase Admin project ID is not configured.");
  return initializeApp({ credential: applicationDefault(), projectId });
}

async function checkStudioAccess(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new RequestError(401, "Sign in to convert a Figma design.");
  let uid: string;
  try { uid = (await getAuth(adminApp()).verifyIdToken(token, true)).uid; }
  catch { throw new RequestError(401, "Your Studio session expired. Sign in again."); }
  const member = await getFirestore(adminApp()).collection("studioUsers").doc(uid).get();
  if (!member.exists || member.data()?.active === false || !["admin", "designer", "reviewer"].includes(member.data()?.role)) {
    throw new RequestError(403, "Your account cannot access the Studio converter.");
  }
}

async function limitedText(response: Response): Promise<string> {
  const limit = 5_000_000;
  if (Number(response.headers.get("content-length")) > limit) throw new RequestError(413, "Figma selection is too large. Select a smaller frame.");
  const reader = response.body?.getReader();
  if (!reader) throw new RequestError(502, "Figma returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new RequestError(413, "Figma selection is too large. Select a smaller frame.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: NextRequest) {
  try {
    await checkStudioAccess(request);
    const raw = await request.text();
    if (raw.length > 8_000) throw new RequestError(413, "Converter request is too large.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); }
    catch { throw new RequestError(400, "Invalid converter request."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "Invalid converter request.");
    const token = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    if (!token || token.length > 4096) throw new RequestError(400, "Enter a valid Figma access token.");
    let selection;
    try { selection = parseFigmaSelection(String(body.file ?? ""), String(body.nodeId ?? "")); }
    catch (error) { throw new RequestError(400, error instanceof Error ? error.message : "Invalid Figma selection."); }

    const url = new URL(`https://api.figma.com/v1/files/${selection.fileKey}/nodes`);
    url.searchParams.set("ids", selection.nodeId);
    let figma: Response;
    try {
      figma = await fetch(url, { headers: { "X-Figma-Token": token }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new RequestError(502, "Could not reach Figma. Try again.");
    }
    if (figma.status === 429) throw new RequestError(429, "Figma rate limit reached. Try again later.", figma.headers.get("retry-after") ?? undefined);
    if (figma.status === 403 || figma.status === 401) throw new RequestError(403, "Figma denied access. Check the token scope and file access.");
    if (figma.status === 404) throw new RequestError(404, "Figma file was not found or is not accessible.");
    if (!figma.ok) throw new RequestError(502, "Figma could not return that design.");

    let payload: unknown;
    try { payload = JSON.parse(await limitedText(figma)); }
    catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(502, "Figma returned invalid design data.");
    }
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nodes = record.nodes && typeof record.nodes === "object" ? record.nodes as Record<string, unknown> : {};
    const item = nodes[selection.nodeId];
    const document = item && typeof item === "object" ? (item as Record<string, unknown>).document : null;
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new RequestError(404, "Figma node was not found in this file.");
    const node = document as FigmaLikeNode;
    if (typeof node.id !== "string" || typeof node.name !== "string" || typeof node.type !== "string") {
      throw new RequestError(502, "Figma returned an unsupported node.");
    }
    const result = convertSelectedNode(node);
    const errors = validateFlexflowDocument(result.document);
    if (errors.length) throw new RequestError(422, "Converted JSON needs manual review: " + errors.slice(0, 3).join(" "));
    return NextResponse.json({ document: result.document, warnings: result.warnings, node: { id: node.id, name: node.name, type: node.type } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status, headers: error.retryAfter ? { "Retry-After": error.retryAfter } : undefined });
    console.error("Figma conversion failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Figma conversion failed. Try again." }, { status: 500 });
  }
}

