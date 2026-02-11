// firebase.js  (type="module")

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  child,
  onValue
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

// ✅ Firebase Console > Project settings > (Web app) config
// ⚠️ databaseURL mutlaka dolu olmalı (Realtime Database URL)
const firebaseConfig = {
  apiKey: "AIzaSyBrAhqoWVQDjAsMztU8ecxngW0ywdFzafQ",
  authDomain: "budget-pro-1cfcc.firebaseapp.com",
  databaseURL: "https://budget-pro-1cfcc-default-rtdb.firebaseio.com",
  projectId: "budget-pro-1cfcc",
  storageBucket: "budget-pro-1cfcc.firebasestorage.app",
  messagingSenderId: "756796109010",
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b",
  measurementId: "G-NRMF74RK7W"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

// app.js içindeki localStorage key’in
const STORAGE_KEY = "butce_data_v1";

function show(el, yes) {
  if (!el) return;
  el.style.display = yes ? "" : "none";
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

function lockApp(locked) {
  const lock = document.getElementById("appLock");
  if (!lock) return;
  lock.classList.toggle("hidden", !locked);
}

// Login/Logout events
window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("btnLogin")?.addEventListener("click", async () => {
    // ✅ Redirect login (popup yok)
    await signInWithRedirect(auth, provider);
  });

  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    await signOut(auth);
    setUserUI(null);
    lockApp(true);
  });

  // Redirect dönüş sonucunu yakala (bazı tarayıcılarda gerekli)
  try {
    await getRedirectResult(auth);
  } catch (e) {
    console.warn("Redirect result error:", e?.code || e?.message || e);
  }
});

// Auth state
onAuthStateChanged(auth, async (user) => {
  setUserUI(user);

  // Login yoksa: ekranı kilitle
  if (!user) {
    lockApp(true);
    return;
  }

  // Login varsa: kilidi kaldır
  lockApp(false);

  // 1) Cloud varsa → local’e yaz
  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    if (window.render) window.render();
  } else {
    // 2) Cloud yoksa → local varsa cloud’a yükle (ilk giriş)
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const local = JSON.parse(raw);
        await cloudSave(user.uid, local);
      } catch {}
    }
  }

  // 3) Canlı sync: cloud değişirse local’i güncelle
  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    if (window.render) window.render();
  });

  // 4) saveData() override: her kayıtta cloud’a da yaz
  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data); // local
      cloudSave(user.uid, data).catch(() => {});
    };
  }
});
