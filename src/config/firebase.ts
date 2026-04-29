import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth } from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
// Metro resolves @firebase/auth to dist/rn/index.js (via the package's react-native field)
// which exports getReactNativePersistence. The default TypeScript types only expose the
// browser surface, so we use require() with an explicit cast to keep tsc clean.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getReactNativePersistence } = require('@firebase/auth') as {
  getReactNativePersistence: (storage: unknown) => Persistence;
};
import { Firestore, getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const hasFirebaseConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.messagingSenderId,
  firebaseConfig.appId,
].every(Boolean);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (hasFirebaseConfig) {
  if (getApps().length === 0) {
    // First boot: initialize with AsyncStorage persistence so the auth token
    // survives app restarts and APK updates. getAuth() defaults to in-memory
    // in React Native — that's why users were getting logged out every close.
    app = initializeApp(firebaseConfig);
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    // Already initialized (fast refresh / module re-evaluation).
    // getAuth() returns the existing instance which already has persistence set.
    app = getApp();
    auth = getAuth(app);
  }

  db = getFirestore(app);
}

export const firebase = {
  app,
  auth,
  db,
};
