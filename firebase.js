// firebase.js  (type="module")
// Redirect login + FULL DEBUG (shows real auth error codes)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
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
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b",
  measurementId: "G-NRMF74RK7W"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

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

function safeRender() {
  try { window.render && window.render(); } catch {}
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
  // ✅ persistence (bazı tarayıcılarda gerekli)
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn("setPersistence error:", e);
  }

  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  if (btnLogin) {
    btnLogin.onclick = null;
    btnLogin.setAttribute("type", "button");

    btnLogin.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        console.log("LOGIN: signInWithRedirect starting...");
        await signInWithRedirect(auth, provider);
      } catch (e) {
        showAuthError("Login başlatılamadı", e);
      }
    });
  }

  if (btnLogout) {
    btnLogout.onclick = null;
    btnLogout.setAttribute("type", "button");

    btnLogout.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        await signOut(auth);
        setUserUI(null);
        lockApp(true);
      } catch (e) {
        showAuthError("Çıkış hatası", e);
      }
    });
  }

  // ✅ Redirect dönüşü burada yakalanır. Hata varsa buradan öğreniriz.
  try {
    const res = await getRedirectResult(auth);
    if (res?.user) {
      alert("Redirect OK: " + (res.user.email || res.user.uid));
      console.log("Redirect OK:", res.user);
    } else {
      console.log("Redirect result: empty (ilk açılış olabilir)");
    }
  } catch (e) {
    showAuthError("Redirect sonucu alınamadı", e);
  }
});

onAuthStateChanged(auth, async (user) => {
  alert("Auth state changed: " + (user ? (user.email || user.uid) : "NO USER"));
  setUserUI(user);

  if (!user) {
    lockApp(true);
    return;
  }
  lockApp(false);

  // 1) Cloud -> local
  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    safeRender();
  } else {
    // 2) local -> cloud (first login)
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { await cloudSave(user.uid, JSON.parse(raw)); } catch {}
    }
  }

  // 3) Live sync
  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    safeRender();
  });

  // 4) saveData override
  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data);
      cloudSave(user.uid, data).catch(() => {});
    };
  }
});
