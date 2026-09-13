import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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

export function firestore() {
  const firebaseApp = app();
  return firebaseApp ? getFirestore(firebaseApp) : null;
}

export function observeStudioUser(callback: (user: User | null) => void) {
  const firebaseApp = app();
  return firebaseApp ? onAuthStateChanged(getAuth(firebaseApp), callback) : () => undefined;
}

export async function signInToStudio(email: string, password: string) {
  const firebaseApp = app();
  if (!firebaseApp) throw new Error("Firebase is not configured for this deployment.");
  await signInWithEmailAndPassword(getAuth(firebaseApp), email, password);
}

export async function resetStudioPassword(email: string) {
  const firebaseApp = app();
  if (!firebaseApp) throw new Error("Firebase is not configured for this deployment.");
  await sendPasswordResetEmail(getAuth(firebaseApp), email);
}

export async function signOutOfStudio() {
  const firebaseApp = app();
  if (firebaseApp) await signOut(getAuth(firebaseApp));
}

