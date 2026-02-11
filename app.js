/* =========================
   Budget Pro - app.js (v1)
   - No imports
   - Works with Firebase sync wrapper (firebase.js overrides saveData)
========================= */

const STORAGE_KEY = "butce_data_v1";

/* =========================
   Data Model
========================= */
function defaultData() {
  return {
    app: { version: 1, baseCurrency: "USD", currencies: ["USD", "TRY", "RUB"] },

    // Optional categories (if your UI has it)
    categories: { income: [], expense: [] },
    nextCategoryId: 1,

    // Budget forecast monthly rates (manual): monthlyRates[CUR]["YYYY-MM"]=rate (CUR per 1 USD) OR (USD per 1 CUR) – we store USD per 1 CUR
    monthlyRates: { TRY: {}, RUB: {} },

    // Transactions (actual): stores USD snapshot at entry time
    transactions: [],
    nextTxId: 1,

    // Balance sheets (actual & plan)
    balanceSheets: {
      // "YYYY-MM": { assets:{...}, liabilities:{...}, plan:{...} }
    }
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

  // Ensure transactions have usdAmount snapshot if old format
  if (Array.isArray(out.transactions)) {
    out.transactions = out.transactions.map((t) => {
      if (t && typeof t.usdAmount === "number") return t;
      // Try to compute a best-effort snapshot if missing
      const amount = Number(t?.amount || 0);
      const currency = t?.currency || "USD";
      const rate = Number(t?.usdRate || (currency === "USD" ? 1 : 0));
      const usdAmount = currency === "USD" ? amount : (rate ? amount * rate : amount);
      return { ...t, usdRate: currency === "USD" ? 1 : rate, usdAmount };
    });
  }

  // Normalize balance sheet months to expected structure
  const bs = out.balanceSheets || {};
  const fixed = {};
  for (const k of Object.keys(bs)) fixed[k] = normalizeBSMonth(bs[k]);
  out.balanceSheets = fixed;

  return out;
}

function normalizeBSMonth(bs) {
  // New format ok?
  if (bs?.assets?.cash?.items && bs?.liabilities?.credits?.items) return bs;

  const mk = (title) => ({ title, items: [] });

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

  // Carry single-value old formats if present
  const tryCarry = (src, dstGroup, title) => {
    if (!src) return;
    const v = (src.valueUSD != null) ? src.valueUSD : src.value;
    const note = src.note || "";
    if (v != null) {
      dstGroup.items.push({ id: "m1", name: title, valueUSD: Number(v || 0), note });
    }
  };

  tryCarry(bs?.assets?.cash, out.assets.cash, "Nakit");
  tryCarry(bs?.assets?.investments, out.assets.investments, "Yatırımlar");
  tryCarry(bs?.assets?.receivables, out.assets.receivables, "Alacaklar");

  tryCarry(bs?.liabilities?.credits, out.liabilities.credits, "Krediler");
  tryCarry(bs?.liabilities?.cards, out.liabilities.cards, "Kredi Kartları");
  tryCarry(bs?.liabilities?.debts, out.liabilities.debts, "Borçlar");

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

// IMPORTANT: firebase.js overrides window.saveData to also cloudSave.
// So keep this name stable.
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
  // "YYYY-MM-DD" -> "YYYY-MM"
  if (!dateISO || typeof dateISO !== "string") return "";
  return dateISO.slice(0, 7);
}

function getSelectedYMKey() {
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  if (y && m) return `${y}-${String(m).padStart(2, "0")}`;

  // fallback: current month
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = text;
}

/* =========================
   FX (USD base)
   - returns usdPerUnit(currency) (i.e., 1 TRY => x USD)
========================= */
async function fetchUsdPerUnit(currency, dateISO) {
  if (!currency || currency === "USD") return 1;

  // 1) Frankfurter: supports many currencies, base EUR by default; we can request USD base and quote currency:
  // Example: https://api.frankfurter.app/2026-02-11?from=USD&to=TRY
  // Response: { rates: { TRY: 30.0 } } meaning 1 USD = 30 TRY => 1 TRY = 1/30 USD
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
    // 2) Fallback: open.er-api.com latest only (no historical). Still better than failing.
    // https://open.er-api.com/v6/latest/USD => rates[TRY] = 30 means 1 USD = 30 TRY => 1 TRY = 1/30 USD
    try {
      const r2 = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
      if (!r2.ok) throw new Error("ER API not ok");
      const j2 = await r2.json();
      const perUSD2 = Number(j2?.rates?.[currency]);
      if (!perUSD2 || !isFinite(perUSD2)) throw new Error("ER API bad rate");
      return 1 / perUSD2;
    } catch (e2) {
      // last resort
      throw new Error(`Kur çekilemedi: ${currency}. İnternet/servis hatası.`);
    }
  }
}

/* =========================
   Transactions
========================= */
async function addTransaction({ type, date, amount, currency, note, categoryId }) {
  const data = loadData();
  const amt = Number(amount);
  if (!amt || !isFinite(amt) || amt <= 0) throw new Error("Tutar geçersiz");

  const usdRate = await fetchUsdPerUnit(currency, date); // 1 unit currency => USD
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

  // Plan side is not fully implemented here (depends on your budget plan UI).
  // We'll keep placeholders.
  const planIncome = 0;
  const planExpense = 0;

  return {
    planIncome,
    planExpense,
    actualIncome,
    actualExpense,
    netPlan: planIncome - planExpense,
    netActual: actualIncome - actualExpense
  };
}

