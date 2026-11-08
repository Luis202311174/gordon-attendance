
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBrvanXwxM1S7QNMr39fU9oOhk_FkpcyQM",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "group1studentattendancesystem.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://group1studentattendancesystem-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "group1studentattendancesystem",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:917606393401:web:66650996e7fb52fc974fe8",
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const auth = getAuth(app);
