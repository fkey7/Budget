const STORAGE_KEY = "butce_data_v1";

/* =========================
   DATA (default + storage)
========================= */
function defaultData() {
  return {
    app: { version: 2, locale: "tr", baseCurrency: "USD" },
    categories: { income: [], expense: [] },
    transactions: [],
    monthlyRates: {},
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
function setStatus(text) {
  const el = document.getElementById("status");
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

function toUSD(amount, currency) {
  const data = loadData();
  const rate = data.exchangeRates?.[currency] || 1;
  return currency === "USD" ? Number(amount) : Number(amount) / Number(rate);
}

/* =========================
   CATEGORIES (plan)
========================= */
function monthKey(i) {
  return String(i).padStart(2, "0"); // "01".."12"
}

function ensureMonthInputs() {
  const box = document.getElementById("catMonths");
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
    obj[monthKey(i)] = Number(document.getElementById(`m_${i}`)?.value || 0);
  }
  return obj;
}

function writeMonthInputs(obj) {
  for (let i = 1; i <= 12; i++) {
    const k = monthKey(i);
    const el = document.getElementById(`m_${i}`);
    if (el) el.value = obj?.[k] ?? 0;
  }
}

function addCategory({ type, name, currency, yearly, monthly }) {
  const data = loadData();
  const id = data.nextCategoryId++;

  const cat = {
    id,
    type, // income/expense
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
  const list = document.getElementById("catList");
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
  const sel = document.getElementById("txCategory");
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
   TRANSACTIONS
========================= */
function addTransaction({ type, date, amount, currency, note, categoryId }) {
  const data = loadData();

  const tx = {
    id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
    type, // income/expense
    date, // YYYY-MM-DD
    amount: Number(amount),
    currency,
    note: note || "",
    categoryId: Number(categoryId) || 0,
  };

  data.transactions.push(tx);
  saveData(data);
}

/* =========================
   MONTHLY SUMMARY (USD)
========================= */
function calcMonthlySummary(year, month) {
  const data = loadData();

  let planIncome = 0;
  let planExpense = 0;
  let actualIncome = 0;
  let actualExpense = 0;

  // Plans from categories
  for (const c of data.categories.income) {
    const v = c.monthlyBudgets?.[month] || 0;
    planIncome += toUSD(v, c.currency);
  }
  for (const c of data.categories.expense) {
    const v = c.monthlyBudgets?.[month] || 0;
    planExpense += toUSD(v, c.currency);
  }

  // Actuals from transactions
  for (const t of data.transactions) {
    const ym = ymFromDate(t.date);
    if (ym.y === year && ym.m === month) {
      const usd = toUSD(t.amount, t.currency);
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
  const yearSel = document.getElementById("selYear");
  const monthSel = document.getElementById("selMonth");

  // Year
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

  // Month
  if (monthSel && !monthSel.value) {
    monthSel.value = new Date().toISOString().slice(5, 7);
  }
}

/* =========================
   RENDER
========================= */
function render() {
  const data = loadData();

  // If category UI exists
  ensureMonthInputs();
  renderCategoryList();
  fillTxCategorySelect(document.getElementById("txType")?.value || "expense");

  ensureYearMonthSelectors();

  // Status
  setStatus([
    `Kategoriler (Gelir): ${data.categories.income.length}`,
    `Kategoriler (Gider): ${data.categories.expense.length}`,
    `İşlem sayısı: ${data.transactions.length}`,
    `Kur: ${JSON.stringify(data.exchangeRates)}`,
    `monthlyRates anahtar sayısı: ${Object.keys(data.monthlyRates).length}`,
  ].join("\n"));

  // Transactions list
  const txList = document.getElementById("txList");
  if (txList) {
    if (!data.transactions.length) {
      txList.textContent = "(işlem yok)";
    } else {
      const last = data.transactions.slice(-10).reverse();
      txList.innerHTML = last
        .map((t) => {
          const sign = t.type === "expense" ? "-" : "+";
          const cat = getCategoryNameById(t.type, t.categoryId) || "-";
          return `<div>${t.date} | ${sign}${t.amount} ${t.currency} | ${cat} | ${t.note}</div>`;
        })
        .join("");
    }
  }

  // Monthly summary
  const y = document.getElementById("selYear")?.value;
  const m = document.getElementById("selMonth")?.value;
  const box = document.getElementById("monthlySummary");

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
}

/* =========================
   EVENTS
========================= */
document.getElementById("btnExport")?.addEventListener("click", () => {
  const data = loadData();
  const today = new Date().toISOString().slice(0, 10);
  downloadJson(`butce-yedek-${today}.json`, data);
});

document.getElementById("fileImport")?.addEventListener("change", async (e) => {
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

document.getElementById("btnReset")?.addEventListener("click", () => {
  if (!confirm("Tüm veriyi sıfırlamak istiyor musun?")) return;
  localStorage.removeItem(STORAGE_KEY);
  render();
});

// Transaction form defaults + save
const dateInput = document.getElementById("txDate");
if (dateInput && !dateInput.value) dateInput.value = todayISO();

document.getElementById("txType")?.addEventListener("change", (e) => {
  fillTxCategorySelect(e.target.value);
});

document.getElementById("btnAddTx")?.addEventListener("click", () => {
  const type = document.getElementById("txType")?.value || "expense";
  const date = document.getElementById("txDate")?.value || todayISO();
  const amount = document.getElementById("txAmount")?.value;
  const currency = document.getElementById("txCurrency")?.value || "USD";
  const note = document.getElementById("txNote")?.value || "";
  const categoryId = document.getElementById("txCategory")?.value || 0;

  if (!amount || Number(amount) <= 0) {
    alert("Tutar gir (0'dan büyük) ❗️");
    return;
  }

  addTransaction({ type, date, amount, currency, note, categoryId });

  if (document.getElementById("txAmount")) document.getElementById("txAmount").value = "";
  if (document.getElementById("txNote")) document.getElementById("txNote").value = "";

  render();
});

// Category buttons
document.getElementById("btnEqualSplit")?.addEventListener("click", () => {
  const yearly = Number(document.getElementById("catYearly")?.value || 0);
  const each = yearly / 12;
  const obj = {};
  for (let i = 1; i <= 12; i++) obj[monthKey(i)] = Number(each.toFixed(2));
  writeMonthInputs(obj);
});

document.getElementById("btnAddCategory")?.addEventListener("click", () => {
  const type = document.getElementById("catType")?.value || "expense";
  const currency = document.getElementById("catCurrency")?.value || "USD";
  const name = document.getElementById("catName")?.value?.trim() || "";
  const yearly = document.getElementById("catYearly")?.value || 0;
  const monthly = readMonthInputs();

  if (!name) {
    alert("Kategori adı gir ❗️");
    return;
  }

  addCategory({ type, name, currency, yearly, monthly });

  if (document.getElementById("catName")) document.getElementById("catName").value = "";
  if (document.getElementById("catYearly")) document.getElementById("catYearly").value = "";
  writeMonthInputs({});

  render();
});

// Year/Month change
document.getElementById("selYear")?.addEventListener("change", render);
document.getElementById("selMonth")?.addEventListener("change", render);

// Initial paint
render();