/* =========================
   Balance Sheets (USD)
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

function sumItems(items) {
  return (items || []).reduce((a, x) => a + Number(x.valueUSD || 0), 0);
}

function balanceTotals(ymKey) {
  const data = loadData();
  const bs = data.balanceSheets?.[ymKey];
  if (!bs) return null;

  const assets =
    sumItems(bs.assets.cash.items) +
    sumItems(bs.assets.investments.items) +
    sumItems(bs.assets.receivables.items);

  const liab =
    sumItems(bs.liabilities.credits.items) +
    sumItems(bs.liabilities.cards.items) +
    sumItems(bs.liabilities.debts.items);

  return {
    assets,
    liab,
    equity: assets - liab,
    planA: Number(bs.plan.assetsUSD || 0),
    planL: Number(bs.plan.liabUSD || 0),
    planE: Number(bs.plan.equityUSD || 0)
  };
}

function addBalanceItem(ymKey, side, groupKey, name, valueUSD, note = "") {
  const data = loadData();
  const bs = ensureBalanceMonth(ymKey);

  const grp = bs?.[side]?.[groupKey];
  if (!grp) throw new Error("Invalid group");

  grp.items.push({
    id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
    name: String(name || "").trim(),
    valueUSD: Number(valueUSD || 0),
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
  if ("valueUSD" in patch) it.valueUSD = Number(patch.valueUSD || 0);
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
      <span class="muted small">→ ${Number(t.usdAmount).toFixed(2)} USD</span>
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

function renderBalanceUI() {
  const ymKey = getSelectedYMKey();
  const bs = ensureBalanceMonth(ymKey);
  const totals = balanceTotals(ymKey);

  const sumBox = $("balSummary");
  if (sumBox && totals) {
    sumBox.textContent =
      `Ay: ${ymKey}\n` +
      `Toplam Varlık: ${totals.assets.toFixed(2)} USD\n` +
      `Toplam Borç:  ${totals.liab.toFixed(2)} USD\n` +
      `Equity:       ${totals.equity.toFixed(2)} USD\n\n` +
      `Plan Equity:  ${totals.planE.toFixed(2)} USD\n` +
      `Δ (Equity):   ${(totals.equity - totals.planE).toFixed(2)} USD`;
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

  const mkTable = (side, groupKey, title, items) => {
    const total = sumItems(items);
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div><b>${title}</b> <span class="muted small">(Toplam: ${total.toFixed(2)} USD)</span></div>
          <button class="btn" data-badd="1" data-side="${side}" data-group="${groupKey}">+ Ekle</button>
        </div>
        <table>
          <thead><tr><th>İsim</th><th class="right">USD</th><th>Not</th><th></th></tr></thead>
          <tbody>
            ${(items || []).map(it => `
              <tr>
                <td><input data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="name" value="${escapeHtml(it.name)}"></td>
                <td class="right"><input type="number" step="0.01" data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="valueUSD" value="${Number(it.valueUSD || 0)}"></td>
                <td><input data-bedit="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="note" value="${escapeHtml(it.note || "")}"></td>
                <td><button class="btn danger" data-bdel="1" data-side="${side}" data-group="${groupKey}" data-id="${it.id}">Sil</button></td>
              </tr>
            `).join("")}
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
      const v = Number(prompt("Tutar (USD):", "0") || 0);
      addBalanceItem(ymKey, side, group, name, v, "");
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
  document.querySelectorAll("input[data-bedit='1']").forEach(inp => {
    inp.onchange = () => {
      const side = inp.getAttribute("data-side");
      const group = inp.getAttribute("data-group");
      const id = inp.getAttribute("data-id");
      const field = inp.getAttribute("data-field");
      const patch = {};
      if (field === "valueUSD") patch.valueUSD = Number(inp.value || 0);
      else patch[field] = inp.value;
      updateBalanceItem(ymKey, side, group, id, patch);
      render();
    };
  });
}

function ensureMonthInputs() {
  // Optional: if your UI has year/month selects, keep defaults
  const y = $("selYear");
  const m = $("selMonth");
  if (!y || !m) return;

  if (!y.value) y.value = String(new Date().getFullYear());
  if (!m.value) m.value = String(new Date().getMonth() + 1).padStart(2, "0");
}

/* =========================
   Main Render
========================= */
function render() {
  const data = loadData();

  ensureMonthInputs();

  setStatus([
    `Tx: ${data.transactions.length}`,
    `Balance months: ${Object.keys(data.balanceSheets || {}).length}`,
  ].join("\n"));

  renderTxList();
  renderMonthlySummary();
  renderBalanceUI();
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
      render();
      alert("JSON içe aktarıldı ✅");
    } catch {
      alert("JSON okunamadı ❌");
    } finally {
      e.target.value = "";
    }
  });

  // Reset
  $("btnReset")?.addEventListener("click", () => {
    if (!confirm("Tüm veriyi sıfırlamak istiyor musun?")) return;
    localStorage.removeItem(STORAGE_KEY);
    render();
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

      render();
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  // Save Balance plan
  $("btnSavePlan")?.addEventListener("click", () => {
    const ymKey = getSelectedYMKey();
    saveBalancePlan(
      ymKey,
      Number($("planAssets")?.value || 0),
      Number($("planLiab")?.value || 0),
      Number($("planEquity")?.value || 0)
    );
    render();
    alert("Bilanço planı kaydedildi ✅");
  });
}

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  render();
});
