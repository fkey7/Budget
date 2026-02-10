const STORAGE_KEY = "butce_data_v1";

/* =========================
   DATA (default + storage)
========================= */
function defaultData() {
  return {
    app: { version: 3, locale: "tr", baseCurrency: "USD" },

    // FX:
    // monthlyAvg: internetten çekilen aylık ortalama (1 USD = X CUR)
    // overrides: manuel override (1 USD = X CUR) - avg'nin üstüne geçer
    fx: { monthlyAvg: {}, overrides: {}, lastUpdatedAt: null },

    categories: { income: [], expense: [] },
    transactions: [],
    monthlyRates: {},

    // Fallback (eski sistem)
    exchangeRates: { USD: 1, TRY: 1, EUR: 1, RUB: 1 },

    nextCategoryId: 1,
  };
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData();
  try {
    const parsed = JSON.parse(raw);
    return migrateIfNeeded(parsed);
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function migrateIfNeeded(d) {
  const base = defaultData();
  return {
    ...base,
    ...d,
    app: { ...base.app, ...(d.app || {}) },
    fx: { ...base.fx, ...(d.fx || {}) },
    categories: d.categories ?? base.categories,
    transactions: d.transactions ?? base.transactions,
    monthlyRates: d.monthlyRates ?? base.monthlyRates,
    exchangeRates: d.exchangeRates ?? base.exchangeRates,
    nextCategoryId: d.nextCategoryId ?? base.nextCategoryId,
  };
}

/* =========================
   UTIL
========================= */
function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = text;
}

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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function ymFromDate(d) {
  const [y, m] = String(d).split("-");
  return { y, m };
}

function getSelectedYMKey() {
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  if (y && m) return `${y}-${m}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// 1 USD = X CUR (override > monthlyAvg > exchangeRates > 1)
function getEffectiveUsdRate(ymKey, currency) {
  if (currency === "USD") return 1;

  const data = loadData();
  const o = data.fx?.overrides?.[ymKey];
  const a = data.fx?.monthlyAvg?.[ymKey];

  const v =
    (o && o[currency] != null ? Number(o[currency]) : null) ??
    (a && a[currency] != null ? Number(a[currency]) : null) ??
    (data.exchangeRates?.[currency] != null ? Number(data.exchangeRates[currency]) : null);

  return v && v > 0 ? v : 1;
}

// PLAN dönüşümü için (ay bazlı ortalama/override kullanır)
function toUSD_plan(amount, currency, ymKey) {
  if (currency === "USD") return Number(amount);
  const rate = getEffectiveUsdRate(ymKey, currency); // 1 USD = X CUR
  return Number(amount) / rate;
}

/* =========================
   FX: Monthly Avg (Internet) + Daily (Transaction snapshot)
========================= */
function daysInMonth(year, month) {
  const y = Number(year),
    m = Number(month);
  return new Date(y, m, 0).getDate();
}

async function fetchMonthlyAvgRatesUSD(ymKey) {
  const [y, m] = ymKey.split("-");
  const start = `${y}-${m}-01`;
  const end = `${y}-${m}-${String(daysInMonth(y, m)).padStart(2, "0")}`;

  const url = `https://api.frankfurter.app/${start}..${end}?from=USD&to=TRY,EUR,RUB`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("FX monthly fetch failed");
  const json = await res.json();

  const sums = { TRY: 0, EUR: 0, RUB: 0 };
  let count = 0;

  for (const d in json.rates || {}) {
    const r = json.rates[d];
    if (!r) continue;
    if (r.TRY && r.EUR && r.RUB) {
      sums.TRY += Number(r.TRY);
      sums.EUR += Number(r.EUR);
      sums.RUB += Number(r.RUB);
      count++;
    }
  }
  if (!count) throw new Error("FX monthly no data");

  return {
    TRY: Number((sums.TRY / count).toFixed(6)),
    EUR: Number((sums.EUR / count).toFixed(6)),
    RUB: Number((sums.RUB / count).toFixed(6)),
    _days: count,
  };
}

async function fetchDailyUsdRates(dateISO) {
  const url = `https://api.frankfurter.app/${dateISO}?from=USD&to=TRY,EUR,RUB`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("FX daily fetch failed");
  const json = await res.json();
  if (!json.rates) throw new Error("FX daily missing rates");

  // 1 USD = X CUR
  return {
    TRY: Number(json.rates.TRY),
    EUR: Number(json.rates.EUR),
    RUB: Number(json.rates.RUB),
  };
}

/* =========================
   CATEGORIES (plan)
========================= */
function monthKey(i) {
  return String(i).padStart(2, "0");
}

function ensureMonthInputs() {
  const box = $("catMonths");
  if (!box || box.children.length) return;

  for (let i = 1; i <= 12; i++) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.01";
    inp.placeholder = `M${i}`;
    inp.id = `m_${i}`;
    box.appendChild(inp);
  }
}

