import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";
import { getStorage, FirebaseStorage } from "firebase/storage";

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

let dynamicConfig: any = null;

export async function initFirebase() {
  if (app) return;
  
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    dynamicConfig = config.firebase;
    
    if (!dynamicConfig.apiKey) {
      console.error("Firebase config is empty from server");
      return;
    }
    
    app = initializeApp(dynamicConfig);
    console.log("🔥 Firebase initialized with server-side config");
  } catch (err) {
    console.error("Failed to fetch firebase config:", err);
  }
}

function getFirebaseApp() {
  if (!app) {
    // フォールバック: 環境変数があればそれを使う
    const fallbackConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    };
    
    if (fallbackConfig.apiKey) {
      app = initializeApp(fallbackConfig);
      return app;
    }
    
    throw new Error("データベースの設定が読み込めていません。ページを再読み込みするか、環境変数を確認してください。");
  }
  return app;
}

export function getDb(): Firestore {
  if (!db) {
    db = getFirestore(getFirebaseApp());
  }
  return db;
}

export function getAuthInstance(): Auth {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
  }
  return auth;
}

export function getStorageInstance(): FirebaseStorage {
  if (!storage) {
    storage = getStorage(getFirebaseApp());
  }
  return storage;
}
