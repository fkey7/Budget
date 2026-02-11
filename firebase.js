// firebase.js (type="module") — Redirect Login (NO POPUP) + Debug Alerts

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
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

const firebaseConfig = {
  apiKey: "AIzaSyBrAhqoWVQDjAsMztU8ecxngW0ywdFzafQ",
  authDomain: "budget-pro-1cfcc.firebaseapp.com",
  databaseURL: "https://budget-pro-1cfcc-default-rtdb.firebaseio.com",
  projectId: "budget-pro-1cfcc",
  storageBucket: "budget-pro-1cfcc.firebasestorage.app",
  messagingSenderId: "756796109010",
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b",
  measurementId: "G-NRMF74RK7W",
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

function alertAuthError(e, prefix = "Login başarısız") {
  const code = e?.code || "";
  const msg = e?.message || String(e);
  console.error(prefix, code, msg, e);

  // Kullanıcıya direkt net hata gösterelim
  alert(`${prefix}\n\n${code}\n${msg}`);

  // En sık görülen hatalarda ne yapacağını da söyleyelim
  if (code === "auth/unauthorized-domain") {
    alert(
      "ÇÖZÜM:\nFirebase Console > Authentication > Settings > Authorized domains\nBuraya şunu ekle:\n\nfkey7.github.io"
    );
  }
  if (code === "auth/operation-not-allowed") {
    alert(
      "ÇÖZÜM:\nFirebase Console > Authentication > Sign-in method\nGoogle provider'ı ENABLE yap."
    );
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  if (!btnLogin) {
    console.warn("btnLogin bulunamadı. ID doğru mu? (id='btnLogin')");
  } else {
    // inline handler varsa iptal
    btnLogin.onclick = null;

    // Eğer buton form içindeyse submit olmasın diye:
    btnLogin.setAttribute("type", "button");

    btnLogin.addEventListener("click", async (e) => {
      try {
        e.preventDefault();
        e.stopPropagation();

        console.log("Login click -> redirect başlatılıyor...");

        // Bu çağrı normalde sayfayı Google'a yönlendirir
        await signInWithRedirect(auth, provider);

        // Buraya normalde gelmez (redirect olur)
        console.log("Redirect çağrısı döndü (normalde dönmemeli).");
      } catch (err) {
        alertAuthError(err, "Login başlatılamadı");
      }
    });
  }

  if (btnLogout) {
    btnLogout.onclick = null;
    btnLogout.setAttribute("type", "button");
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await signOut(auth);
        setUserUI(null);
        lockApp(true);
      } catch (err) {
        alert(`Çıkış hatası: ${err?.message || err}`);
      }
    });
  }

  // Redirect dönüşünü yakala (her yüklemede bir kez)
  try {
    const res = await getRedirectResult(auth);
    if (res?.user) {
      console.log("Redirect result OK:", res.user.email || res.user.uid);
    }
  } catch (err) {
    // Burada hata görürsek artık saklamıyoruz
    alertAuthError(err, "Redirect sonucu alınamadı");
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

  // 1) Cloud varsa → local
  const cloud = await cloudLoad(user.uid);
  if (cloud) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));
    safeRender();
  } else {
    // 2) İlk giriş: local → cloud
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        await cloudSave(user.uid, JSON.parse(raw));
      } catch {}
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
