// firebase.js (type="module") - DEBUG VERSION

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

console.log("Firebase config:", firebaseConfig);

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
  try { window.render && window.render(); } catch(e) { console.error("Render hatası:", e); }
}

// ============ DOMContentLoaded ============
window.addEventListener("DOMContentLoaded", async () => {
  console.log("DOMContentLoaded tetiklendi");
  
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  
  console.log("btnLogin element:", btnLogin);
  console.log("btnLogout element:", btnLogout);

  if (btnLogin) {
    console.log("Login butonu bulundu, event ekleniyor...");
    btnLogin.setAttribute("type", "button");
    
    // Önceki event'leri temizle (varsa)
    btnLogin.onclick = null;
    
    btnLogin.addEventListener("click", async (e) => {
      console.log("Login butonuna tıklandı!");
      e.preventDefault();
      e.stopPropagation();
      
      try {
        console.log("signInWithRedirect çağrılıyor...");
        await signInWithRedirect(auth, provider);
        console.log("signInWithRedirect tamamlandı");
      } catch (err) {
        console.error("Login hatası:", err);
        alert("Giriş hatası: " + err.message);
      }
    });
  } else {
    console.error("btnLogin bulunamadı!");
  }

  if (btnLogout) {
    btnLogout.setAttribute("type", "button");
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await signOut(auth);
      setUserUI(null);
      lockApp(true);
    });
  }

  // Redirect dönüşünü yakala
  try {
    console.log("Redirect result kontrol ediliyor...");
    const result = await getRedirectResult(auth);
    console.log("Redirect result:", result);
    if (result) {
      console.log("Redirect sonucu - user:", result.user);
    }
  } catch (err) {
    console.error("Redirect hatası:", err);
  }
});

// ============ Auth State Değişikliği ============
onAuthStateChanged(auth, async (user) => {
  console.log("Auth state değişti:", user ? user.email : "null");
  setUserUI(user);

  if (!user) {
    lockApp(true);
    return;
  }
  lockApp(false);

  // Cloud -> local
  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    safeRender();
  } else {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        await cloudSave(user.uid, JSON.parse(raw));
      } catch (e) {
        console.error("Cloud save hatası:", e);
      }
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
      cloudSave(user.uid, data).catch((e) => console.error("Sync hatası:", e));
    };
  }
});
