import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

/**
 * Default Bella Catalog Firebase web config (public; safe to ship in the client).
 * Vite env vars override these at build time — use them when pointing at another project.
 */
const defaultFirebaseConfig = {
  apiKey: "AIzaSyDrLDY-yCgljlDTR0HyYuOXgIXK_YRSrGQ",
  authDomain: "bellacatalog-7346d.firebaseapp.com",
  projectId: "bellacatalog-7346d",
  storageBucket: "bellacatalog-7346d.firebasestorage.app",
  messagingSenderId: "46111985702",
  appId: "1:46111985702:web:71b868a6cde8c11e04d6e7",
  measurementId: "G-LL5VW9M0E0",
} as const;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || defaultFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || defaultFirebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || defaultFirebaseConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || defaultFirebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || defaultFirebaseConfig.appId,
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || defaultFirebaseConfig.measurementId,
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getFirestore(firebaseApp);
export const firebaseStorage = getStorage(firebaseApp);
export const firebaseFunctions = getFunctions(firebaseApp, "us-central1");
