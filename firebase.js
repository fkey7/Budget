// firebase.js  (type="module" olarak çalışacak)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, set, get, child, onValue } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

// 🔴 BURAYI Firebase Console > Project settings > Web app config'ten doldur
const firebaseConfig = {
  apiKey: "PASTE_HERE",
  authDomain: "PASTE_HERE",
  databaseURL: "PASTE_HERE",
  projectId: "PASTE_HERE",
  storageBucket: "PASTE_HERE",
  messagingSenderId: "PASTE_HERE",
  appId: "PASTE_HERE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

// app.js içinde kullandığın localStorage key'ini BURAYA yaz.
// Senin v1’de genelde: "butce_data_v1"
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

// Login butonları
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnLogin")?.addEventListener("click", async () => {
    await signInWithPopup(auth, provider);
  });

  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    await signOut(auth);
    setUserUI(null);
    // İstersen çıkışta ekranı kilitleyeceğiz (sonraki adım)
  });
});

// Auth state
onAuthStateChanged(auth, async (user) => {
  setUserUI(user);

  // Login yoksa: veri göstermeyelim (güvenlik)
  if (!user) {
    document.getElementById("appLock")?.classList.remove("hidden");
    return;
  }

  // Login varsa: kilidi kaldır
  document.getElementById("appLock")?.classList.add("hidden");

  // 1) Cloud varsa → local'e yaz
  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    if (window.render) window.render();
  } else {
    // 2) Cloud yoksa → local varsa cloud'a yükle (ilk giriş)
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const local = JSON.parse(raw);
        await cloudSave(user.uid, local);
      } catch {}
    }
  }

  // 3) Canlı sync: cloud değişirse local'i güncelle
  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    if (window.render) window.render();
  });

  // 4) saveData() override: her kayıtta cloud'a da yaz
  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data);               // local
      cloudSave(user.uid, data).catch(()=>{}); // cloud
    };
  }
});