function readMonthInputs() {
  const obj = {};
  for (let i = 1; i <= 12; i++) {
    obj[monthKey(i)] = Number($(`m_${i}`)?.value || 0);
  }
  return obj;
}

function writeMonthInputs(obj) {
  for (let i = 1; i <= 12; i++) {
    const k = monthKey(i);
    const el = $(`m_${i}`);
    if (el) el.value = obj?.[k] ?? 0;
  }
}

function addCategory({ type, name, currency, yearly, monthly }) {
  const data = loadData();
  const id = data.nextCategoryId++;

  const cat = {
    id,
    type,
    name,
    currency,
    yearlyBudget: Number(yearly) || 0,
    monthlyBudgets: monthly || {},
    icon: null,
  };

  data.categories[type].push(cat);
  saveData(data);
}

function renderCategoryList() {
  const data = loadData();
  const list = $("catList");
  if (!list) return;

  const lines = [];
  for (const c of data.categories.income) {
    lines.push(`(Gelir) #${c.id} ${c.name} | ${c.currency} | Yıllık:${c.yearlyBudget}`);
  }
  for (const c of data.categories.expense) {
    lines.push(`(Gider) #${c.id} ${c.name} | ${c.currency} | Yıllık:${c.yearlyBudget}`);
  }
  list.textContent = lines.length ? lines.join("\n") : "(kategori yok)";
}

function fillTxCategorySelect(type) {
  const data = loadData();
  const sel = $("txCategory");
  if (!sel) return;

  const arr = data.categories[type] || [];
  sel.innerHTML = arr.length
    ? arr.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")
    : `<option value="0">(kategori yok)</option>`;
}

function getCategoryNameById(type, id) {
  const data = loadData();
  const arr = data.categories[type] || [];
  const found = arr.find((x) => Number(x.id) === Number(id));
  return found ? found.name : "";
}

/* =========================
   TRANSACTIONS (daily FX snapshot)
========================= */
async function addTransaction({ type, date, amount, currency, note, categoryId }) {
  const data = loadData();

  const amt = Number(amount);
  const cur = currency;

  let usdAmount = amt;
  let usdRateUsed = 1; // 1 USD = X CUR
  let fxSource = "none";

  if (cur !== "USD") {
    try {
      const daily = await fetchDailyUsdRates(date);
      usdRateUsed = Number(daily[cur]);
      usdAmount = amt / usdRateUsed;
      fxSource = "daily_frankfurter";
    } catch (e) {
      // fallback: monthly avg -> exchangeRates
      const ymKey = `${date.slice(0, 4)}-${date.slice(5, 7)}`;
      const avg = data.fx?.monthlyAvg?.[ymKey];
      const fallbackRate =
        (avg && avg[cur] != null ? Number(avg[cur]) : null) ??
        (data.exchangeRates?.[cur] != null ? Number(data.exchangeRates[cur]) : null);

      if (!fallbackRate) throw e;
      usdRateUsed = Number(fallbackRate);
      usdAmount = amt / usdRateUsed;
      fxSource = avg && avg[cur] != null ? "monthly_avg_fallback" : "exchangeRates_fallback";
    }
  }

  const tx = {
    id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type,
    date,
    amount: amt,
    currency: cur,
    note: note || "",
    categoryId: Number(categoryId) || 0,

    // 🔒 snapshot
    usdAmount: Number(usdAmount.toFixed(6)),
    usdRateUsed: Number(usdRateUsed.toFixed(6)),
    fxSource,
  };

  data.transactions.push(tx);
  saveData(data);
}

