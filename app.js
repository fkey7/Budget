const STORAGE_KEY = "butce_data_v1";

/* =========================
   DATA MODEL
========================= */
function defaultData() {
  return {
    app: { version: 1, baseCurrency: "USD" },
    categories: { income: [], expense: [] },     // plan kategorileri
    nextCategoryId: 1,

    // Budget kur tahminleri (1 USD = ?), aylık
    monthlyRates: {
      TRY: {}, // "01".."12"
      RUB: {}
    },

    // Transactions: amountUSD + rateAtTime ile sabitlenir
    transactions: [],

    // Balance sheets: ay bazlı snapshot
    balanceSheets: {
      // "YYYY-MM": { assets:{...}, liabilities:{...}, plan:{...} }
    }
  };
}
function normalizeBSMonth(bs) {
  if (bs?.assets?.cash?.items && bs?.liabilities?.credits?.items) return bs;

  const mk = (title, oldObj) => {
    const items = [];
    if (oldObj && (oldObj.value != null || oldObj.note != null)) {
      const v = Number(oldObj.value || 0);
      const n = oldObj.note || "";
      items.push({ id: "m1", name: title, valueUSD: v, note: n });
    }
    return { title, items };
  };

  const oldA = bs?.assets || {};
  const oldL = bs?.liabilities || {};

  return {
    assets: {
      cash: mk("Nakit", oldA.cash),
      investments: mk("Yatırımlar", oldA.investments),
      receivables: mk("Alacaklar", oldA.receivables),
    },
    liabilities: {
      credits: mk("Krediler", oldL.credits),
      cards: mk("Kredi Kartları", oldL.cards),
      debts: mk("Borçlar", oldL.debts),
    },
    plan: bs?.plan || { assetsUSD: 0, liabUSD: 0, equityUSD: 0 }
  };
}
function migrateIfNeeded(d) {
  const base = defaultData();

  const bs = d.balanceSheets ?? base.balanceSheets;
  const fixed = {};
  for (const k of Object.keys(bs || {})) {
    fixed[k] = normalizeBSMonth(bs[k]);
  }

  return {
    ...base,
    ...d,
    app: { ...base.app, ...(d.app || {}) },
    categories: d.categories ?? base.categories,
    nextCategoryId: d.nextCategoryId ?? base.nextCategoryId,
    monthlyRates: d.monthlyRates ?? base.monthlyRates,
    transactions: d.transactions ?? base.transactions,
    balanceSheets: fixed
  };
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

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Firebase sync için global expose
window.saveData = saveData;

/* =========================
   UTIL / DOM
========================= */
function $(id) { return document.getElementById(id); }
function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function isYM(s) { return /^\d{4}\-(0[1-9]|1[0-2])$/.test(String(s).trim()); }
function normName(s) { return (s || "").toString().trim().toLowerCase(); }

function getSelectedYMKey() {
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  if (y && m) return `${y}-${m}`;
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function setSelectedYMKey(ymKey) {
  if (!isYM(ymKey)) return false;
  const [y, m] = ymKey.split("-");
  ensureYearMonthSelectors();
  $("selYear").value = y;
  $("selMonth").value = m;
  return true;
}

function prevMonth(ymKey) {
  const [y, m] = ymKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setStatus(text) { if ($("status")) $("status").textContent = text; }

/* =========================
   TABS
========================= */
function setTab(name) {
  const budget = $("tabBudget");
  const tx = $("tabTx");
  const bal = $("tabBal");

  const b1 = $("tabBtnBudget");
  const b2 = $("tabBtnTx");
  const b3 = $("tabBtnBal");

  const show = (el, yes) => el && el.classList.toggle("hidden", !yes);
  show(budget, name === "budget");
  show(tx, name === "tx");
  show(bal, name === "bal");

  [b1, b2, b3].forEach(x => x && x.classList.remove("active"));
  if (name === "budget") b1?.classList.add("active");
  if (name === "tx") b2?.classList.add("active");
  if (name === "bal") b3?.classList.add("active");
}

/* =========================
   YEAR/MONTH SELECTORS
========================= */
function ensureYearMonthSelectors() {
  const data = loadData();
  const yearSel = $("selYear");
  const monthSel = $("selMonth");
  if (!yearSel || !monthSel) return;

  const years = new Set();
  data.transactions.forEach(t => years.add(String(t.date).slice(0, 4)));
  Object.keys(data.balanceSheets || {}).forEach(k => years.add(k.slice(0, 4)));
  if (!years.size) years.add(String(new Date().getFullYear()));

  const sorted = [...years].sort();
  yearSel.innerHTML = sorted.map(y => `<option value="${y}">${y}</option>`).join("");

  // Default
  if (!yearSel.value) yearSel.value = sorted[0];
  if (!monthSel.value) monthSel.value = pad2(new Date().getMonth() + 1);
}

/* =========================
   MONTHLY RATES UI (Budget)
========================= */
function ensureMonthRateInputs() {
  const tryBox = $("tryMonths");
  const rubBox = $("rubMonths");
  if (!tryBox || !rubBox) return;

  if (tryBox.children.length === 12) return;

  tryBox.innerHTML = "";
  rubBox.innerHTML = "";
  for (let i = 1; i <= 12; i++) {
    const m = pad2(i);
    const a = document.createElement("input");
    a.type = "number"; a.step = "0.000001"; a.id = `try_${m}`; a.placeholder = m;

    const b = document.createElement("input");
    b.type = "number"; b.step = "0.000001"; b.id = `rub_${m}`; b.placeholder = m;

    tryBox.appendChild(a);
    rubBox.appendChild(b);
  }
}

function loadMonthlyRatesToUI() {
  const data = loadData();
  for (let i = 1; i <= 12; i++) {
    const m = pad2(i);
    const vTRY = data.monthlyRates?.TRY?.[m] ?? "";
    const vRUB = data.monthlyRates?.RUB?.[m] ?? "";
    const a = $(`try_${m}`); if (a) a.value = vTRY;
    const b = $(`rub_${m}`); if (b) b.value = vRUB;
  }
  if ($("ratesInfo")) $("ratesInfo").textContent = "Kaydedilen tahminler bütçe planına uygulanır.";
}

function saveMonthlyRatesFromUI() {
  const data = loadData();
  data.monthlyRates = data.monthlyRates || { TRY: {}, RUB: {} };
  data.monthlyRates.TRY = data.monthlyRates.TRY || {};
  data.monthlyRates.RUB = data.monthlyRates.RUB || {};

  for (let i = 1; i <= 12; i++) {
    const m = pad2(i);
    const vTRY = Number($(`try_${m}`)?.value || 0);
    const vRUB = Number($(`rub_${m}`)?.value || 0);
    data.monthlyRates.TRY[m] = vTRY;
    data.monthlyRates.RUB[m] = vRUB;
  }
  saveData(data);
  render();
  alert("Kur tahminleri kaydedildi ✅");
}

function getBudgetRateForMonth(currency, month) {
  // 1 USD = ? CUR (TRY/RUB)
  const data = loadData();
  if (currency === "USD") return 1;
  const v = data.monthlyRates?.[currency]?.[month];
  return v && v > 0 ? Number(v) : 1;
}

function toUSD_budget(amount, currency, ymKey) {
  const month = ymKey.slice(5, 7);
  if (currency === "USD") return Number(amount);
  const rate = getBudgetRateForMonth(currency, month); // 1 USD = rate CUR
  return Number(amount) / rate;
}

/* =========================
   CATEGORIES (PLAN)
========================= */
function ensurePlanMonthInputs() {
  const box = $("catMonths");
  if (!box || box.children.length === 12) return;
  box.innerHTML = "";
  for (let i = 1; i <= 12; i++) {
    const m = pad2(i);
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.01";
    inp.id = `plan_${m}`;
    inp.placeholder = m;
    box.appendChild(inp);
  }
}

function readPlanMonthsFromUI() {
  const obj = {};
  for (let i = 1; i <= 12; i++) {
    const m = pad2(i);
    obj[m] = Number($(`plan_${m}`)?.value || 0);
  }
  return obj;
}

function writePlanMonthsToUI(obj) {
  for (let i = 1; i <= 12; i++) {
    const m = pad2(i);
    const el = $(`plan_${m}`);
    if (el) el.value = obj?.[m] ?? 0;
  }
}

function addCategory({ type, name, currency, yearly, monthly }) {
  const data = loadData();
  const id = data.nextCategoryId++;
  const cat = {
    id,
    type, // income/expense
    name,
    currency, // USD/TRY/RUB
    yearlyBudget: Number(yearly) || 0,
    monthlyBudgets: monthly || {}
  };
  data.categories[type].push(cat);
  saveData(data);
}

function renderCategoryList() {
  const data = loadData();
  const list = $("catList");
  if (!list) return;

  const lines = [];
  for (const c of data.categories.income) lines.push(`(Gelir) #${c.id} ${c.name} | ${c.currency} | Yıllık:${c.yearlyBudget}`);
  for (const c of data.categories.expense) lines.push(`(Gider) #${c.id} ${c.name} | ${c.currency} | Yıllık:${c.yearlyBudget}`);

  list.textContent = lines.length ? lines.join("\n") : "(kategori yok)";
}

function fillTxCategorySelect(type) {
  const data = loadData();
  const sel = $("txCategory");
  if (!sel) return;
  const arr = data.categories[type] || [];
  sel.innerHTML = arr.length
    ? arr.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")
    : `<option value="0">(kategori yok)</option>`;
}

function getCategoryById(type, id) {
  const data = loadData();
  return (data.categories[type] || []).find(x => Number(x.id) === Number(id)) || null;
}

/* =========================
   FX FOR TRANSACTIONS (Daily)
   Frankfurter (ECB-based)
========================= */
async function fetchDailyUsdRates(dateISO) {
  // returns: {TRY, RUB} where 1 USD = X CUR
  const url = `https://api.frankfurter.app/${dateISO}?from=USD&to=TRY,RUB`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("FX fetch failed");
  const json = await res.json();
  if (!json.rates) throw new Error("FX missing rates");
  return {
    TRY: Number(json.rates.TRY),
    RUB: Number(json.rates.RUB)
  };
}

/* =========================
   BALANCE SHEET (Detailed items)
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

  const a =
    sumItems(bs.assets.cash.items) +
    sumItems(bs.assets.investments.items) +
    sumItems(bs.assets.receivables.items);

  const l =
    sumItems(bs.liabilities.credits.items) +
    sumItems(bs.liabilities.cards.items) +
    sumItems(bs.liabilities.debts.items);

  return {
    assets: a,
    liab: l,
    equity: a - l,
    planA: Number(bs.plan.assetsUSD || 0),
    planL: Number(bs.plan.liabUSD || 0),
    planE: Number(bs.plan.equityUSD || 0)
  };
}

/* =========================
   AUTOMATION:
   Expense tx category name matches:
   - liability item => decrease
   - asset item => increase
========================= */
function findItemByNameInGroups(groupsObj, nameNorm) {
  for (const gKey of Object.keys(groupsObj || {})) {
    const grp = groupsObj[gKey];
    const it = (grp.items || []).find(x => normName(x.name) === nameNorm);
    if (it) return it;
  }
  return null;
}

function applyAutoMatchForTx(tx) {
  // Only expense payments should reduce liabilities and increase assets
  if (!tx || tx.type !== "expense") return;

  const ymKey = tx.date.slice(0, 7);
  const data = loadData();
  const bs = data.balanceSheets?.[ymKey];
  if (!bs) return;

  const nameNorm = normName(tx.categoryName || "");
  if (!nameNorm) return;

  const pay = Number(tx.amountUSD || 0);
  if (!pay || pay <= 0) return;

  const liabItem = findItemByNameInGroups(bs.liabilities, nameNorm);
  if (liabItem) liabItem.valueUSD = Math.max(0, Number(liabItem.valueUSD || 0) - pay);

  const assetItem = findItemByNameInGroups(bs.assets, nameNorm);
  if (assetItem) assetItem.valueUSD = Number(assetItem.valueUSD || 0) + pay;

  data.balanceSheets[ymKey] = bs;
  saveData(data);
}

/* =========================
   TRANSACTIONS
========================= */
async function addTransaction({ type, date, amount, currency, note, categoryId }) {
  const data = loadData();

  const cat = getCategoryById(type, categoryId);
  const categoryName = cat ? cat.name : "";

  const amt = Number(amount);
  const cur = currency;

  let rateAtTime = 1;   // 1 USD = ? cur (for TRY/RUB)
  let amountUSD = amt;

  if (cur !== "USD") {
    const daily = await fetchDailyUsdRates(date);
    rateAtTime = Number(daily[cur]);
    amountUSD = amt / rateAtTime;
  }

  const tx = {
    id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    type,
    date,
    amount: amt,
    currency: cur,
    note: note || "",
    categoryId: Number(categoryId) || 0,
    categoryName,
    rateAtTime: Number(rateAtTime.toFixed(6)),
    amountUSD: Number(amountUSD.toFixed(6))
  };

  data.transactions.push(tx);
  saveData(data);

  // Apply automation after saving tx
  applyAutoMatchForTx(tx);
}

/* =========================
   BUDGET SUMMARY (USD)
========================= */
function calcMonthlyBudgetSummary(ymKey) {
  const data = loadData();
  const [y, m] = ymKey.split("-");

  let planIncome = 0, planExpense = 0;
  let actualIncome = 0, actualExpense = 0;

  for (const c of data.categories.income) {
    const v = Number(c.monthlyBudgets?.[m] || 0);
    planIncome += toUSD_budget(v, c.currency, ymKey);
  }
  for (const c of data.categories.expense) {
    const v = Number(c.monthlyBudgets?.[m] || 0);
    planExpense += toUSD_budget(v, c.currency, ymKey);
  }

  for (const t of data.transactions) {
    if (t.date.startsWith(ymKey)) {
      if (t.type === "income") actualIncome += Number(t.amountUSD || 0);
      if (t.type === "expense") actualExpense += Number(t.amountUSD || 0);
    }
  }

  return {
    planIncome, planExpense, actualIncome, actualExpense,
    netPlan: planIncome - planExpense,
    netActual: actualIncome - actualExpense
  };
}

/* =========================
   BALANCE UI RENDER (Group + items)
========================= */
function makeGroupEditor({ ymKey, side, groupKey, title, items }) {
  const wrap = document.createElement("div");
  wrap.className = "card";

  const sum = sumItems(items);
  wrap.innerHTML = `
    <div class="row" style="justify-content:space-between;">
      <div><b>${escapeHtml(title)}</b> <span class="muted small">(Toplam: ${sum.toFixed(2)} USD)</span></div>
      <button class="btn" data-action="addItem" data-side="${side}" data-group="${groupKey}">+ Ekle</button>
    </div>
    <div class="muted small">İsim eşleşirse otomasyon çalışır (örn: Akbank).</div>
    <table>
      <thead>
        <tr>
          <th>İsim</th>
          <th class="right">Tutar (USD)</th>
          <th>Not</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${(items || []).map(it => `
          <tr>
            <td><input data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="name" value="${escapeHtml(it.name)}" /></td>
            <td class="right"><input type="number" step="0.01" data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="valueUSD" value="${Number(it.valueUSD||0)}" /></td>
            <td><input data-side="${side}" data-group="${groupKey}" data-id="${it.id}" data-field="note" value="${escapeHtml(it.note||"")}" /></td>
            <td><button class="btn danger" data-action="delItem" data-side="${side}" data-group="${groupKey}" data-id="${it.id}">Sil</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  return wrap;
}

function renderBalanceEditors() {
  const ymKey = getSelectedYMKey();
  const bs = ensureBalanceMonth(ymKey);

  const assetsBox = $("assetsBox");
  const liabBox = $("liabBox");
  if (!assetsBox || !liabBox) return;

  assetsBox.innerHTML = "";
  liabBox.innerHTML = "";

  assetsBox.appendChild(makeGroupEditor({ ymKey, side:"assets", groupKey:"cash", title:"Nakit", items: bs.assets.cash.items }));
  assetsBox.appendChild(makeGroupEditor({ ymKey, side:"assets", groupKey:"investments", title:"Yatırımlar", items: bs.assets.investments.items }));
  assetsBox.appendChild(makeGroupEditor({ ymKey, side:"assets", groupKey:"receivables", title:"Alacaklar", items: bs.assets.receivables.items }));

  liabBox.appendChild(makeGroupEditor({ ymKey, side:"liabilities", groupKey:"credits", title:"Krediler", items: bs.liabilities.credits.items }));
  liabBox.appendChild(makeGroupEditor({ ymKey, side:"liabilities", groupKey:"cards", title:"Kredi Kartları", items: bs.liabilities.cards.items }));
  liabBox.appendChild(makeGroupEditor({ ymKey, side:"liabilities", groupKey:"debts", title:"Borçlar", items: bs.liabilities.debts.items }));

  // input change handlers
  document.querySelectorAll("input[data-side][data-group][data-id][data-field]").forEach(inp => {
    inp.addEventListener("change", () => {
      const data = loadData();
      const ymKey2 = getSelectedYMKey();
      const bs2 = ensureBalanceMonth(ymKey2);

      const side = inp.getAttribute("data-side");
      const group = inp.getAttribute("data-group");
      const id = inp.getAttribute("data-id");
      const field = inp.getAttribute("data-field");
      const val = inp.value;

      const grp = bs2[side][group];
      const item = (grp.items || []).find(x => x.id === id);
      if (!item) return;

      if (field === "valueUSD") item.valueUSD = Number(val || 0);
      else item[field] = val;

      data.balanceSheets[ymKey2] = bs2;
      saveData(data);
      render();
    });
  });

  // buttons add/del
  document.querySelectorAll("button[data-action='addItem']").forEach(btn => {
    btn.addEventListener("click", () => {
      const data = loadData();
      const ymKey2 = getSelectedYMKey();
      const bs2 = ensureBalanceMonth(ymKey2);

      const side = btn.getAttribute("data-side");
      const group = btn.getAttribute("data-group");

      const name = prompt("İsim (örn: Akbank, Kripto, Ahmet):");
      if (!name) return;
      const amtStr = prompt("Tutar (USD):", "0");
      const amt = Number(amtStr || 0);

      bs2[side][group].items.push({
        id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
        name: name.trim(),
        valueUSD: amt,
        note: ""
      });

      data.balanceSheets[ymKey2] = bs2;
      saveData(data);
      render();
    });
  });

  document.querySelectorAll("button[data-action='delItem']").forEach(btn => {
    btn.addEventListener("click", () => {
      const data = loadData();
      const ymKey2 = getSelectedYMKey();
      const bs2 = ensureBalanceMonth(ymKey2);

      const side = btn.getAttribute("data-side");
      const group = btn.getAttribute("data-group");
      const id = btn.getAttribute("data-id");

      bs2[side][group].items = (bs2[side][group].items || []).filter(x => x.id !== id);

      data.balanceSheets[ymKey2] = bs2;
      saveData(data);
      render();
    });
  });
}

function renderBalanceSummary() {
  const ymKey = getSelectedYMKey();
  const t = balanceTotals(ymKey);
  const bs = ensureBalanceMonth(ymKey);

  // Plan inputs
  if ($("planAssets")) $("planAssets").value = Number(bs.plan.assetsUSD || 0);
  if ($("planLiab")) $("planLiab").value = Number(bs.plan.liabUSD || 0);
  if ($("planEquity")) $("planEquity").value = Number(bs.plan.equityUSD || 0);

  const prevKey = prevMonth(ymKey);
  const p = balanceTotals(prevKey);

  const momA = p ? (t.assets - p.assets) : 0;
  const momL = p ? (t.liab - p.liab) : 0;
  const momE = p ? (t.equity - p.equity) : 0;

  if ($("balSummary")) {
    $("balSummary").textContent =
      `Ay: ${ymKey}\n` +
      `Toplam Varlık: ${t.assets.toFixed(2)} USD\n` +
      `Toplam Borç:  ${t.liab.toFixed(2)} USD\n` +
      `Equity:       ${t.equity.toFixed(2)} USD\n\n` +
      `MoM (Önceki aya göre): Varlık ${momA.toFixed(2)} | Borç ${momL.toFixed(2)} | Equity ${momE.toFixed(2)}\n\n` +
      `Plan (Δ):\n` +
      `- Varlık Δ: ${(t.assets - t.planA).toFixed(2)}\n` +
      `- Borç Δ:  ${(t.liab - t.planL).toFixed(2)}\n` +
      `- Equity Δ:${(t.equity - t.planE).toFixed(2)}\n`;
  }
}

/* =========================
   TREND GRAPH
========================= */
function monthsBetween(fromYM, toYM) {
  const out = [];
  const [fy, fm] = fromYM.split("-").map(Number);
  const [ty, tm] = toYM.split("-").map(Number);
  const d = new Date(fy, fm - 1, 1);
  const end = new Date(ty, tm - 1, 1);
  while (d <= end) {
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function drawTrend(canvas, labels, actualEq, planEq) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const pad = 40;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;

  const vals = [...actualEq, ...planEq].filter(v => Number.isFinite(v));
  const minV = Math.min(...vals, 0);
  const maxV = Math.max(...vals, 1);

  const xFor = (i) => pad + (labels.length <= 1 ? 0 : (i * plotW) / (labels.length - 1));
  const yFor = (v) => {
    const t = (v - minV) / (maxV - minV || 1);
    return pad + (1 - t) * plotH;
  };

  // axes
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, pad + plotH);
  ctx.lineTo(pad + plotW, pad + plotH);
  ctx.stroke();

  // lines (actual black, plan gray)
  function line(arr, stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    arr.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  line(actualEq, "#111");
  line(planEq, "#888");

  // legend
  ctx.fillStyle = "#111"; ctx.fillText("Actual Equity", pad, h - 10);
  ctx.fillStyle = "#888"; ctx.fillText("Plan Equity", pad + 120, h - 10);
}

function buildTrend(fromYM, toYM) {
  if (!isYM(fromYM) || !isYM(toYM)) return "YYYY-MM formatı gir.";
  const data = loadData();
  const months = monthsBetween(fromYM, toYM);
  const labels = [];
  const a = [];
  const p = [];

  const lines = [];
  lines.push("Ay | Equity(Actual) | Equity(Plan) | Δ");
  lines.push("--------------------------------------");

  months.forEach(k => {
    const bs = data.balanceSheets?.[k];
    if (!bs) return;
    const t = balanceTotals(k);
    labels.push(k);
    a.push(t.equity);
    p.push(t.planE);
    lines.push(`${k} | ${t.equity.toFixed(0)} | ${t.planE.toFixed(0)} | ${(t.equity - t.planE).toFixed(0)}`);
  });

  drawTrend($("trendCanvas"), labels, a, p);
  return lines.join("\n");
}

/* =========================
   EXPORT / IMPORT
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
   RENDER
========================= */
function renderBudgetSummary() {
  const ymKey = getSelectedYMKey();
  const s = calcMonthlyBudgetSummary(ymKey);
  if ($("budgetSummary")) {
    $("budgetSummary").textContent =
      `Plan Gelir: ${s.planIncome.toFixed(2)} USD\n` +
      `Gerçek Gelir: ${s.actualIncome.toFixed(2)} USD\n` +
      `Plan Gider: ${s.planExpense.toFixed(2)} USD\n` +
      `Gerçek Gider: ${s.actualExpense.toFixed(2)} USD\n\n` +
      `Net (Plan): ${s.netPlan.toFixed(2)} USD\n` +
      `Net (Gerçek): ${s.netActual.toFixed(2)} USD`;
  }
}

function renderTxList() {
  const data = loadData();
  const box = $("txList");
  if (!box) return;
  if (!data.transactions.length) { box.textContent = "(işlem yok)"; return; }

  const last = data.transactions.slice(-20).reverse();
  box.innerHTML = last.map(t => {
    const sign = t.type === "expense" ? "-" : "+";
    return `${t.date} | ${sign}${t.amount} ${t.currency} | ${escapeHtml(t.categoryName||"-")} | USD:${Number(t.amountUSD||0).toFixed(2)} | Kur:${t.rateAtTime}\n${escapeHtml(t.note||"")}\n---`;
  }).join("\n");
}

function renderStatus() {
  const data = loadData();
  setStatus([
    `Kategoriler (Gelir): ${data.categories.income.length}`,
    `Kategoriler (Gider): ${data.categories.expense.length}`,
    `İşlem sayısı: ${data.transactions.length}`,
    `Bilanço ay sayısı: ${Object.keys(data.balanceSheets || {}).length}`,
  ].join("\n"));
}

function render() {
  ensureYearMonthSelectors();

  ensureMonthRateInputs();
  ensurePlanMonthInputs();

  loadMonthlyRatesToUI();
  renderCategoryList();
  fillTxCategorySelect($("txType")?.value || "expense");

  // Default date
  const d = $("txDate");
  if (d && !d.value) d.value = todayISO();

  // Ensure balance month exists
  ensureBalanceMonth(getSelectedYMKey());

  renderBudgetSummary();
  renderTxList();
  renderBalanceEditors();
  renderBalanceSummary();
  renderStatus();
}

// Firebase sync calls this
window.render = render;

/* =========================
   EVENTS
========================= */
$("tabBtnBudget")?.addEventListener("click", () => setTab("budget"));
$("tabBtnTx")?.addEventListener("click", () => setTab("tx"));
$("tabBtnBal")?.addEventListener("click", () => setTab("bal"));

$("selYear")?.addEventListener("change", () => render());
$("selMonth")?.addEventListener("change", () => render());

$("btnOpenYM")?.addEventListener("click", () => {
  const v = String($("quickYM")?.value || "").trim();
  if (!isYM(v)) { alert("YYYY-MM formatı gir (örn 2026-03)"); return; }
  const data = loadData();
  ensureBalanceMonth(v);
  saveData(data);
  setSelectedYMKey(v);
  render();
});

$("btnSaveMonthlyRates")?.addEventListener("click", saveMonthlyRatesFromUI);

$("btnEqualSplit")?.addEventListener("click", () => {
  const yearly = Number($("catYearly")?.value || 0);
  const each = yearly / 12;
  const obj = {};
  for (let i = 1; i <= 12; i++) obj[pad2(i)] = Number(each.toFixed(2));
  writePlanMonthsToUI(obj);
});

$("btnAddCategory")?.addEventListener("click", () => {
  const type = $("catType")?.value || "expense";
  const currency = $("catCurrency")?.value || "USD";
  const name = $("catName")?.value?.trim() || "";
  const yearly = $("catYearly")?.value || 0;
  const monthly = readPlanMonthsFromUI();

  if (!name) { alert("Kategori adı gir"); return; }

  addCategory({ type, name, currency, yearly, monthly });

  $("catName").value = "";
  $("catYearly").value = "";
  writePlanMonthsToUI({});
  render();
});

$("txType")?.addEventListener("change", (e) => {
  fillTxCategorySelect(e.target.value);
  render();
});

$("btnAddTx")?.addEventListener("click", async () => {
  const btn = $("btnAddTx");
  if (btn) btn.disabled = true;
  if ($("txInfo")) $("txInfo").textContent = "";

  try {
    const type = $("txType")?.value || "expense";
    const date = $("txDate")?.value || todayISO();
    const amount = $("txAmount")?.value;
    const currency = $("txCurrency")?.value || "USD";
    const note = $("txNote")?.value || "";
    const categoryId = $("txCategory")?.value || 0;

    if (!amount || Number(amount) <= 0) { alert("Tutar gir (0’dan büyük)"); return; }

    await addTransaction({ type, date, amount, currency, note, categoryId });

    $("txAmount").value = "";
    $("txNote").value = "";

    if ($("txInfo")) $("txInfo").textContent = "Kaydedildi ✅ (Kur işlem anına sabitlendi)";
    render();
  } catch (e) {
    alert("İşlem kaydedilemedi. Kur çekilememiş olabilir.");
  } finally {
    if (btn) btn.disabled = false;
  }
});

$("btnSavePlan")?.addEventListener("click", () => {
  const data = loadData();
  const ymKey = getSelectedYMKey();
  const bs = ensureBalanceMonth(ymKey);

  bs.plan = {
    assetsUSD: Number($("planAssets")?.value || 0),
    liabUSD: Number($("planLiab")?.value || 0),
    equityUSD: Number($("planEquity")?.value || 0)
  };

  data.balanceSheets[ymKey] = bs;
  saveData(data);
  render();
  alert("Plan kaydedildi ✅");
});

$("btnTrend")?.addEventListener("click", () => {
  const fromYM = String($("trendFrom")?.value || "").trim();
  const toYM = String($("trendTo")?.value || "").trim();
  const out = buildTrend(fromYM, toYM);
  if ($("trendText")) $("trendText").textContent = out;
});

// Export/Import/Reset
$("btnExport")?.addEventListener("click", () => {
  const data = loadData();
  const today = todayISO();
  downloadJson(`butce-yedek-${today}.json`, data);
});

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

$("btnReset")?.addEventListener("click", () => {
  if (!confirm("Tüm veriyi sıfırlamak istiyor musun?")) return;
  localStorage.removeItem(STORAGE_KEY);
  render();
});

// INIT
ensureYearMonthSelectors();
setTab("budget"); // default
render();
