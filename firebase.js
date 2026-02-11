// firebase.js (type="module") - STABLE VERSION

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  child,
  onValue
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBrAhqoWVQDjAsMztU8ecxngW0ywdFzafQ",
  authDomain: "budget-pro-1cfcc.firebaseapp.com",
  databaseURL: "https://budget-pro-1cfcc-default-rtdb.firebaseio.com",
  projectId: "budget-pro-1cfcc",
  storageBucket: "budget-pro-1cfcc.firebasestorage.app",
  messagingSenderId: "756796109010",
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

const STORAGE_KEY = "butce_data_v1";

function show(el, yes) {
  if (!el) return;
  el.style.display = yes ? "" : "none";
}

function lockApp(locked) {
  const lock = document.getElementById("appLock");
  if (!lock) return;
  lock.classList.toggle("hidden", !locked);
}

function setUserUI(user) {
  const userLabel = document.getElementById("userLabel");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  if (!user) {
    if (userLabel) userLabel.textContent = "Giriş yapılmadı";
    show(btnLogin, true);
    show(btnLogout, false);
  } else {
    if (userLabel) userLabel.textContent = user.email || user.uid;
    show(btnLogin, false);
    show(btnLogout, true);
  }
}

async function cloudLoad(uid) {
  const snap = await get(child(ref(db), `users/${uid}/appData`));
  return snap.exists() ? snap.val() : null;
}

async function cloudSave(uid, data) {
  await set(ref(db, `users/${uid}/appData`), data);
}

function safeRender() {
  try { window.render && window.render(); } catch {}
}

window.addEventListener("DOMContentLoaded", async () => {
  // Butonlar submit olmasın
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  if (btnLogin) {
    btnLogin.setAttribute("type", "button");
    btnLogin.onclick = null;
    btnLogin.addEventListener("click", async (e) => {
      e.preventDefault();
      await signInWithRedirect(auth, provider);
    });
  }

  if (btnLogout) {
    btnLogout.setAttribute("type", "button");
    btnLogout.onclick = null;
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      await signOut(auth);
      setUserUI(null);
      lockApp(true);
    });
  }

  // Redirect dönüşünü yakala (hata yoksa sessiz)
  try { await getRedirectResult(auth); } catch {}
});

onAuthStateChanged(auth, async (user) => {
  setUserUI(user);

  if (!user) {
    lockApp(true);
    return;
  }
  lockApp(false);

  // Cloud -> local (varsa)
  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    safeRender();
  } else {
    // Cloud yoksa local -> cloud (ilk kurulum)
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { await cloudSave(user.uid, JSON.parse(raw)); } catch {}
    }
  }

  // Live sync
  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    safeRender();
  });

  // saveData override
  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data);
      cloudSave(user.uid, data).catch(() => {});
    };
  }
});