/* =========================
   MONTHLY SUMMARY (USD)
   - Plan: ayın effective kuru (override/avg)
   - Actual: tx.usdAmount (sabit)
========================= */
function calcMonthlySummary(year, month) {
  const data = loadData();
  const ymKey = `${year}-${month}`;

  let planIncome = 0;
  let planExpense = 0;
  let actualIncome = 0;
  let actualExpense = 0;

  // Plans (categories)
  for (const c of data.categories.income) {
    const v = c.monthlyBudgets?.[month] || 0;
    planIncome += toUSD_plan(v, c.currency, ymKey);
  }
  for (const c of data.categories.expense) {
    const v = c.monthlyBudgets?.[month] || 0;
    planExpense += toUSD_plan(v, c.currency, ymKey);
  }

  // Actuals (transactions) - use snapshot
  for (const t of data.transactions) {
    const ym = ymFromDate(t.date);
    if (ym.y === year && ym.m === month) {
      const usd = t.usdAmount != null ? Number(t.usdAmount) : toUSD_plan(t.amount, t.currency, ymKey);
      if (t.type === "income") actualIncome += usd;
      if (t.type === "expense") actualExpense += usd;
    }
  }

  return {
    planIncome,
    planExpense,
    actualIncome,
    actualExpense,
    netPlan: planIncome - planExpense,
    netActual: actualIncome - actualExpense,
  };
}

/* =========================
   YEAR/MONTH SELECTORS
========================= */
function ensureYearMonthSelectors() {
  const data = loadData();
  const yearSel = $("selYear");
  const monthSel = $("selMonth");

  if (yearSel && !yearSel.children.length) {
    const years = new Set();
    data.transactions.forEach((t) => years.add(String(t.date).slice(0, 4)));
    if (!years.size) years.add(String(new Date().getFullYear()));

    [...years].sort().forEach((y) => {
      const o = document.createElement("option");
      o.value = y;
      o.textContent = y;
      yearSel.appendChild(o);
    });

    yearSel.value = [...years][0];
  }

  if (monthSel && !monthSel.value) {
    monthSel.value = new Date().toISOString().slice(5, 7);
  }
}

/* =========================
   FX PANEL
========================= */
function renderFxPanel() {
  const data = loadData();
  const ymKey = getSelectedYMKey();

  const fxTRY = $("fxTRY");
  const fxEUR = $("fxEUR");
  const fxRUB = $("fxRUB");
  const fxInfo = $("fxInfo");

  if (!fxTRY || !fxEUR || !fxRUB || !fxInfo) return;

  const effTRY = getEffectiveUsdRate(ymKey, "TRY");
  const effEUR = getEffectiveUsdRate(ymKey, "EUR");
  const effRUB = getEffectiveUsdRate(ymKey, "RUB");

  fxTRY.value = effTRY;
  fxEUR.value = effEUR;
  fxRUB.value = effRUB;

  const hasOverride = !!(data.fx?.overrides?.[ymKey]);
  const avg = data.fx?.monthlyAvg?.[ymKey];

  fxInfo.textContent =
    `Ay: ${ymKey}\n` +
    `Kaynak: ${hasOverride ? "Manual Override (öncelikli)" : avg ? "Internet Avg (Frankfurter/ECB)" : "Fallback"}\n` +
    (avg ? `Avg gün sayısı: ${avg._days ?? "-"}\n` : "") +
    (data.fx?.lastUpdatedAt ? `Last update: ${data.fx.lastUpdatedAt}` : "");
}

/* =========================
   RENDER
========================= */
function render() {
  const data = loadData();

  ensureMonthInputs();
  renderCategoryList();
  fillTxCategorySelect($("txType")?.value || "expense");
  ensureYearMonthSelectors();

  setStatus([
    `Kategoriler (Gelir): ${data.categories.income.length}`,
    `Kategoriler (Gider): ${data.categories.expense.length}`,
    `İşlem sayısı: ${data.transactions.length}`,
    `Kur (fallback): ${JSON.stringify(data.exchangeRates)}`,
  ].join("\n"));

  // Transactions list
  const txList = $("txList");
  if (txList) {
    if (!data.transactions.length) {
      txList.textContent = "(işlem yok)";
    } else {
      const last = data.transactions.slice(-10).reverse();
      txList.innerHTML = last
        .map((t) => {
          const sign = t.type === "expense" ? "-" : "+";
          const cat = getCategoryNameById(t.type, t.categoryId) || "-";
          const usd = (t.usdAmount != null) ? Number(t.usdAmount).toFixed(2) : "-";
          return `<div>${t.date} | ${sign}${t.amount} ${t.currency} | ${cat} | ${t.note} | USD:${usd}</div>`;
        })
        .join("");
    }
  }

  // Monthly summary
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  const box = $("monthlySummary");
  if (y && m && box) {
    const s = calcMonthlySummary(y, m);
    box.textContent =
      `Plan Gelir: ${s.planIncome.toFixed(2)} USD\n` +
      `Gerçek Gelir: ${s.actualIncome.toFixed(2)} USD\n` +
      `Plan Gider: ${s.planExpense.toFixed(2)} USD\n` +
      `Gerçek Gider: ${s.actualExpense.toFixed(2)} USD\n\n` +
      `Net (Plan): ${s.netPlan.toFixed(2)} USD\n` +
      `Net (Gerçek): ${s.netActual.toFixed(2)} USD`;
  }

  // FX panel
  renderFxPanel();
}

