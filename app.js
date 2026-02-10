const STORAGE_KEY = "butce_data_v1";

/* =========================
   DATA
========================= */
function defaultData() {
  return {
    app: { version: 5, locale: "tr", baseCurrency: "USD" },
    fx: { monthlyAvg: {}, overrides: {}, lastUpdatedAt: null },
    categories: { income: [], expense: [] },
    transactions: [],
    monthlyRates: {},
    exchangeRates: { USD: 1, TRY: 1, EUR: 1, RUB: 1 },
    nextCategoryId: 1,
    balanceSheets: {}
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
    balanceSheets: d.balanceSheets ?? base.balanceSheets,
  };
}

/* =========================
   DOM / UTIL
========================= */
function $(id) { return document.getElementById(id); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function pad2(n) { return String(n).padStart(2, "0"); }

function setStatus(text) { if ($("status")) $("status").textContent = text; }

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

function ymFromDate(d) {
  const [y, m] = String(d).split("-");
  return { y, m };
}

function isYM(str) {
  return /^\d{4}\-(0[1-9]|1[0-2])$/.test(String(str).trim());
}

function getSelectedYMKey() {
  const y = $("selYear")?.value;
  const m = $("selMonth")?.value;
  if (y && m) return `${y}-${m}`;
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function ensureYearMonthSelectors() {
  const data = loadData();
  const yearSel = $("selYear");
  const monthSel = $("selMonth");
  if (!yearSel || !monthSel) return;

  const years = new Set();
  data.transactions.forEach(t => years.add(String(t.date).slice(0, 4)));
  Object.keys(data.balanceSheets || {}).forEach(k => years.add(k.slice(0, 4)));
  Object.keys(data.fx?.monthlyAvg || {}).forEach(k => years.add(k.slice(0, 4)));
  Object.keys(data.fx?.overrides || {}).forEach(k => years.add(k.slice(0, 4)));
  if (!years.size) years.add(String(new Date().getFullYear()));

  const existing = new Set([...yearSel.options].map(o => o.value));
  [...years].sort().forEach(y => {
    if (!existing.has(y)) {
      const o = document.createElement("option");
      o.value = y; o.textContent = y;
      yearSel.appendChild(o);
    }
  });

  if (!yearSel.value) yearSel.value = [...years].sort()[0];
  if (!monthSel.value) monthSel.value = pad2(new Date().getMonth() + 1);
}

function setSelectedYMKey(ymKey) {
  if (!isYM(ymKey)) return false;
  const [y, m] = ymKey.split("-");
  ensureYearMonthSelectors();
  if ($("selYear")) $("selYear").value = y;
  if ($("selMonth")) $("selMonth").value = m;
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
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   TABS
========================= */
function setTab(tabName) {
  const budget = $("tabBudget");
  const bal = $("tabBalance");
  const b1 = $("tabBtnBudget");
  const b2 = $("tabBtnBalance");
  if (!budget || !bal || !b1 || !b2) return;

  if (tabName === "balance") {
    budget.classList.add("hidden");
    bal.classList.remove("hidden");
    b1.classList.remove("active");
    b2.classList.add("active");
  } else {
    bal.classList.add("hidden");
    budget.classList.remove("hidden");
    b2.classList.remove("active");
    b1.classList.add("active");
  }
}

/* =========================
   FX (MONTHLY AVG) + DAILY (TX SNAPSHOT)
========================= */
function daysInMonth(year, month) {
  const y = Number(year), m = Number(month);
  return new Date(y, m, 0).getDate();
}

async function fetchMonthlyAvgRatesUSD(ymKey) {
  const [y, m] = ymKey.split("-");
  const start = `${y}-${m}-01`;
  const end = `${y}-${m}-${pad2(daysInMonth(y, m))}`;
  const url = `https://api.frankfurter.app/${start}..${end}?from=USD&to=TRY,EUR,RUB`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("FX monthly fetch failed");
  const json = await res.json();

  const sums = { TRY: 0, EUR: 0, RUB: 0 };
  let count = 0;

  for (const d in (json.rates || {})) {
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
    _days: count
  };
}

async function fetchDailyUsdRates(dateISO) {
  const url = `https://api.frankfurter.app/${dateISO}?from=USD&to=TRY,EUR,RUB`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("FX daily fetch failed");
  const json = await res.json();
  if (!json.rates) throw new Error("FX daily missing rates");
  return {
    TRY: Number(json.rates.TRY),
    EUR: Number(json.rates.EUR),
    RUB: Number(json.rates.RUB),
  };
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

// Plan dönüşümü (ay bazlı)
function toUSD_plan(amount, currency, ymKey) {
  if (currency === "USD") return Number(amount);
  const rate = getEffectiveUsdRate(ymKey, currency);
  return Number(amount) / rate;
}

/* =========================
   CATEGORIES (PLAN)
========================= */
function monthKey(i) { return String(i).padStart(2, "0"); }

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
  for (let i = 1; i <= 12; i++) obj[monthKey(i)] = Number($(`m_${i}`)?.value || 0);
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
    id, type, name, currency,
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

function getCategoryNameById(type, id) {
  const data = loadData();
  const arr = data.categories[type] || [];
  const found = arr.find(x => Number(x.id) === Number(id));
  return found ? found.name : "";
}

/* =========================
   TRANSACTIONS (DAILY FX SNAPSHOT)
========================= */
async function addTransaction({ type, date, amount, currency, note, categoryId }) {
  const data = loadData();

  const amt = Number(amount);
  const cur = currency;

  let usdAmount = amt;
  let usdRateUsed = 1;
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
    usdAmount: Number(usdAmount.toFixed(6)),
    usdRateUsed: Number(usdRateUsed.toFixed(6)),
    fxSource,
  };

  data.transactions.push(tx);
  saveData(data);
}

/* =========================
   MONTHLY SUMMARY (USD)
========================= */
function calcMonthlySummary(year, month) {
  const data = loadData();
  const ymKey = `${year}-${month}`;

  let planIncome = 0;
  let planExpense = 0;
  let actualIncome = 0;
  let actualExpense = 0;

  for (const c of data.categories.income) {
    const v = c.monthlyBudgets?.[month] || 0;
    planIncome += toUSD_plan(v, c.currency, ymKey);
  }
  for (const c of data.categories.expense) {
    const v = c.monthlyBudgets?.[month] || 0;
    planExpense += toUSD_plan(v, c.currency, ymKey);
  }

  for (const t of data.transactions) {
    const ym = ymFromDate(t.date);
    if (ym.y === year && ym.m === month) {
      const usd = t.usdAmount != null ? Number(t.usdAmount) : toUSD_plan(t.amount, t.currency, ymKey);
      if (t.type === "income") actualIncome += usd;
      if (t.type === "expense") actualExpense += usd;
    }
  }

  return {
    planIncome, planExpense, actualIncome, actualExpense,
    netPlan: planIncome - planExpense,
    netActual: actualIncome - actualExpense
  };
}

/* =========================
   BALANCE SHEET (BİLANÇO) + v2
========================= */
function ensureBalanceMonth(ymKey) {
  const data = loadData();
  data.balanceSheets = data.balanceSheets || {};
  if (!data.balanceSheets[ymKey]) {
    data.balanceSheets[ymKey] = {
      assets: [],
      liabilities: [],
      plan: { assets: 0, liab: 0, equity: 0 }
    };
    saveData(data);
  }
  return data.balanceSheets[ymKey];
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function sumItems(items) {
  return (items || []).reduce((a, x) => a + Number(x.amount || 0), 0);
}

function calcBalanceTotals(ymKey) {
  const data = loadData();
  const sheet = data.balanceSheets?.[ymKey];
  if (!sheet) return null;

  const assets = sumItems(sheet.assets);
  const liab = sumItems(sheet.liabilities);
  const equity = assets - liab;

  const planA = Number(sheet.plan?.assets || 0);
  const planL = Number(sheet.plan?.liab || 0);
  const planE = Number(sheet.plan?.equity || 0);

  return {
    assets, liab, equity,
    planA, planL, planE,
    deltaA: assets - planA,
    deltaL: liab - planL,
    deltaE: equity - planE
  };
}

function getAllBalanceMonthsSorted() {
  const data = loadData();
  const keys = Object.keys(data.balanceSheets || {});
  return keys.filter(isYM).sort();
}

function getYtdBaseMonth(ymKey) {
  const [y] = ymKey.split("-");
  const all = getAllBalanceMonthsSorted().filter(k => k.startsWith(`${y}-`));
  if (!all.length) return null;
  const jan = `${y}-01`;
  return all.includes(jan) ? jan : all[0]; // senin kuralın
}

function renderItemsTable(tableId, items, kind) {
  const table = $(tableId);
  if (!table) return;

  const head =
    `<tr>
      <th style="width:45%;">Kalem</th>
      <th class="right" style="width:35%;">Tutar (USD)</th>
      <th style="width:20%;">İşlem</th>
    </tr>`;

  const rows = (items || []).map(it => {
    const id = it.id;
    const name = escapeHtml(it.name || "");
    const amt = Number(it.amount || 0);

    return `<tr>
      <td><input data-kind="${kind}" data-id="${id}" data-field="name" value="${name}" /></td>
      <td class="right"><input data-kind="${kind}" data-id="${id}" data-field="amount" type="number" step="0.01" value="${amt}" /></td>
      <td><button class="btn danger" data-kind="${kind}" data-action="del" data-id="${id}">Sil</button></td>
    </tr>`;
  }).join("");

  table.innerHTML = head + rows;

  table.querySelectorAll("input[data-kind]").forEach(inp => {
    inp.addEventListener("change", () => {
      const kind2 = inp.getAttribute("data-kind");
      const id2 = inp.getAttribute("data-id");
      const field = inp.getAttribute("data-field");
      const value = inp.value;

      const data = loadData();
      const ymKey = getSelectedYMKey();
      const sheet = ensureBalanceMonth(ymKey);
      const arr = (kind2 === "asset") ? sheet.assets : sheet.liabilities;
      const obj = arr.find(x => x.id === id2);
      if (!obj) return;

      if (field === "amount") obj.amount = Number(value || 0);
      else obj.name = value;

      data.balanceSheets[ymKey] = sheet;
      saveData(data);
      render();
    });
  });

  table.querySelectorAll("button[data-action='del']").forEach(btn => {
    btn.addEventListener("click", () => {
      const kind2 = btn.getAttribute("data-kind");
      const id2 = btn.getAttribute("data-id");

      const data = loadData();
      const ymKey = getSelectedYMKey();
      const sheet = ensureBalanceMonth(ymKey);

      if (kind2 === "asset") sheet.assets = (sheet.assets || []).filter(x => x.id !== id2);
      else sheet.liabilities = (sheet.liabilities || []).filter(x => x.id !== id2);

      data.balanceSheets[ymKey] = sheet;
      saveData(data);
      render();
    });
  });
}

function addBalanceItem(kind, name, amount) {
  const data = loadData();
  const ymKey = getSelectedYMKey();
  const sheet = ensureBalanceMonth(ymKey);

  const item = {
    id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    name: (name || "").trim(),
    amount: Number(amount || 0)
  };
  if (!item.name) return;

  if (kind === "asset") sheet.assets.push(item);
  else sheet.liabilities.push(item);

  data.balanceSheets[ymKey] = sheet;
  saveData(data);
}

function saveBalancePlan() {
  const data = loadData();
  const ymKey = getSelectedYMKey();
  const sheet = ensureBalanceMonth(ymKey);

  sheet.plan = {
    assets: Number($("planAssets")?.value || 0),
    liab: Number($("planLiab")?.value || 0),
    equity: Number($("planEquity")?.value || 0),
  };

  data.balanceSheets[ymKey] = sheet;
  saveData(data);
}

function copyPrevMonthSnapshot() {
  const data = loadData();
  const ymKey = getSelectedYMKey();
  const prevKey = prevMonth(ymKey);

  if (!data.balanceSheets?.[prevKey]) {
    alert("Önceki ayda bilanço verisi yok ❗️");
    return;
  }

  // Seçili ay boş değilse uyar
  const cur = ensureBalanceMonth(ymKey);
  const hasAnything = (cur.assets?.length || 0) + (cur.liabilities?.length || 0) > 0;
  if (hasAnything) {
    if (!confirm("Seçili ayda veri var. Üzerine yazılsın mı?")) return;
  }

  const src = data.balanceSheets[prevKey];
  const cloned = deepClone(src);

  // id’leri tazeleyelim (çakışma olmasın)
  const regen = (arr) => (arr || []).map(x => ({ ...x, id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random() }));
  cloned.assets = regen(cloned.assets);
  cloned.liabilities = regen(cloned.liabilities);

  data.balanceSheets[ymKey] = cloned;
  saveData(data);
  render();
}

/* =========================
   LOAN PAYMENT AUTOMATION (v2)
   - selected month: reduce chosen liability, increase chosen asset
========================= */
function fillLoanSelectors() {
  const ymKey = getSelectedYMKey();
  const sheet = ensureBalanceMonth(ymKey);

  const liabSel = $("loanLiabSelect");
  const assetSel = $("loanAssetSelect");
  if (!liabSel || !assetSel) return;

  liabSel.innerHTML = (sheet.liabilities || []).length
    ? sheet.liabilities.map(x => `<option value="${x.id}">${escapeHtml(x.name)} (${Number(x.amount||0).toFixed(2)})</option>`).join("")
    : `<option value="">(yükümlülük yok)</option>`;

  assetSel.innerHTML = (sheet.assets || []).length
    ? sheet.assets.map(x => `<option value="${x.id}">${escapeHtml(x.name)} (${Number(x.amount||0).toFixed(2)})</option>`).join("")
    : `<option value="">(varlık yok)</option>`;
}

function applyLoanPayment() {
  const amt = Number($("loanPaymentAmt")?.value || 0);
  if (!amt || amt <= 0) { alert("Anapara ödemesi gir (0’dan büyük)"); return; }

  const ymKey = getSelectedYMKey();
  const data = loadData();
  const sheet = ensureBalanceMonth(ymKey);

  const liabId = $("loanLiabSelect")?.value;
  const assetId = $("loanAssetSelect")?.value;
  if (!liabId || !assetId) { alert("Kredi ve varlık kalemlerini seç"); return; }

  const liab = (sheet.liabilities || []).find(x => x.id === liabId);
  const asset = (sheet.assets || []).find(x => x.id === assetId);
  if (!liab || !asset) { alert("Seçimler bulunamadı"); return; }

  const beforeLiab = Number(liab.amount || 0);
  const beforeAsset = Number(asset.amount || 0);

  liab.amount = Math.max(0, beforeLiab - amt);
  asset.amount = beforeAsset + amt;

  data.balanceSheets[ymKey] = sheet;
  saveData(data);

  const info = $("loanInfo");
  if (info) {
    info.textContent =
      `Uygulandı ✅\n` +
      `Ay: ${ymKey}\n` +
      `Kredi: ${liab.name} | ${beforeLiab.toFixed(2)} → ${liab.amount.toFixed(2)}\n` +
      `Varlık: ${asset.name} | ${beforeAsset.toFixed(2)} → ${asset.amount.toFixed(2)}\n`;
  }

  render();
}

/* =========================
   BALANCE RENDER + SUMMARY
========================= */
function renderBalance() {
  const ymKey = getSelectedYMKey();
  const sheet = ensureBalanceMonth(ymKey);
  const totals = calcBalanceTotals(ymKey);

  renderItemsTable("assetsTable", sheet.assets, "asset");
  renderItemsTable("liabTable", sheet.liabilities, "liab");

  if ($("balTotals") && totals) {
    $("balTotals").textContent =
      `Toplam Varlıklar: ${totals.assets.toFixed(2)} USD\n` +
      `Toplam Yükümlülükler: ${totals.liab.toFixed(2)} USD\n` +
      `Özsermaye (Equity): ${totals.equity.toFixed(2)} USD`;
  }

  if ($("planAssets")) $("planAssets").value = Number(sheet.plan?.assets || 0);
  if ($("planLiab")) $("planLiab").value = Number(sheet.plan?.liab || 0);
  if ($("planEquity")) $("planEquity").value = Number(sheet.plan?.equity || 0);

  const prevKey = prevMonth(ymKey);
  const prevTotals = calcBalanceTotals(prevKey);
  const baseKey = getYtdBaseMonth(ymKey);
  const baseTotals = baseKey ? calcBalanceTotals(baseKey) : null;

  const momA = prevTotals ? (totals.assets - prevTotals.assets) : 0;
  const momL = prevTotals ? (totals.liab - prevTotals.liab) : 0;
  const momE = prevTotals ? (totals.equity - prevTotals.equity) : 0;

  const ytdA = baseTotals ? (totals.assets - baseTotals.assets) : 0;
  const ytdL = baseTotals ? (totals.liab - baseTotals.liab) : 0;
  const ytdE = baseTotals ? (totals.equity - baseTotals.equity) : 0;

  if ($("balSummary")) {
    $("balSummary").textContent =
      `Ay: ${ymKey}\n` +
      `MoM (Önceki ay): Varlık ${momA.toFixed(2)} | Yükümlülük ${momL.toFixed(2)} | Equity ${momE.toFixed(2)}\n` +
      `YTD (Başlangıç: ${baseKey ?? "-"}) : Varlık ${ytdA.toFixed(2)} | Yükümlülük ${ytdL.toFixed(2)} | Equity ${ytdE.toFixed(2)}\n\n` +
      `Plan vs Gerçekleşen (Δ):\n` +
      `- Varlık Δ: ${totals.deltaA.toFixed(2)}\n` +
      `- Yükümlülük Δ: ${totals.deltaL.toFixed(2)}\n` +
      `- Equity Δ: ${totals.deltaE.toFixed(2)}\n`;
  }

  fillLoanSelectors();
}

/* =========================
   TREND GRAPH (Plan vs Actual Equity)
========================= */
function getInRangeMonths(fromYM, toYM) {
  const all = getAllBalanceMonthsSorted();
  return all.filter(k => k >= fromYM && k <= toYM);
}

function drawTrendChart(canvas, labels, actualEq, planEq) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;

  // clear
  ctx.clearRect(0, 0, w, h);

  // padding
  const pad = 40;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;

  const allVals = [...actualEq, ...planEq].filter(v => Number.isFinite(v));
  const minV = Math.min(...allVals, 0);
  const maxV = Math.max(...allVals, 1);

  const xFor = (i) => pad + (labels.length <= 1 ? 0 : (i * plotW) / (labels.length - 1));
  const yFor = (v) => {
    const t = (v - minV) / (maxV - minV || 1);
    return pad + (1 - t) * plotH;
  };

  // axes
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#bbb";
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, pad + plotH);
  ctx.lineTo(pad + plotW, pad + plotH);
  ctx.stroke();

  // helper grid ticks
  ctx.fillStyle = "#666";
  ctx.font = "12px sans-serif";
  ctx.fillText(`${maxV.toFixed(0)}`, 6, pad + 12);
  ctx.fillText(`${minV.toFixed(0)}`, 6, pad + plotH);

  // lines
  const drawLine = (arr, stroke) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    arr.forEach((v, i) => {
      const x = xFor(i);
      const y = yFor(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  // Actual (black) + Plan (gray)
  drawLine(actualEq, "#111");
  drawLine(planEq, "#888");

  // legend
  ctx.fillStyle = "#111"; ctx.fillText("Actual Equity", pad, h - 10);
  ctx.fillStyle = "#888"; ctx.fillText("Plan Equity", pad + 120, h - 10);

  // x labels (sparse)
  ctx.fillStyle = "#666";
  const step = Math.max(1, Math.floor(labels.length / 6));
  labels.forEach((lab, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const x = xFor(i);
    ctx.fillText(lab, Math.min(x - 18, w - 60), pad + plotH + 16);
  });
}

function buildTrendAndDraw(fromYM, toYM) {
  if (!isYM(fromYM) || !isYM(toYM)) return "Tarih formatı yanlış. YYYY-MM olmalı.";
  const months = getInRangeMonths(fromYM, toYM);
  if (!months.length) return "Seçilen aralıkta bilanço verisi yok.";

  const labels = [];
  const actualEq = [];
  const planEq = [];

  const lines = [];
  lines.push("Ay | Equity(Actual) | Equity(Plan) | Δ");
  lines.push("--------------------------------------");

  months.forEach(k => {
    const t = calcBalanceTotals(k);
    if (!t) return;
    labels.push(k);
    actualEq.push(t.equity);
    planEq.push(t.planE);
    lines.push(`${k} | ${t.equity.toFixed(0)} | ${t.planE.toFixed(0)} | ${(t.equity - t.planE).toFixed(0)}`);
  });

  drawTrendChart($("trendCanvas"), labels, actualEq, planEq);
  return lines.join("\n");
}

/* =========================
   BUDGET UI HELPERS (FX PANEL)
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
    `Kaynak: ${hasOverride ? "Manual Override (öncelikli)" : (avg ? "Internet Avg (Frankfurter/ECB)" : "Fallback")}\n` +
    (avg ? `Avg gün sayısı: ${avg._days ?? "-"}\n` : "") +
    (data.fx?.lastUpdatedAt ? `Last update: ${data.fx.lastUpdatedAt}` : "");
}

/* =========================
   RENDER
========================= */
function render() {
  const data = loadData();
  ensureYearMonthSelectors();

  ensureMonthInputs();
  renderCategoryList();
  fillTxCategorySelect($("txType")?.value || "expense");
  renderFxPanel();

  // Monthly summary
  const ymKey = getSelectedYMKey();
  const [y, m] = ymKey.split("-");
  const sumBox = $("monthlySummary");
  if (sumBox) {
    const s = calcMonthlySummary(y, m);
    sumBox.textContent =
      `Plan Gelir: ${s.planIncome.toFixed(2)} USD\n` +
      `Gerçek Gelir: ${s.actualIncome.toFixed(2)} USD\n` +
      `Plan Gider: ${s.planExpense.toFixed(2)} USD\n` +
      `Gerçek Gider: ${s.actualExpense.toFixed(2)} USD\n\n` +
      `Net (Plan): ${s.netPlan.toFixed(2)} USD\n` +
      `Net (Gerçek): ${s.netActual.toFixed(2)} USD`;
  }

  // Transactions list
  const txList = $("txList");
  if (txList) {
    if (!data.transactions.length) txList.textContent = "(işlem yok)";
    else {
      const last = data.transactions.slice(-10).reverse();
      txList.innerHTML = last.map(t => {
        const sign = t.type === "expense" ? "-" : "+";
        const cat = getCategoryNameById(t.type, t.categoryId) || "-";
        const usd = (t.usdAmount != null) ? Number(t.usdAmount).toFixed(2) : "-";
        return `<div>${t.date} | ${sign}${t.amount} ${t.currency} | ${escapeHtml(cat)} | ${escapeHtml(t.note||"")} | USD:${usd}</div>`;
      }).join("");
    }
  }

  // Balance
  renderBalance();

  setStatus([
    `Kategoriler (Gelir): ${data.categories.income.length}`,
    `Kategoriler (Gider): ${data.categories.expense.length}`,
    `İşlem sayısı: ${data.transactions.length}`,
    `Bilanço ay sayısı: ${Object.keys(data.balanceSheets || {}).length}`,
  ].join("\n"));
}

/* =========================
   EVENTS
========================= */
// Tabs
$("tabBtnBudget")?.addEventListener("click", () => setTab("budget"));
$("tabBtnBalance")?.addEventListener("click", () => setTab("balance"));

// Period
$("selYear")?.addEventListener("change", render);
$("selMonth")?.addEventListener("change", render);

// Quick open month
$("btnOpenYM")?.addEventListener("click", () => {
  const v = String($("quickYM")?.value || "").trim();
  if (!isYM(v)) { alert("YYYY-MM formatı gir (örn 2023-01)"); return; }
  ensureBalanceMonth(v);
  setSelectedYMKey(v);
  render();
});

// Copy prev month
$("btnCopyPrevMonth")?.addEventListener("click", copyPrevMonthSnapshot);

// FX
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
    if (data.fx?.overrides?.[ymKey]) delete data.fx.overrides[ymKey];
    saveData(data);
    render();
    alert("Kurlar güncellendi ✅");
  } catch {
    alert("Kur çekilemedi ❌");
  }
});

// Categories
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
  if (!name) { alert("Kategori adı gir ❗️"); return; }
  addCategory({ type, name, currency, yearly, monthly });
  if ($("catName")) $("catName").value = "";
  if ($("catYearly")) $("catYearly").value = "";
  writeMonthInputs({});
  render();
});

