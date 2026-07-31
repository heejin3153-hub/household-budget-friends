import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// ⚠️ 여기를 새로 만드신 "데모용" Firebase 프로젝트 설정값으로 바꿔주세요.
// (가족용 프로젝트랑 다른, 새로 만든 프로젝트여야 해요)
const firebaseConfig = {
  apiKey: "AIzaSyD28F1wH7Sv_qskgnOnlfR8hdyeluYEpM0",
  authDomain: "share-household-budget.firebaseapp.com",
  projectId: "share-household-budget",
  storageBucket: "share-household-budget.firebasestorage.app",
  messagingSenderId: "576634205306",
  appId: "1:576634205306:web:2ec6690462edf3c64af7c3",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}
export function signOutUser() {
  return signOut(auth);
}
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// 데모 버전은 "누구나 로그인 가능 + 각자 자기 데이터만 보임" 구조예요.
// 그래서 저장 경로에 로그인한 사람의 고유 ID(uid)를 끼워넣어서, 사람마다 데이터가 자동으로 분리돼요.
let currentUid = null;
export function setCurrentUid(uid) {
  currentUid = uid;
}

export async function storageGet(key) {
  if (!currentUid) return null;
  try {
    const ref = doc(db, "users", currentUid, "data", key);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { value: snap.data().value };
  } catch (e) {
    console.error("storageGet error", key, e);
    return null;
  }
}

export async function storageSet(key, value) {
  if (!currentUid) return false;
  try {
    const ref = doc(db, "users", currentUid, "data", key);
    await setDoc(ref, { value: JSON.stringify(value), updatedAt: Date.now() });
    return true;
  } catch (e) {
    console.error("storageSet error", key, e);
    return false;
  }
}