/* =========================
   EVENTS
========================= */
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

// Transaction defaults + save (daily fx snapshot)
const dateInput = $("txDate");
if (dateInput && !dateInput.value) dateInput.value = todayISO();

$("txType")?.addEventListener("change", (e) => {
  fillTxCategorySelect(e.target.value);
  render(); // özet vs güncellensin
});

$("btnAddTx")?.addEventListener("click", async () => {
  const btn = $("btnAddTx");
  if (btn) btn.disabled = true;

  try {
    const type = $("txType")?.value || "expense";
    const date = $("txDate")?.value || todayISO();
    const amount = $("txAmount")?.value;
    const currency = $("txCurrency")?.value || "USD";
    const note = $("txNote")?.value || "";
    const categoryId = $("txCategory")?.value || 0;

    if (!amount || Number(amount) <= 0) {
      alert("Tutar gir (0'dan büyük) ❗️");
      return;
    }

    await addTransaction({ type, date, amount, currency, note, categoryId });

    if ($("txAmount")) $("txAmount").value = "";
    if ($("txNote")) $("txNote").value = "";

    render();
  } catch {
    alert("Kur çekilemedi / işlem kaydedilemedi ❌");
  } finally {
    if (btn) btn.disabled = false;
  }
});

// Category buttons
$("btnEqualSplit")?.addEventListener("click", () => {
  const yearly = Number($("catYearly")?.value || 0);
  const each = yearly / 12;
  const obj = {};
  for (let i = 1; i <= 12; i++) obj[monthKey(i)] = Number(each.toFixed(2));
  writeMonthInputs(obj);
});

$("btnAddCategory")?.addEventListener("click", () => {
  const type = $("catType")?.value || "expense";
  const currency = $("catCurrency")?.value || "USD";
  const name = $("catName")?.value?.trim() || "";
  const yearly = $("catYearly")?.value || 0;
  const monthly = readMonthInputs();

  if (!name) {
    alert("Kategori adı gir ❗️");
    return;
  }

  addCategory({ type, name, currency, yearly, monthly });

  if ($("catName")) $("catName").value = "";
  if ($("catYearly")) $("catYearly").value = "";
  writeMonthInputs({});

  render();
});

// FX buttons
$("btnFxSave")?.addEventListener("click", () => {
  const data = loadData();
  const ymKey = getSelectedYMKey();

  const vTRY = Number($("fxTRY")?.value || 0);
  const vEUR = Number($("fxEUR")?.value || 0);
  const vRUB = Number($("fxRUB")?.value || 0);

  data.fx.overrides[ymKey] = { TRY: vTRY, EUR: vEUR, RUB: vRUB };
  saveData(data);
  render();
});

$("btnFxClear")?.addEventListener("click", () => {
  const data = loadData();
  const ymKey = getSelectedYMKey();
  if (data.fx?.overrides?.[ymKey]) delete data.fx.overrides[ymKey];
  saveData(data);
  render();
});

$("btnFxUpdate")?.addEventListener("click", async () => {
  const data = loadData();
  const ymKey = getSelectedYMKey();

  try {
    const avg = await fetchMonthlyAvgRatesUSD(ymKey);
    data.fx.monthlyAvg[ymKey] = avg;
    data.fx.lastUpdatedAt = new Date().toISOString();

    // Update basınca internet değeri esas: override temizle
    if (data.fx?.overrides?.[ymKey]) delete data.fx.overrides[ymKey];

    saveData(data);
    render();
    alert("Kurlar güncellendi ✅");
  } catch {
    alert("Kur çekilemedi ❌");
  }
});

// Year/Month change
$("selYear")?.addEventListener("change", render);
$("selMonth")?.addEventListener("change", render);

// Initial paint
render();
