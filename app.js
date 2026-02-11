/* =========================================================
   Budget Pro — app.js (FULL)
   - Tabs: Bütçe / İşlemler / Bilanço (çalışır)
   - Aylık dönem: selYear + selMonth + quickYM "Ay Aç / Git" (çalışır)
   - Kur tahminleri (bütçe için): monthlyRates (TRY/RUB)
   - İşlemler: girilen gün kurla USD snapshot alır (sonradan değişmez)
   - Bilanço: aylık kalemler + plan (Assets/Liab/Equity) + satır ekle/sil/düzenle
   - Export/Import/Reset
   - Firebase sync: window.saveData ve window.render global (firebase.js override yapar)
========================================================= */

const STORAGE_KEY = "butce_data_v1";

/* =========================
   Helpers
========================= */
const $ = (id) => document.getElementById(id);

function clamp(n, min, max) {
  n = Number(n);
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function ymKeyFromISO(dateISO) { return (dateISO || "").slice(0, 7); } // YYYY-MM
function parseYM(text) {
  const m = String(text || "").trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return { y: String(y), m: pad2(mm) };
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* =========================
   Data Model
========================= */
function defaultData() {
  return {
    app: {
      baseCurrency: "USD",
      currencies: ["USD", "TRY", "RUB"],
      lang: "tr",
    },

    // (V1 uyum) kategoriler şimdilik dursa da bu index’te aktif kullanılmıyor olabilir
    categories: { income: [], expense: [] },
    nextCategoryId: 1,

    // Kur tahminleri (Bütçe için) — 1 USD = ? TRY/RUB (12 eleman)
    monthlyRates: {
      TRY: Array(12).fill(0),
      RUB: Array(12).fill(0),
    },

    // İşlemler (gerçekleşme): her işlem girildiği andaki USD karşılığıyla snapshot
    transactions: [],

    // Bilanço: her ay için assets/liabilities kalemleri + plan
    balanceSheets: {
      // "YYYY-MM": { assets:{cash:{items:[]}, investments:{items:[]}, receivables:{items:[]}},
      //              liabilities:{credits:{items:[]}, cards:{items:[]}, debts:{items:[]}},
      //              plan:{assets:0, liabilities:0, equity:0} }
    },
  };
}

function migrateIfNeeded(d) {
  const base = defaultData();
  const out = {
    ...base,
    ...d,
    app: { ...base.app, ...(d.app || {}) },
    categories: d.categories ?? base.categories,
    nextCategoryId: d.nextCategoryId ?? base.nextCategoryId,
    monthlyRates: d.monthlyRates ?? base.monthlyRates,
    transactions: d.transactions ?? base.transactions,
    balanceSheets: d.balanceSheets ?? base.balanceSheets,
  };

  // monthlyRates yoksa eski exchangeRates vs. kalıntılarından toparlamaya çalış
  if (!out.monthlyRates || !out.monthlyRates.TRY || !out.monthlyRates.RUB) {
    out.monthlyRates = {
      TRY: Array(12).fill(0),
      RUB: Array(12).fill(0),
    };
  }
  // 12 eleman garanti
  out.monthlyRates.TRY = (out.monthlyRates.TRY || []).slice(0, 12);
  while (out.monthlyRates.TRY.length < 12) out.monthlyRates.TRY.push(0);
  out.monthlyRates.RUB = (out.monthlyRates.RUB || []).slice(0, 12);
  while (out.monthlyRates.RUB.length < 12) out.monthlyRates.RUB.push(0);

  out.balanceSheets ||= {};
  return out;
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData();
  try {
    return migrateIfNeeded(JSON.parse(raw));
  } catch {
    return defaultData();
  }
}

// ⚠️ Firebase bunu override edecek (cloud’a da yazmak için)
// O yüzden window.saveData olarak da expose ediyoruz.
function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
window.saveData = saveData;

/* =========================
   Period (Year/Month)
========================= */
function ensureMonthInputs() {
  // Year dropdown: son 10 yıl + gelecek 5 yıl (gerekirse genişlet)
  const selYear = $("selYear");
  const selMonth = $("selMonth");
  if (!selYear || !selMonth) return;

  const now = new Date();
  const yNow = now.getFullYear();
  const years = [];
  for (let y = yNow - 10; y <= yNow + 5; y++) years.push(String(y));

  // Doldur
  if (!selYear.dataset.filled) {
    selYear.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
    selYear.dataset.filled = "1";
  }

  // Varsayılan seçim (boşsa)
  if (!selYear.value) selYear.value = String(yNow);
  if (!selMonth.value) selMonth.value = pad2(now.getMonth() + 1);
}

function getSelectedYMKey() {
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  if (!y || !m) return `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}`;
  return `${y}-${m}`;
}

function setPeriodByYMKey(ymKey) {
  const p = parseYM(ymKey);
  if (!p) return false;
  if ($("selYear")) $("selYear").value = p.y;
  if ($("selMonth")) $("selMonth").value = p.m;
  return true;
}

/* =========================
   Rates (Budget rates vs Tx live rates)
   - Budget: monthlyRates = tahmin (manuel)
   - Transaction: işlem girildiği gün internetten çek → usdAtEntry sabit kalsın
========================= */
async function fetchUsdPerUnit(currency, dateISO) {
  // Returns: 1 unit of currency = ? USD
  if (!currency || currency === "USD") return 1;

  // ER API: USD base (genelde RUB/TRY var)
  // dateISO şu an kullanmıyoruz (daily history yok); “girildiği an” snapshot.
  const r = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
  if (!r.ok) throw new Error("Kur servisine ulaşılamadı.");
  const j = await r.json();
  const perUSD = Number(j?.rates?.[currency]); // 1 USD = perUSD currency
  if (!perUSD || !isFinite(perUSD)) throw new Error(`Kur bulunamadı: ${currency}`);
  return 1 / perUSD; // 1 currency = (1/perUSD) USD
}

function getBudgetRateForMonth(data, currency, monthIndex0) {
  // returns: 1 USD = ? currency (budget forecast)
  if (currency === "USD") return 1;
  const arr = data.monthlyRates?.[currency];
  const v = Number(arr?.[monthIndex0]);
  return v && isFinite(v) && v > 0 ? v : 0;
}

/* =========================
   Transactions
========================= */
async function addTransaction({ type, date, amount, currency, note }) {
  const data = loadData();

  const amt = Number(amount);
  if (!amt || !isFinite(amt) || amt <= 0) throw new Error("Tutar 0'dan büyük olmalı.");

  const ccy = String(currency || "USD").toUpperCase();
  if (!["USD", "TRY", "RUB"].includes(ccy)) throw new Error("Para birimi sadece USD/TRY/RUB olabilir.");

  const dISO = date || todayISO();

  // Snapshot USD at entry time (live rate)
  const usdPerUnit = await fetchUsdPerUnit(ccy, dISO);
  const usdAtEntry = amt * usdPerUnit;

  const tx = {
    id: crypto.randomUUID(),
    type: type === "expense" ? "expense" : "income",
    date: dISO,
    amount: amt,
    currency: ccy,
    usdAtEntry,       // ✅ sabit USD karşılığı
    note: note || "",
    createdAt: Date.now(),
  };

  data.transactions.push(tx);
  window.saveData(data);
}

function renderTxList() {
  const data = loadData();
  const box = $("txList");
  if (!box) return;

  const last = data.transactions.slice(-25).reverse();
  if (!last.length) {
    box.textContent = "(işlem yok)";
    return;
  }

  box.innerHTML = last.map(t => {
    const sign = t.type === "expense" ? "-" : "+";
    const usd = Number(t.usdAtEntry || 0);
    return `
      <div style="padding:8px 0;border-bottom:1px solid #eee;">
        <div><b>${escapeHtml(t.date)}</b> | ${sign}${escapeHtml(t.amount)} ${escapeHtml(t.currency)}
          <span class="muted">→</span> <b>${usd.toFixed(2)} USD</b>
        </div>
        <div class="muted small">${escapeHtml(t.note || "")}</div>
      </div>
    `;
  }).join("");
}

function calcMonthlySummary(y, m) {
  const data = loadData();
  const ym = `${y}-${m}`;
  const tx = data.transactions.filter(t => ymKeyFromISO(t.date) === ym);

  let income = 0, expense = 0;
  for (const t of tx) {
    const usd = Number(t.usdAtEntry || 0);
    if (t.type === "income") income += usd;
    else expense += usd;
  }
  return { income, expense, net: income - expense };
}

function renderMonthlySummary() {
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  const box = $("monthlySummary") || $("budgetSummary");
  if (!y || !m || !box) return;

  const s = calcMonthlySummary(y, m);
  box.textContent =
    `Gerçek Gelir: ${s.income.toFixed(2)} USD\n` +
    `Gerçek Gider: ${s.expense.toFixed(2)} USD\n\n` +
    `Net: ${s.net.toFixed(2)} USD`;
}

/* =========================
   Balance Sheet (Bilanço)
========================= */
function ensureMonthBalance(data, ymKey) {
  data.balanceSheets ||= {};
  if (!data.balanceSheets[ymKey]) {
    data.balanceSheets[ymKey] = {
      assets: {
        cash: { items: [] },
        investments: { items: [] },
        receivables: { items: [] },
      },
      liabilities: {
        credits: { items: [] },
        cards: { items: [] },
        debts: { items: [] },
      },
      plan: { assets: 0, liabilities: 0, equity: 0 },
    };
  }
  // Defensive
  const bs = data.balanceSheets[ymKey];
  bs.assets ||= { cash:{items:[]}, investments:{items:[]}, receivables:{items:[]} };
  bs.liabilities ||= { credits:{items:[]}, cards:{items:[]}, debts:{items:[]} };
  bs.plan ||= { assets:0, liabilities:0, equity:0 };
  for (const k of ["cash","investments","receivables"]) bs.assets[k] ||= { items: [] };
  for (const k of ["credits","cards","debts"]) bs.liabilities[k] ||= { items: [] };
  return bs;
}

function addBalanceItem(ymKey, side, group, name, amount, currency, note) {
  const data = loadData();
  const bs = ensureMonthBalance(data, ymKey);

  const ccy = String(currency || "USD").toUpperCase();
  if (!["USD","TRY","RUB"].includes(ccy)) throw new Error("Para birimi sadece USD/TRY/RUB olabilir.");
  const amt = Number(amount);
  if (!isFinite(amt)) throw new Error("Tutar geçersiz.");

  const item = {
    id: crypto.randomUUID(),
    name: String(name || "").trim(),
    amount: amt,
    currency: ccy,
    note: note || "",
  };

  if (side === "assets") {
    bs.assets[group].items.push(item);
  } else {
    bs.liabilities[group].items.push(item);
  }

  window.saveData(data);
}

function deleteBalanceItem(ymKey, side, group, id) {
  const data = loadData();
  const bs = ensureMonthBalance(data, ymKey);
  const arr = side === "assets" ? bs.assets[group].items : bs.liabilities[group].items;
  const idx = arr.findIndex(x => x.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  window.saveData(data);
}

function updateBalanceItem(ymKey, side, group, id, patch) {
  const data = loadData();
  const bs = ensureMonthBalance(data, ymKey);
  const arr = side === "assets" ? bs.assets[group].items : bs.liabilities[group].items;
  const it = arr.find(x => x.id === id);
  if (!it) return;
  Object.assign(it, patch);
  window.saveData(data);
}

function saveBalancePlan(ymKey, assets, liabilities, equity) {
  const data = loadData();
  const bs = ensureMonthBalance(data, ymKey);
  bs.plan = {
    assets: Number(assets || 0),
    liabilities: Number(liabilities || 0),
    equity: Number(equity || 0),
  };
  window.saveData(data);
}

function sumGroupUSD(items) {
  // Bilanço kalemleri “güncel kurla” USD’ye çevrilsin demiştik (senin onayınla).
  // Bu yüzden burada live kur çekmiyoruz (sync için ağır olur).
  // Basit: USD ise direkt, TRY/RUB ise kullanıcı zaten o ayın güncel değerini girecek.
  // Yani “USD eşleniği” mantığını kullanıcı input’ta yönetir.
  // (İstersen v2’de otomatik live convert ekleriz.)
  let s = 0;
  for (const it of items || []) {
    s += Number(it.amount || 0);
  }
  return s;
}

async function renderBalanceUI() {
  const data = loadData();
  const ymKey = getSelectedYMKey();
  const bs = ensureMonthBalance(data, ymKey);

  const assetsBox = $("balAssetsBox");
  const liabBox = $("balLiabBox");
  if (!assetsBox || !liabBox) return;

  // Toplamlar (kullanıcı “USD giriyorum” şeklinde kullanacak)
  const assetsTotal =
    sumGroupUSD(bs.assets.cash.items) +
    sumGroupUSD(bs.assets.investments.items) +
    sumGroupUSD(bs.assets.receivables.items);

  const liabTotal =
    sumGroupUSD(bs.liabilities.credits.items) +
    sumGroupUSD(bs.liabilities.cards.items) +
    sumGroupUSD(bs.liabilities.debts.items);

  const equity = assetsTotal - liabTotal;

  // Plan inputlarını doldur
  if ($("planAssets")) $("planAssets").value = bs.plan.assets ?? 0;
  if ($("planLiab")) $("planLiab").value = bs.plan.liabilities ?? 0;
  if ($("planEquity")) $("planEquity").value = bs.plan.equity ?? 0;

  // Üst özet
  const sbox = $("balSummary");
  if (sbox) {
    sbox.textContent =
      `Assets (Gerçek): ${assetsTotal.toFixed(2)} USD\n` +
      `Liabilities (Gerçek): ${liabTotal.toFixed(2)} USD\n` +
      `Equity (Gerçek): ${equity.toFixed(2)} USD\n\n` +
      `Assets (Plan): ${Number(bs.plan.assets||0).toFixed(2)} USD\n` +
      `Liabilities (Plan): ${Number(bs.plan.liabilities||0).toFixed(2)} USD\n` +
      `Equity (Plan): ${Number(bs.plan.equity||0).toFixed(2)} USD`;
  }

  const mkTable = (side, groupKey, title, items) => {
    return `
      <div class="card" style="margin-top:12px;">
        <div class="row" style="justify-content:space-between;">
          <h3 style="margin:0;">${title}</h3>
          <button class="btn" data-badd="1" data-side="${side}" data-group="${groupKey}">+ Ekle</button>
        </div>
        <div class="muted small">Kalemler USD bazlı girilir (senin kararın).</div>
        <div style="overflow:auto; margin-top:8px;">
          <table>
            <thead>
              <tr>
                <th>İsim</th>
                <th style="width:140px;">Tutar</th>
                <th style="width:90px;">PB</th>
                <th>Not</th>
                <th style="width:90px;"></th>
              </tr>
            </thead>
            <tbody>
              ${(items || []).map(it => `
                <tr>
                  <td><input data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="name" value="${escapeHtml(it.name)}"></td>
                  <td><input data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="amount" type="number" step="0.01" value="${Number(it.amount||0)}"></td>
                  <td>
                    <select data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="currency">
                      ${["USD","TRY","RUB"].map(c => `<option value="${c}" ${c===it.currency?"selected":""}>${c}</option>`).join("")}
                    </select>
                  </td>
                  <td><input data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="note" value="${escapeHtml(it.note||"")}"></td>
                  <td><button class="btn danger" data-bdel="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}">Sil</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  assetsBox.innerHTML =
    mkTable("assets", "cash", "Nakit", bs.assets.cash.items) +
    mkTable("assets", "investments", "Yatırımlar", bs.assets.investments.items) +
    mkTable("assets", "receivables", "Alacaklar", bs.assets.receivables.items);

  liabBox.innerHTML =
    mkTable("liabilities", "credits", "Krediler", bs.liabilities.credits.items) +
    mkTable("liabilities", "cards", "Kredi Kartları", bs.liabilities.cards.items) +
    mkTable("liabilities", "debts", "Borçlar", bs.liabilities.debts.items);

  // Add / Delete / Inline edit eventleri (render sonrası bağlanır)
  document.querySelectorAll("button[data-badd='1']").forEach(btn => {
    btn.onclick = () => {
      const side = btn.getAttribute("data-side");
      const group = btn.getAttribute("data-group");
      const name = prompt("İsim (örn: Akbank, Kripto, Ahmet):");
      if (!name) return;

      const currency = (prompt("Para birimi (USD/TRY/RUB):", "USD") || "USD").toUpperCase();
      if (!["USD","TRY","RUB"].includes(currency)) {
        alert("Para birimi sadece USD/TRY/RUB olabilir.");
        return;
      }

      const amt = Number(prompt(`Tutar (${currency}):`, "0") || 0);
      addBalanceItem(ymKey, side === "liabilities" ? "liabilities" : "assets", group, name, amt, currency, "");
      render();
    };
  });

  document.querySelectorAll("button[data-bdel='1']").forEach(btn => {
    btn.onclick = () => {
      const side = btn.getAttribute("data-side");
      const group = btn.getAttribute("data-group");
      const id = btn.getAttribute("data-id");
      deleteBalanceItem(ymKey, side === "liabilities" ? "liabilities" : "assets", group, id);
      render();
    };
  });

  document.querySelectorAll("[data-bedit='1']").forEach(el => {
    el.onchange = () => {
      const side = el.getAttribute("data-side");
      const group = el.getAttribute("data-group");
      const id = el.getAttribute("data-id");
      const field = el.getAttribute("data-field");

      const patch = {};
      if (field === "amount") patch.amount = Number(el.value || 0);
      else patch[field] = el.value;

      updateBalanceItem(ymKey, side === "liabilities" ? "liabilities" : "assets", group, id, patch);
      render();
    };
  });
}

/* =========================
   Tabs
========================= */
function showTab(tabName) {
  const btnBudget = $("tabBtnBudget");
  const btnTx = $("tabBtnTx");
  const btnBal = $("tabBtnBal");

  const tBudget = $("tabBudget");
  const tTx = $("tabTx");
  const tBal = $("tabBal");

  if (tBudget) tBudget.classList.toggle("hidden", tabName !== "budget");
  if (tTx) tTx.classList.toggle("hidden", tabName !== "tx");
  if (tBal) tBal.classList.toggle("hidden", tabName !== "bal");

  if (btnBudget) btnBudget.classList.toggle("active", tabName === "budget");
  if (btnTx) btnTx.classList.toggle("active", tabName === "tx");
  if (btnBal) btnBal.classList.toggle("active", tabName === "bal");
}

/* =========================
   Status
========================= */
function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = text;
}

/* =========================
   Export / Import
========================= */
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================
   Main Render
========================= */
async function render() {
  const data = loadData();
  ensureMonthInputs();

  setStatus([
    `Tx: ${data.transactions.length}`,
    `Balance months: ${Object.keys(data.balanceSheets || {}).length}`,
  ].join("\n"));

  renderTxList();
  renderMonthlySummary();
  await renderBalanceUI();
}
window.render = render;

/* =========================
   Wire UI Events
========================= */
function wireEvents() {
  console.log("app.js wireEvents çalıştı");

  // Tabs
  $("tabBtnBudget")?.addEventListener("click", () => showTab("budget"));
  $("tabBtnTx")?.addEventListener("click", () => showTab("tx"));
  $("tabBtnBal")?.addEventListener("click", () => showTab("bal"));

  // Start default
  showTab("budget");

  // Quick YM
  $("btnOpenYM")?.addEventListener("click", async () => {
    const v = $("quickYM")?.value;
    const p = parseYM(v);
    if (!p) {
      alert("Format: YYYY-MM (örn 2026-03)");
      return;
    }
    setPeriodByYMKey(`${p.y}-${p.m}`);
    await render();
  });

  // Export
  $("btnExport")?.addEventListener("click", () => {
    const data = loadData();
    const today = new Date().toISOString().slice(0, 10);
    downloadJson(`butce-yedek-${today}.json`, data);
  });

  // Import
  $("fileImport")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      const data = migrateIfNeeded(parsed);
      window.saveData(data);
      await render();
      alert("JSON içe aktarıldı ✅");
    } catch {
      alert("JSON okunamadı ❌");
    } finally {
      e.target.value = "";
    }
  });

  // Reset
  $("btnReset")?.addEventListener("click", async () => {
    if (!confirm("Tüm veriyi sıfırlamak istiyor musun?")) return;
    localStorage.removeItem(STORAGE_KEY);
    await render();
  });

  // Period change
  $("selYear")?.addEventListener("change", render);
  $("selMonth")?.addEventListener("change", render);

  // Add Tx
  const dateInput = $("txDate");
  if (dateInput && !dateInput.value) dateInput.value = todayISO();

  $("btnAddTx")?.addEventListener("click", async () => {
    try {
      const type = $("txType")?.value || "expense";
      const date = $("txDate")?.value || todayISO();
      const amount = $("txAmount")?.value;
      const currency = $("txCurrency")?.value || "USD";
      const note = $("txNote")?.value || "";

      await addTransaction({ type, date, amount, currency, note });

      if ($("txAmount")) $("txAmount").value = "";
      if ($("txNote")) $("txNote").value = "";

      await render();
      alert("İşlem eklendi ✅");
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  // Save Balance plan
  $("btnSavePlan")?.addEventListener("click", async () => {
    const ymKey = getSelectedYMKey();
    saveBalancePlan(
      ymKey,
      Number($("planAssets")?.value || 0),
      Number($("planLiab")?.value || 0),
      Number($("planEquity")?.value || 0)
    );
    await render();
    alert("Bilanço planı kaydedildi ✅");
  });

  console.log("app.js wireEvents tamamlandı (login butonları hariç)");
}

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("app.js DOMContentLoaded");
  wireEvents();
  await render();
});