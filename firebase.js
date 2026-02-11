// firebase.js  (type="module")
// ✅ Stabil Google Login: önce POPUP, olmazsa REDIRECT fallback
// ✅ Realtime DB sync: users/{uid}/appData
// ✅ saveData override: local + cloud
// ✅ Hata olursa alert + console

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  set,
  get,
  child,
  onValue,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

// ====== Firebase Config (Budget Pro) ======
const firebaseConfig = {
  apiKey: "AIzaSyBrAhqoWVQDjAsMztU8ecxngW0ywdFzafQ",
  authDomain: "budget-pro-1cfcc.firebaseapp.com",
  databaseURL: "https://budget-pro-1cfcc-default-rtdb.firebaseio.com",
  projectId: "budget-pro-1cfcc",
  storageBucket: "budget-pro-1cfcc.firebasestorage.app",
  messagingSenderId: "756796109010",
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b",
};

console.log("Firebase config:", firebaseConfig);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// app.js localStorage key
const STORAGE_KEY = "butce_data_v1";

// ====== UI helpers ======
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
  try {
    if (typeof window.render === "function") window.render();
  } catch (e) {
    console.error("render() hatası:", e);
  }
}

// ====== Cloud helpers ======
async function cloudLoad(uid) {
  const snap = await get(child(ref(db), `users/${uid}/appData`));
  return snap.exists() ? snap.val() : null;
}

async function cloudSave(uid, data) {
  await set(ref(db, `users/${uid}/appData`), data);
}

// ====== Login logic (POPUP -> REDIRECT fallback) ======
async function loginGoogle() {
  console.log("Login başladı (popup denenecek)...");
  try {
    const res = await signInWithPopup(auth, provider);
    console.log("✅ Popup login OK:", res?.user?.email);
    return;
  } catch (e) {
    console.warn("⚠️ Popup login başarısız. Redirect denenecek:", e);

    // Popup engellenmiş olabilir; redirect’e düş
    try {
      await signInWithRedirect(auth, provider);
      // redirect sonrası sayfa değişir
      return;
    } catch (e2) {
      console.error("❌ Redirect login de başarısız:", e2);
      alert("Google giriş başarısız: " + (e2?.message || e2));
      throw e2;
    }
  }
}

async function logoutGoogle() {
  await signOut(auth);
  setUserUI(null);
  lockApp(true);
}

// ====== DOM events + redirect result ======
window.addEventListener("DOMContentLoaded", async () => {
  console.log("firebase.js DOMContentLoaded");

  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  console.log("btnLogin:", btnLogin);
  console.log("btnLogout:", btnLogout);

  if (btnLogin) {
    btnLogin.setAttribute("type", "button");
    btnLogin.onclick = null;
    btnLogin.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await loginGoogle();
      } catch (_) {}
    });
  }

  if (btnLogout) {
    btnLogout.setAttribute("type", "button");
    btnLogout.onclick = null;
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await logoutGoogle();
      } catch (err) {
        console.error("Logout hatası:", err);
      }
    });
  }

  // Redirect dönüşünü yakala (redirect fallback kullanırsak buradan user gelir)
  try {
    console.log("Redirect result kontrol ediliyor...");
    const rr = await getRedirectResult(auth);
    console.log("Redirect result:", rr ? (rr.user?.email || rr.user?.uid) : null);
    if (rr?.user) {
      alert("Giriş başarılı ✅ " + (rr.user.email || rr.user.uid));
    }
  } catch (err) {
    console.error("getRedirectResult hata:", err);
    alert("Redirect sonucu okunamadı: " + (err?.message || err));
  }
});

// ====== Auth state + Sync ======
onAuthStateChanged(auth, async (user) => {
  console.log("Auth state:", user ? (user.email || user.uid) : "null");

  setUserUI(user);

  if (!user) {
    lockApp(true);
    return;
  }

  lockApp(false);

  try {
    // 1) Cloud varsa local'e al
    const cloud = await cloudLoad(user.uid);
    if (cloud) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
      safeRender();
    } else {
      // 2) Cloud yoksa local'i cloud'a yükle
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          await cloudSave(user.uid, JSON.parse(raw));
        } catch (e) {
          console.warn("İlk cloud push hata:", e);
        }
      }
    }

    // 3) Live sync: cloud değişirse local güncelle
    onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
      if (!snap.exists()) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
      safeRender();
    });

    // 4) saveData override: her kayıtta cloud'a da yaz
    const originalSaveData = window.saveData;
    if (typeof originalSaveData === "function") {
      window.saveData = (data) => {
        originalSaveData(data); // local
        cloudSave(user.uid, data).catch((e) => console.error("Cloud save hata:", e));
      };
      console.log("saveData override OK");
    } else {
      console.warn("window.saveData bulunamadı (app.js global değil).");
    }
  } catch (err) {
    console.error("Auth state işleme hatası:", err);
    alert("Sync hatası: " + (err?.message || err));
  }
});