// Tx
const dateInput = $("txDate");
if (dateInput && !dateInput.value) dateInput.value = todayISO();

$("txType")?.addEventListener("change", (e) => {
  fillTxCategorySelect(e.target.value);
  render();
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
    if (!amount || Number(amount) <= 0) { alert("Tutar gir (0'dan büyük) ❗️"); return; }
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

// Backup
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

// Balance CRUD
$("btnAddAsset")?.addEventListener("click", () => {
  addBalanceItem("asset", $("newAssetName")?.value, $("newAssetAmt")?.value);
  if ($("newAssetName")) $("newAssetName").value = "";
  if ($("newAssetAmt")) $("newAssetAmt").value = "";
  render();
});

$("btnAddLiab")?.addEventListener("click", () => {
  addBalanceItem("liab", $("newLiabName")?.value, $("newLiabAmt")?.value);
  if ($("newLiabName")) $("newLiabName").value = "";
  if ($("newLiabAmt")) $("newLiabAmt").value = "";
  render();
});

$("btnSavePlan")?.addEventListener("click", () => {
  saveBalancePlan();
  render();
});

// Loan automation
$("btnApplyLoanPayment")?.addEventListener("click", applyLoanPayment);

// Trend
$("btnTrendBuild")?.addEventListener("click", () => {
  const fromYM = String($("trendFrom")?.value || "").trim();
  const toYM = String($("trendTo")?.value || "").trim();
  const out = buildTrendAndDraw(fromYM, toYM);
  if ($("trendBox")) $("trendBox").textContent = out;
});

// Initial
render();
