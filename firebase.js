import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase, ref, set, get, child, onValue
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBrAhqoWVQDjAsMztU8ecxngW0ywdFzafQ",
  authDomain: "budget-pro-1cfcc.firebaseapp.com",
  databaseURL: "https://budget-pro-1cfcc-default-rtdb.firebaseio.com",
  projectId: "budget-pro-1cfcc",
  storageBucket: "budget-pro-1cfcc.firebasestorage.app",
  messagingSenderId: "756796109010",
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const STORAGE_KEY = "butce_data_v1";
const $ = (id) => document.getElementById(id);

function show(el, yes) { if (el) el.style.display = yes ? "" : "none"; }
function lockApp(locked) { const el = $("appLock"); if (el) el.classList.toggle("hidden", !locked); }
function safeRender() { try { window.render && window.render(); } catch {} }

function setUserUI(user) {
  const userLabel = $("userLabel");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  if (!user) {
    if (userLabel) userLabel.textContent = "Giriş yapılmadı";
    show(btnLogin, true); show(btnLogout, false);
  } else {
    if (userLabel) userLabel.textContent = user.email || user.uid;
    show(btnLogin, false); show(btnLogout, true);
  }
}

function showAuthError(prefix, e) {
  const code = e?.code || "";
  const msg = e?.message || String(e);
  console.error(prefix, code, msg, e);
  alert(`${prefix}\n\n${code}\n${msg}`);
}

async function cloudLoad(uid) {
  const snap = await get(child(ref(db), `users/${uid}/appData`));
  return snap.exists() ? snap.val() : null;
}

async function cloudSave(uid, data) {
  await set(ref(db, `users/${uid}/appData`), data);
}

window.addEventListener("DOMContentLoaded", async () => {
  try { await setPersistence(auth, browserLocalPersistence); } catch (e) { console.warn(e); }

  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");

  if (btnLogin) {
    btnLogin.setAttribute("type", "button");
    btnLogin.onclick = null;
    btnLogin.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try { await signInWithRedirect(auth, provider); }
      catch (e) { showAuthError("Login başlatılamadı", e); }
    });
  }

  if (btnLogout) {
    btnLogout.setAttribute("type", "button");
    btnLogout.onclick = null;
    btnLogout.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try { await signOut(auth); }
      catch (e) { showAuthError("Çıkış hatası", e); }
    });
  }

  // Redirect dönüşünü oku — hata varsa alert göreceksin
  try { await getRedirectResult(auth); }
  catch (e) { showAuthError("Redirect sonucu alınamadı", e); }
});

onAuthStateChanged(auth, async (user) => {
  setUserUI(user);

  if (!user) { lockApp(true); return; }
  lockApp(false);

  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    safeRender();
  } else {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { try { await cloudSave(user.uid, JSON.parse(raw)); } catch {} }
  }

  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    safeRender();
  });

  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data);
      cloudSave(user.uid, data).catch(() => {});
    };
  }
});
