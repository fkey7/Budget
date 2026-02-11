// firebase.js  (ES Module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
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

/* =========================
   🔴 BURAYI DOLDUR
   Firebase Console > Project Settings > Your Apps > Web App
========================= */
const firebaseConfig = {
  apiKey: "BURAYA_APIKEY",
  authDomain: "BURAYA_AUTHDOMAIN",
  databaseURL: "BURAYA_DATABASEURL",
  projectId: "BURAYA_PROJECTID",
  storageBucket: "BURAYA_STORAGEBUCKET",
  messagingSenderId: "BURAYA_SENDERID",
  appId: "BURAYA_APPID"
};

/* ========================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

const STORAGE_KEY = "butce_data_v1";

/* =========================
   UI Helpers
========================= */

function setUserUI(user) {
  const userLabel = document.getElementById("userLabel");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const lock = document.getElementById("appLock");

  if (!user) {
    if (userLabel) userLabel.textContent = "Giriş yapılmadı";
    if (btnLogin) btnLogin.style.display = "";
    if (btnLogout) btnLogout.style.display = "none";
    if (lock) lock.classList.remove("hidden");
  } else {
    if (userLabel) userLabel.textContent = user.email || user.uid;
    if (btnLogin) btnLogin.style.display = "none";
    if (btnLogout) btnLogout.style.display = "";
    if (lock) lock.classList.add("hidden");
  }
}

/* =========================
   Cloud
========================= */

async function cloudLoad(uid) {
  const snapshot = await get(child(ref(db), `users/${uid}/appData`));
  return snapshot.exists() ? snapshot.val() : null;
}

async function cloudSave(uid, data) {
  await set(ref(db, `users/${uid}/appData`), data);
}

/* =========================
   Login Events
========================= */

window.addEventListener("DOMContentLoaded", () => {

  document.getElementById("btnLogin")?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      alert("Login başarısız: " + err.message);
    }
  });

  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    await signOut(auth);
  });

});

/* =========================
   Auth State
========================= */

onAuthStateChanged(auth, async (user) => {

  setUserUI(user);

  if (!user) return;

  // 1️⃣ Cloud'dan veri çek
  const cloud = await cloudLoad(user.uid);

  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    if (window.render) window.render();
  } else {
    // İlk giriş → local varsa cloud'a yaz
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        await cloudSave(user.uid, JSON.parse(raw));
      } catch {}
    }
  }

  // 2️⃣ Canlı senkron
  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    if (window.render) window.render();
  });

  // 3️⃣ saveData override
  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data);
      cloudSave(user.uid, data).catch(() => {});
    };
  }

});
