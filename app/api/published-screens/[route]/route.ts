import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function database() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase Admin project ID is not configured.");
  const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId });
  return getFirestore(app);
}

const notFound = () => NextResponse.json({ error: "Published screen not found." }, { status: 404 });

export async function GET(_request: NextRequest, context: { params: Promise<{ route: string }> }) {
  const { route } = await context.params;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(route)) {
    return NextResponse.json({ error: "Invalid screen route." }, { status: 400 });
  }

  try {
    const db = database();
    const matches = await db.collection("sduiScreens").where("route", "==", route).get();
    const screens = matches.docs.filter((doc) => {
      const data = doc.data();
      return !data.projectId && data.status === "Published";
    });
    if (screens.length !== 1) return notFound();

    const screen = screens[0];
    const metadata = screen.data();
    let version;
    if (typeof metadata.publishedVersionId === "string") {
      version = await screen.ref.collection("versions").doc(metadata.publishedVersionId).get();
    } else {
      // Screens published before version pointers were introduced.
      const versions = await screen.ref.collection("versions").where("status", "==", "Published").get();
      version = versions.docs.sort((a, b) => (b.data().number || 0) - (a.data().number || 0))[0];
    }
    if (!version?.exists) return notFound();
    const release = version.data();
    if (release?.status !== "Published" || release.route !== route || typeof release.document !== "string") return notFound();
    return NextResponse.json({
      route,
      version: release.number,
      document: release.document,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Published screen delivery failed", error);
    return NextResponse.json({ error: "Published screen is temporarily unavailable." }, { status: 500 });
  }
}

