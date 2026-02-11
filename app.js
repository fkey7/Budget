/* =========================
   Budget Pro - app.js (v2)
   - Transactions: USD snapshot at entry date
   - Balance Sheet: store amount+currency, show USD with CURRENT FX (latest)
   - No imports
   - Firebase sync compatible (firebase.js overrides window.saveData)
========================= */

const STORAGE_KEY = "butce_data_v1";

/* =========================
   Data Model
========================= */
function defaultData() {
  return {
    app: { version: 2, baseCurrency: "USD", currencies: ["USD", "TRY", "RUB"] },

    categories: { income: [], expense: [] },
    nextCategoryId: 1,

    // Budget forecast monthly rates (optional future use)
    monthlyRates: { TRY: {}, RUB: {} },

    // Transactions: store usdAmount snapshot at entry time
    transactions: [],
    nextTxId: 1,

    // Balance sheets: store items with {amount, currency} (current FX to USD for display)
    balanceSheets: {}
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
    nextTxId: d.nextTxId ?? base.nextTxId,
    balanceSheets: d.balanceSheets ?? base.balanceSheets
  };

  // Ensure tx snapshot fields exist
  if (Array.isArray(out.transactions)) {
    out.transactions = out.transactions.map((t) => {
      if (!t) return t;
      if (typeof t.usdAmount === "number" && typeof t.usdRate === "number") return t;

      const amount = Number(t.amount || 0);
      const currency = t.currency || "USD";
      const usdRate = Number(t.usdRate || (currency === "USD" ? 1 : 0));
      const usdAmount = currency === "USD" ? amount : (usdRate ? amount * usdRate : amount);
      return { ...t, usdRate: currency === "USD" ? 1 : usdRate, usdAmount };
    });
  }

  // Normalize balance sheets to v2 format (amount+currency)
  const bs = out.balanceSheets || {};
  const fixed = {};
  for (const k of Object.keys(bs)) fixed[k] = normalizeBSMonth(bs[k]);
  out.balanceSheets = fixed;

  return out;
}

// Convert any old/partial BS to v2 structure
function normalizeBSMonth(bs) {
  const mk = (title) => ({ title, items: [] });

  const ensure = (obj, title) => {
    if (!obj || typeof obj !== "object") return mk(title);
    if (!Array.isArray(obj.items)) obj.items = [];
    if (!obj.title) obj.title = title;
    return obj;
  };

  const out = {
    assets: {
      cash: mk("Nakit"),
      investments: mk("Yatırımlar"),
      receivables: mk("Alacaklar")
    },
    liabilities: {
      credits: mk("Krediler"),
      cards: mk("Kredi Kartları"),
      debts: mk("Borçlar")
    },
    plan: bs?.plan || { assetsUSD: 0, liabUSD: 0, equityUSD: 0 }
  };

  // If already has v2-ish groups, adopt them
  if (bs?.assets || bs?.liabilities) {
    out.assets.cash = ensure(bs.assets?.cash, "Nakit");
    out.assets.investments = ensure(bs.assets?.investments, "Yatırımlar");
    out.assets.receivables = ensure(bs.assets?.receivables, "Alacaklar");

    out.liabilities.credits = ensure(bs.liabilities?.credits, "Krediler");
    out.liabilities.cards = ensure(bs.liabilities?.cards, "Kredi Kartları");
    out.liabilities.debts = ensure(bs.liabilities?.debts, "Borçlar");
  }

  // MIGRATE OLD item formats:
  // - old item: { valueUSD } or { valueUSD, note, name }
  // - new item: { amount, currency, ... }
  const migrateItems = (items) => {
    const arr = Array.isArray(items) ? items : [];
    return arr.map((it) => {
      if (!it || typeof it !== "object") return it;

      // Already v2:
      if (typeof it.amount === "number" && it.currency) {
        return {
          id: it.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
          name: String(it.name || ""),
          amount: Number(it.amount || 0),
          currency: it.currency || "USD",
          note: String(it.note || "")
        };
      }

      // Old v1:
      const v = (it.valueUSD != null) ? Number(it.valueUSD || 0) : Number(it.value || 0);
      return {
        id: it.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
        name: String(it.name || ""),
        amount: v,
        currency: "USD",
        note: String(it.note || "")
      };
    });
  };

  out.assets.cash.items = migrateItems(out.assets.cash.items);
  out.assets.investments.items = migrateItems(out.assets.investments.items);
  out.assets.receivables.items = migrateItems(out.assets.receivables.items);

  out.liabilities.credits.items = migrateItems(out.liabilities.credits.items);
  out.liabilities.cards.items = migrateItems(out.liabilities.cards.items);
  out.liabilities.debts.items = migrateItems(out.liabilities.debts.items);

  return out;
}

