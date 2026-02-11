// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, set, get, child, onValue } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBrAhqoWVQDjAsMztU8ecxngW0ywdFzafQ",
  authDomain: "budget-pro-1cfcc.firebaseapp.com",
  databaseURL: "https://budget-pro-1cfcc-default-rtdb.firebaseio.com",
  projectId: "budget-pro-1cfcc",
  storageBucket: "budget-pro-1cfcc.appspot.com",
  messagingSenderId: "756796109010",
  appId: "1:756796109010:web:fdc3771eb878813fa97d0b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

const STORAGE_KEY = "butce_data_v1";

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnLogin")?.addEventListener("click", async () => {
    await signInWithPopup(auth, provider);
  });

  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    await signOut(auth);
  });
});

onAuthStateChanged(auth, async (user) => {
  const userLabel = document.getElementById("userLabel");
  if (!user) {
    if (userLabel) userLabel.textContent = "Giriş yapılmadı";
    return;
  }

  if (userLabel) userLabel.textContent = user.email;

  const snap = await get(child(ref(db), `users/${user.uid}/appData`));
  if (snap.exists()) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    if (window.render) window.render();
  }

  onValue(ref(db, `users/${user.uid}/appData`), (snap) => {
    if (!snap.exists()) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    if (window.render) window.render();
  });

  const originalSaveData = window.saveData;
  if (typeof originalSaveData === "function") {
    window.saveData = (data) => {
      originalSaveData(data);
      set(ref(db, `users/${user.uid}/appData`), data);
    };
  }
});
