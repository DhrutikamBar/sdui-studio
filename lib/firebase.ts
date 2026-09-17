import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type Auth, type User } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(config).every(Boolean);

function app(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  return getApps().length ? getApp() : initializeApp(config);
}

function useLocalEmulators() {
  return process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true"
    && typeof window !== "undefined"
    && ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function studioAuth(firebaseApp: FirebaseApp): Auth {
  const auth = getAuth(firebaseApp);
  if (useLocalEmulators() && !auth.emulatorConfig) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return auth;
}

let emulatedFirestore: Firestore | null = null;

export function firestore() {
  const firebaseApp = app();
  if (!firebaseApp) return null;
  const db = getFirestore(firebaseApp);
  if (useLocalEmulators() && emulatedFirestore !== db) {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    emulatedFirestore = db;
  }
  return db;
}

export function observeStudioUser(callback: (user: User | null) => void) {
  const firebaseApp = app();
  if (!firebaseApp) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(studioAuth(firebaseApp), callback);
}

export async function signInToStudio(email: string, password: string) {
  const firebaseApp = app();
  if (!firebaseApp) throw new Error("Firebase is not configured for this deployment.");
  await signInWithEmailAndPassword(studioAuth(firebaseApp), email, password);
}

export async function studioIdToken(): Promise<string> {
  const firebaseApp = app();
  const user = firebaseApp ? studioAuth(firebaseApp).currentUser : null;
  if (!user) throw new Error("Sign in before saving to the shared workspace.");
  return user.getIdToken();
}

export async function resetStudioPassword(email: string) {
  const firebaseApp = app();
  if (!firebaseApp) throw new Error("Firebase is not configured for this deployment.");
  await sendPasswordResetEmail(studioAuth(firebaseApp), email);
}

export async function signOutOfStudio() {
  const firebaseApp = app();
  if (firebaseApp) await signOut(studioAuth(firebaseApp));
}

