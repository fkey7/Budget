// firebase.js (type="module") - DÜZELTİLMİŞ VERSION

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

// 🔴 DÜZELTME: databaseURL'deki boşluk kaldırıldı!
const firebaseConfig = {
  apiKey: "AIzaSyBrAhqoWVQDjAsMztU8ecxngW0ywdFzafQ",
  authDomain: "budget-pro-1cfcc.firebaseapp.com",
  databaseURL: "https://budget-pro-1cfcc-default-rtdb.firebaseio.com", // ← BOŞLUK YOK!
  projectId: "budget-pro-1cfcc",
  storageBucket: "budget-pro-1cfcc.firebasestorage.app",
  messagingSenderId: "756796109010",
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b",
  measurementId: "G-NRMF74RK7W" // ← Analytics için eklendi
};

console.log("Firebase config:", firebaseConfig);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

// 🔴 EKLEME: Google login ayarları
provider.setCustomParameters({
  prompt: 'select_account' // Her zaman hesap seçimi göster
});

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
    
    // Önceki event'leri temizle
    const newBtn = btnLogin.cloneNode(true);
    btnLogin.parentNode.replaceChild(newBtn, btnLogin);
    
    newBtn.addEventListener("click", async (e) => {
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

  // Redirect dönüşünü yakala - DÜZELTİLMİŞ
  try {
    console.log("Redirect result kontrol ediliyor...");
    const result = await getRedirectResult(auth);
    console.log("Redirect result:", result);
    
    if (result) {
      console.log("✅ Redirect başarılı! User:", result.user);
      // Kullanıcı bilgilerini göster
      alert("Giriş başarılı! Hoş geldin " + result.user.displayName);
    } else {
      console.log("ℹ️ Redirect result null - ilk yükleme veya redirect yok");
    }
  } catch (err) {
    console.error("❌ Redirect hatası:", err);
    console.error("Hata kodu:", err.code);
    console.error("Hata mesajı:", err.message);
    alert("Redirect hatası: " + err.message);
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
  try {
    const cloud = await cloudLoad(user.uid);
    if (cloud) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
      safeRender();
    } else {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        await cloudSave(user.uid, JSON.parse(raw));
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
  } catch (err) {
    console.error("Auth state işleme hatası:", err);
  }
});