/* =========================
   Storage
========================= */
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData();
  try {
    return migrateIfNeeded(JSON.parse(raw));
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
window.saveData = saveData;

/* =========================
   Helpers
========================= */
function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function ymFromISO(dateISO) {
  if (!dateISO || typeof dateISO !== "string") return "";
  return dateISO.slice(0, 7);
}

function getSelectedYMKey() {
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  if (y && m) return `${y}-${String(m).padStart(2, "0")}`;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = text;
}

/* =========================
   FX (USD base)
   - fetchUsdPerUnit(currency, dateISO):
     returns USD per 1 unit of currency.
========================= */
async function fetchUsdPerUnit(currency, dateISO) {
  if (!currency || currency === "USD") return 1;

  const date = dateISO || "latest";
  const frankUrl = `https://api.frankfurter.app/${date}?from=USD&to=${encodeURIComponent(currency)}`;

  try {
    const r = await fetch(frankUrl, { cache: "no-store" });
    if (!r.ok) throw new Error("Frankfurter not ok");
    const j = await r.json();
    const perUSD = Number(j?.rates?.[currency]);
    if (!perUSD || !isFinite(perUSD)) throw new Error("Frankfurter bad rate");
    return 1 / perUSD;
  } catch (_) {
    try {
      const r2 = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
      if (!r2.ok) throw new Error("ER API not ok");
      const j2 = await r2.json();
      const perUSD2 = Number(j2?.rates?.[currency]);
      if (!perUSD2 || !isFinite(perUSD2)) throw new Error("ER API bad rate");
      return 1 / perUSD2;
    } catch (e2) {
      throw new Error(`Kur çekilemedi: ${currency}.`);
    }
  }
}

// Cache latest FX for balance sheet (current FX)
const FX_CACHE = { ts: 0, usdPerUnit: { USD: 1 } };
async function getUsdPerUnitLatest(currency) {
  const now = Date.now();
  if (currency === "USD") return 1;

  // refresh every 10 min
  if (now - FX_CACHE.ts > 10 * 60 * 1000) {
    FX_CACHE.ts = now;
    FX_CACHE.usdPerUnit = { USD: 1 };
  }

  if (FX_CACHE.usdPerUnit[currency] != null) return FX_CACHE.usdPerUnit[currency];
  const v = await fetchUsdPerUnit(currency, "latest");
  FX_CACHE.usdPerUnit[currency] = v;
  return v;
}

/* =========================
   Transactions (USD snapshot at entry)
========================= */
async function addTransaction({ type, date, amount, currency, note, categoryId }) {
  const data = loadData();
  const amt = Number(amount);
  if (!amt || !isFinite(amt) || amt <= 0) throw new Error("Tutar geçersiz");

  const usdRate = await fetchUsdPerUnit(currency, date); // USD per 1 currency
  const usdAmount = (currency === "USD") ? amt : (amt * usdRate);

  const tx = {
    id: data.nextTxId++,
    type: type === "income" ? "income" : "expense",
    date: date || todayISO(),
    ym: ymFromISO(date || todayISO()),
    amount: amt,
    currency: currency || "USD",
    usdRate: Number(usdRate),
    usdAmount: Number(usdAmount),
    note: note || "",
    categoryId: categoryId ?? null
  };

  data.transactions.push(tx);
  saveData(data);
}

function getTxForMonth(ymKey) {
  const data = loadData();
  return (data.transactions || []).filter(t => t?.ym === ymKey);
}

function calcMonthlySummary(ymKey) {
  const tx = getTxForMonth(ymKey);
  const actualIncome = tx.filter(t => t.type === "income").reduce((a, t) => a + (t.usdAmount || 0), 0);
  const actualExpense = tx.filter(t => t.type === "expense").reduce((a, t) => a + (t.usdAmount || 0), 0);

  return {
    actualIncome,
    actualExpense,
    netActual: actualIncome - actualExpense
  };
}

/* =========================
   Balance Sheets (store amount+currency; display current FX to USD)
========================= */
function ensureBalanceMonth(ymKey) {
  const data = loadData();
  data.balanceSheets = data.balanceSheets || {};

  if (!data.balanceSheets[ymKey]) {
    data.balanceSheets[ymKey] = {
      assets: {
        cash: { title: "Nakit", items: [] },
        investments: { title: "Yatırımlar", items: [] },
        receivables: { title: "Alacaklar", items: [] }
      },
      liabilities: {
        credits: { title: "Krediler", items: [] },
        cards: { title: "Kredi Kartları", items: [] },
        debts: { title: "Borçlar", items: [] }
      },
      plan: { assetsUSD: 0, liabUSD: 0, equityUSD: 0 }
    };
    saveData(data);
  }
  return data.balanceSheets[ymKey];
}

function addBalanceItem(ymKey, side, groupKey, name, amount, currency, note = "") {
  const data = loadData();
  const bs = ensureBalanceMonth(ymKey);

  const grp = bs?.[side]?.[groupKey];
  if (!grp) throw new Error("Invalid group");

  grp.items.push({
    id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    name: String(name || "").trim(),
    amount: Number(amount || 0),
    currency: currency || "USD",
    note: String(note || "")
  });

  data.balanceSheets[ymKey] = bs;
  saveData(data);
}

function updateBalanceItem(ymKey, side, groupKey, id, patch) {
  const data = loadData();
  const bs = ensureBalanceMonth(ymKey);
  const grp = bs?.[side]?.[groupKey];
  if (!grp) throw new Error("Invalid group");

  const it = (grp.items || []).find(x => x.id === id);
  if (!it) return;

  if ("name" in patch) it.name = String(patch.name || "");
  if ("amount" in patch) it.amount = Number(patch.amount || 0);
  if ("currency" in patch) it.currency = String(patch.currency || "USD");
  if ("note" in patch) it.note = String(patch.note || "");

  data.balanceSheets[ymKey] = bs;
  saveData(data);
}

function deleteBalanceItem(ymKey, side, groupKey, id) {
  const data = loadData();
  const bs = ensureBalanceMonth(ymKey);
  const grp = bs?.[side]?.[groupKey];
  if (!grp) throw new Error("Invalid group");

  grp.items = (grp.items || []).filter(x => x.id !== id);

  data.balanceSheets[ymKey] = bs;
  saveData(data);
}

function saveBalancePlan(ymKey, assetsUSD, liabUSD, equityUSD) {
  const data = loadData();
  const bs = ensureBalanceMonth(ymKey);
  bs.plan = {
    assetsUSD: Number(assetsUSD || 0),
    liabUSD: Number(liabUSD || 0),
    equityUSD: Number(equityUSD || 0)
  };
  data.balanceSheets[ymKey] = bs;
  saveData(data);
}

/* =========================
   UI Renders
========================= */
function ensureMonthInputs() {
  const y = $("selYear");
  const m = $("selMonth");
  if (!y || !m) return;

  if (!y.value) y.value = String(new Date().getFullYear());
  if (!m.value) m.value = String(new Date().getMonth() + 1).padStart(2, "0");
}

function renderTxList() {
  const txList = $("txList");
  if (!txList) return;

  const ymKey = getSelectedYMKey();
  const tx = getTxForMonth(ymKey);

  if (!tx.length) {
    txList.textContent = "(işlem yok)";
    return;
  }

  const last = tx.slice(-30).reverse();
  txList.innerHTML = last.map(t => {
    const sign = t.type === "expense" ? "-" : "+";
    return `<div>
      ${escapeHtml(t.date)} | ${sign}${Number(t.amount).toFixed(2)} ${escapeHtml(t.currency)}
      <span class="muted small">→ ${Number(t.usdAmount).toFixed(2)} USD (snapshot)</span>
      ${t.note ? ` | ${escapeHtml(t.note)}` : ""}
    </div>`;
  }).join("");
}

function renderMonthlySummary() {
  const box = $("monthlySummary");
  if (!box) return;

  const ymKey = getSelectedYMKey();
  const s = calcMonthlySummary(ymKey);

  box.textContent =
    `Ay: ${ymKey}\n` +
    `Gerçek Gelir: ${s.actualIncome.toFixed(2)} USD\n` +
    `Gerçek Gider: ${s.actualExpense.toFixed(2)} USD\n` +
    `Net (Gerçek): ${(s.netActual).toFixed(2)} USD`;
}

async function renderBalanceUI() {
  const ymKey = getSelectedYMKey();
  const bs = ensureBalanceMonth(ymKey);

  // Current FX rates for display
  const usdTRY = await getUsdPerUnitLatest("TRY");
  const usdRUB = await getUsdPerUnitLatest("RUB");

  const toUSD = (amount, currency) => {
    const a = Number(amount || 0);
    if (currency === "USD") return a;
    if (currency === "TRY") return a * usdTRY;
    if (currency === "RUB") return a * usdRUB;
    return a;
  };

  const sumUSD = (items) => (items || []).reduce((acc, it) => acc + toUSD(it.amount, it.currency), 0);

  const assetsUSD =
    sumUSD(bs.assets.cash.items) +
    sumUSD(bs.assets.investments.items) +
    sumUSD(bs.assets.receivables.items);

  const liabUSD =
    sumUSD(bs.liabilities.credits.items) +
    sumUSD(bs.liabilities.cards.items) +
    sumUSD(bs.liabilities.debts.items);

  const equityUSD = assetsUSD - liabUSD;

  // Summary
  const sumBox = $("balSummary");
  if (sumBox) {
    sumBox.textContent =
      `Ay: ${ymKey}\n` +
      `Toplam Varlık: ${assetsUSD.toFixed(2)} USD (current FX)\n` +
      `Toplam Borç:  ${liabUSD.toFixed(2)} USD (current FX)\n` +
      `Equity:       ${equityUSD.toFixed(2)} USD\n\n` +
      `Plan Equity:  ${Number(bs.plan?.equityUSD || 0).toFixed(2)} USD\n` +
      `Δ (Equity):   ${(equityUSD - Number(bs.plan?.equityUSD || 0)).toFixed(2)} USD`;
  }

  // Plan inputs
  const pa = $("planAssets");
  const pl = $("planLiab");
  const pe = $("planEquity");
  if (pa) pa.value = bs.plan?.assetsUSD ?? 0;
  if (pl) pl.value = bs.plan?.liabUSD ?? 0;
  if (pe) pe.value = bs.plan?.equityUSD ?? 0;

  const assetsBox = $("assetsBox");
  const liabBox = $("liabBox");
  if (!assetsBox || !liabBox) return;

  const mkCurrencySelect = (val, side, groupKey, id) => {
    const opts = ["USD","TRY","RUB"].map(c => {
      const sel = c === val ? "selected" : "";
      return `<option value="${c}" ${sel}>${c}</option>`;
    }).join("");
    return `<select data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${id}" data-field="currency">${opts}</select>`;
  };

  const mkTable = (side, groupKey, title, items) => {
    const totalUSD = sumUSD(items);
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div><b>${title}</b> <span class="muted small">(Toplam: ${totalUSD.toFixed(2)} USD)</span></div>
          <button class="btn" data-badd="1" data-side="${side}" data-group="${groupKey}">+ Ekle</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>İsim</th>
              <th class="right">Tutar</th>
              <th>PB</th>
              <th class="right">USD (current)</th>
              <th>Not</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${(items || []).map(it => {
              const usd = toUSD(it.amount, it.currency);
              return `
                <tr>
                  <td><input data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="name" value="${escapeHtml(it.name)}"></td>
                  <td class="right"><input type="number" step="0.01" data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="amount" value="${Number(it.amount || 0)}"></td>
                  <td>${mkCurrencySelect(it.currency || "USD", side, groupKey, it.id)}</td>
                  <td class="right"><span class="muted">${usd.toFixed(2)}</span></td>
                  <td><input data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="note" value="${escapeHtml(it.note || "")}"></td>
                  <td><button class="btn danger" data-bdel="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}">Sil</button></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
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

  // Add
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
      addBalanceItem(ymKey, side, group, name, amt, currency, "");
      render();
    };
  });

  // Delete
  document.querySelectorAll("button[data-bdel='1']").forEach(btn => {
    btn.onclick = () => {
      const side = btn.getAttribute("data-side");
      const group = btn.getAttribute("data-group");
      const id = btn.getAttribute("data-id");
      deleteBalanceItem(ymKey, side, group, id);
      render();
    };
  });

  // Inline edit
  document.querySelectorAll("[data-bedit='1']").forEach(el => {
    el.onchange = () => {
      const side = el.getAttribute("data-side");
      const group = el.getAttribute("data-group");
      const id = el.getAttribute("data-id");
      const field = el.getAttribute("data-field");
      const patch = {};
      if (field === "amount") patch.amount = Number(el.value || 0);
      else patch[field] = el.value;
      updateBalanceItem(ymKey, side, group, id, patch);
      render();
    };
  });
}

/* =========================
   Main Render
========================= */
async function render() {
  const data = loadData();
  ensureMonthInputs();

  setStatus([
    `Tx: ${data.transactions.length}`,
    `Balance months: ${Object.keys(data.balanceSheets || {}).length}`
  ].join("\n"));

  renderTxList();
  renderMonthlySummary();
  await renderBalanceUI();
}
window.render = render;

/* =========================
   Wire UI Events (if exist)
========================= */
function wireEvents() {
  // Export
  $("btnExport")?.addEventListener("click", () => {
    const data = loadData();
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `butce-yedek-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // Import
  $("fileImport")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      const data = migrateIfNeeded(parsed);
      saveData(data);
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

  // Month change
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
}

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  wireEvents();
  await render();
});
