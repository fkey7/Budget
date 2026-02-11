// firebase.js (type="module") — Budget Pro (STABLE + DIAGNOSTIC)
// - Google Sign-in: Redirect (no popup)
// - Shows REAL Firebase Auth errors (no silent catch)
// - Realtime DB per-user sync: users/{uid}/appData
// - Overrides window.saveData (app.js) to also cloudSave

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

// ✅ Firebase Console > Project settings > Your apps (Web app) config
// NOTE: databaseURL mutlaka RTDB URL olmalı (Realtime Database)
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
provider.setCustomParameters({ prompt: "select_account" });

// app.js’deki STORAGE_KEY ile aynı olmalı
const STORAGE_KEY = "butce_data_v1";

function $(id) { return document.getElementById(id); }

function show(el, yes) {
  if (!el) return;
  el.style.display = yes ? "" : "none";
}

function lockApp(locked) {
  const lock = $("appLock");
  if (!lock) return;
  lock.classList.toggle("hidden", !locked);
}

function setUserUI(user) {
  const userLabel = $("userLabel");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");

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

  // Kullanıcıya net göster
  alert(`${prefix}\n\n${code}\n${msg}\n\n(Detay için Console’a bak)`);

  // Sık hatalarda net çözüm:
  if (code === "auth/unauthorized-domain") {
    alert(
      "ÇÖZÜM:\nFirebase Console > Authentication > Settings > Authorized domains\nŞunu ekle:\n\nfkey7.github.io"
    );
  }
  if (code === "auth/operation-not-allowed") {
    alert(
      "ÇÖZÜM:\nFirebase Console > Authentication > Sign-in method\nGoogle provider’ı ENABLE yap."
    );
  }
  if (code === "auth/invalid-api-key") {
    alert(
      "ÇÖZÜM:\nFirebase Console > Project settings > Your apps (Web app)\nOradaki config’ten apiKey/authDomain/appId’yi birebir kopyala."
    );
  }
}

async function cloudLoad(uid) {
  const snap = await get(child(ref(db), `users/${uid}/appData`));
  return snap.exists() ? snap.val() : null;
}

async function cloudSave(uid, data) {
  await set(ref(db, `users/${uid}/appData`), data);
}

window.addEventListener("DOMContentLoaded", async () => {
  // 0) Persistence: bazı tarayıcılarda redirect sonrası user “NO USER” kalmasın diye şart.
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn("setPersistence error:", e);
  }

  // 1) Button wiring (submit olmasın)
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");

  if (btnLogin) {
    btnLogin.onclick = null;
    btnLogin.setAttribute("type", "button");

    btnLogin.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
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
      ev.stopPropagation();
      try {
        await signOut(auth);
        setUserUI(null);
        lockApp(true);
      } catch (e) {
        showAuthError("Çıkış hatası", e);
      }
    });
  }

  // 2) Redirect dönüşünü MUTLAKA oku (hata varsa burada göreceğiz)
  // Not: Google’dan dönünce burası çalışır.
  try {
    await getRedirectResult(auth);
  } catch (e) {
    showAuthError("Redirect sonucu alınamadı", e);
  }
});

// 3) Auth state (asıl karar noktası)
onAuthStateChanged(auth, async (user) => {
  setUserUI(user);

  if (!user) {
    lockApp(true);
    return;
  }
  lockApp(false);

  // 4) Cloud varsa → local’e yaz
  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    safeRender();
  } else {
    // Cloud yoksa → local varsa cloud’a yükle (ilk giriş)
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { await cloudSave(user.uid, JSON.parse(raw)); } catch {}
    }
  }

  // 5) Live sync: cloud değişirse local’i güncelle
  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    safeRender();
  });

  // 6) saveData override (app.js) — local + cloud
  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data);
      cloudSave(user.uid, data).catch(() => {});
    };
  } else {
    console.warn("window.saveData bulunamadı. app.js önce yüklenmeli.");
  }
});
