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
  derivedKey = null; // 계정 바뀌면 이전 암호화 키는 버려요
}

// ── PIN 기반 암호화 ──────────────────────────────────────────
// 4자리 PIN으로 암호화 키를 만들어요. 이 키는 메모리에만 있고 어디에도 저장 안 해요.
// (프로젝트 관리자인 저조차도 Firestore 콘솔에서 원본 내용을 못 봐요, 암호화된 문자열만 보여요)
let derivedKey = null;

function bytesToBase64(bytes) {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function randomSaltB64() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}
async function deriveKeyFromPin(pin, saltB64) {
  const enc = new TextEncoder();
  const salt = base64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptString(plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, derivedKey, enc.encode(plaintext));
  return JSON.stringify({ iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) });
}
async function decryptString(payload) {
  const { iv, data } = JSON.parse(payload);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, derivedKey, base64ToBytes(data));
  return new TextDecoder().decode(dec);
}

// 앱이 로그인 직후 이 함수를 호출해요.
// 처음 쓰는 사람이면 PIN을 새로 설정하고, 이미 쓰던 사람이면 PIN이 맞는지 확인해요.
export async function checkPinExists() {
  if (!currentUid) return false;
  try {
    const metaRef = doc(db, "users", currentUid, "data", "_pin_meta");
    const snap = await getDoc(metaRef);
    return snap.exists();
  } catch (e) {
    return false;
  }
}

export async function setupOrVerifyPin(pin) {
  if (!currentUid) return { ok: false, error: "로그인 정보가 없어요." };
  try {
    const metaRef = doc(db, "users", currentUid, "data", "_pin_meta");
    const snap = await getDoc(metaRef);
    if (!snap.exists()) {
      const salt = randomSaltB64();
      derivedKey = await deriveKeyFromPin(pin, salt);
      const verify = await encryptString("ok");
      await setDoc(metaRef, { salt, verify });
      return { ok: true, isNew: true };
    } else {
      const { salt, verify } = snap.data();
      derivedKey = await deriveKeyFromPin(pin, salt);
      try {
        const dec = await decryptString(verify);
        if (dec === "ok") return { ok: true, isNew: false };
      } catch (e) {}
      derivedKey = null;
      return { ok: false, error: "PIN이 틀렸어요. 다시 확인해주세요." };
    }
  } catch (e) {
    derivedKey = null;
    return { ok: false, error: "확인 중 문제가 생겼어요. 다시 시도해주세요." };
  }
}

export async function storageGet(key) {
  if (!currentUid || !derivedKey) return null;
  try {
    const ref = doc(db, "users", currentUid, "data", key);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const decrypted = await decryptString(snap.data().value);
    return { value: decrypted };
  } catch (e) {
    console.error("storageGet error", key, e);
    return null;
  }
}

export async function storageSet(key, value) {
  if (!currentUid || !derivedKey) return false;
  try {
    const ref = doc(db, "users", currentUid, "data", key);
    const encrypted = await encryptString(JSON.stringify(value));
    await setDoc(ref, { value: encrypted, updatedAt: Date.now() });
    return true;
  } catch (e) {
    console.error("storageSet error", key, e);
    return false;
  }
}
