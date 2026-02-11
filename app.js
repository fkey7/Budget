/* =========================
   BUDGET PRO - app.js (V1.1)
   Tek dosya: Bütçe + İşlemler + Bilanço + Otomasyon + Kopyala + Trend
   ========================= */

const STORAGE_KEY = "butce_data_v1";

/* -------------------------
   Helpers
------------------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return String(Date.now()) + "_" + Math.random().toString(16).slice(2);
}

function pad2(n) { return String(n).padStart(2, "0"); }
function ymFromDate(dateISO) {
  const d = new Date(dateISO);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  return `${y}-${m}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtUSD(x) {
  const n = Number(x || 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD";
}
function fmtNum(x) {
  const n = Number(x || 0);
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
}

/* -------------------------
   Data schema
------------------------- */
function defaultData() {
  return {
    app: {
      year: new Date().getFullYear(),
      month: pad2(new Date().getMonth() + 1),
    },
    categories: { income: [], expense: [] }, // {id,name,plans:{[ym]:usd}}
    nextCategoryId: 1,
    monthlyRates: {}, // { [ym]: { TRY:number, RUB:number } }  (bütçe dönüşümü için)
    exchangeRates: { USD: 1, TRY: 1, RUB: 1 }, // cache amaçlı (işlem anı için)
    transactions: [], // {id,type,date,amount,currency,amountUSD,rateUsed,categoryId,note,createdAt}
    balanceSheets: {
      // [ym]: { plan:{assets,liab,equity}, assets:{cash:[],investments:[],receivables:[]}, liabilities:{credits:[],cards:[],debts:[]} }
    },
  };
}

function normalizeBalanceSheet(bs) {
  const empty = {
    plan: { assets: 0, liab: 0, equity: 0 },
    assets: { cash: [], investments: [], receivables: [] },
    liabilities: { credits: [], cards: [], debts: [] },
  };
  const x = bs && typeof bs === "object" ? bs : {};
  const out = {
    plan: { ...empty.plan, ...(x.plan || {}) },
    assets: {
      cash: Array.isArray(x.assets?.cash) ? x.assets.cash : [],
      investments: Array.isArray(x.assets?.investments) ? x.assets.investments : [],
      receivables: Array.isArray(x.assets?.receivables) ? x.assets.receivables : [],
    },
    liabilities: {
      credits: Array.isArray(x.liabilities?.credits) ? x.liabilities.credits : [],
      cards: Array.isArray(x.liabilities?.cards) ? x.liabilities.cards : [],
      debts: Array.isArray(x.liabilities?.debts) ? x.liabilities.debts : [],
    },
  };

  // normalize items: {id,name,amountUSD}
  const fixItems = (arr) => (arr || [])
    .filter(Boolean)
    .map(it => ({
      id: it.id || uid(),
      name: String(it.name || "").trim(),
      amountUSD: Number(it.amountUSD ?? it.value ?? it.amount ?? 0),
    }))
    .filter(it => it.name.length > 0);

  out.assets.cash = fixItems(out.assets.cash);
  out.assets.investments = fixItems(out.assets.investments);
  out.assets.receivables = fixItems(out.assets.receivables);

  out.liabilities.credits = fixItems(out.liabilities.credits);
  out.liabilities.cards = fixItems(out.liabilities.cards);
  out.liabilities.debts = fixItems(out.liabilities.debts);

  out.plan.assets = Number(out.plan.assets || 0);
  out.plan.liab = Number(out.plan.liab || 0);
  out.plan.equity = Number(out.plan.equity || 0);

  return out;
}

function migrateIfNeeded(d) {
  const base = defaultData();
  const out = { ...base, ...d };

  out.app = { ...base.app, ...(d.app || {}) };
  out.categories = d.categories ?? base.categories;
  out.nextCategoryId = d.nextCategoryId ?? base.nextCategoryId;
  out.monthlyRates = d.monthlyRates ?? base.monthlyRates;
  out.exchangeRates = d.exchangeRates ?? base.exchangeRates;
  out.transactions = d.transactions ?? base.transactions;
  out.balanceSheets = d.balanceSheets ?? base.balanceSheets;

  out.categories.income = Array.isArray(out.categories.income) ? out.categories.income : [];
  out.categories.expense = Array.isArray(out.categories.expense) ? out.categories.expense : [];

  if (out.balanceSheets && typeof out.balanceSheets === "object") {
    for (const k of Object.keys(out.balanceSheets)) {
      out.balanceSheets[k] = normalizeBalanceSheet(out.balanceSheets[k]);
    }
  } else {
    out.balanceSheets = {};
  }

  return out;
}

/* -------------------------
   Storage
------------------------- */
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
// Firebase sync override bu fonksiyonu wrap ediyor:
window.saveData = saveData;
window.loadData = loadData;

/* -------------------------
   FX (işlem anında USD sabitleme)
   - frankfurter RUB 404 gördüğün için: open.er-api kullanıyoruz.
------------------------- */
const FX_CACHE = {
  ts: 0,
  rates: null, // {TRY:..., RUB:..., USD:1}
};

async function fetchUsdPerUnit(currency) {
  if (!currency || currency === "USD") return 1;

  const now = Date.now();
  const ttl = 5 * 60 * 1000; // 5 dk
  if (FX_CACHE.rates && (now - FX_CACHE.ts) < ttl) {
    const perUSD = Number(FX_CACHE.rates?.[currency]);
    if (perUSD) return 1 / perUSD;
  }

  const r = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
  if (!r.ok) throw new Error("Kur servisi erişilemedi");
  const j = await r.json();
  const perUSD = Number(j?.rates?.[currency]);
  if (!perUSD || !isFinite(perUSD)) throw new Error("Kur bulunamadı: " + currency);

  FX_CACHE.ts = now;
  FX_CACHE.rates = j.rates;

  return 1 / perUSD;
}

/* -------------------------
   UI init: year/month selector
------------------------- */
function ensureYearMonthSelectors() {
  const data = loadData();
  const selYear = $("selYear");
  const selMonth = $("selMonth");
  if (!selYear || !selMonth) return;

  const cur = new Date().getFullYear();
  const years = [];
  for (let y = cur - 5; y <= cur + 5; y++) years.push(y);

  selYear.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  selMonth.innerHTML = Array.from({ length: 12 }, (_, i) => {
    const m = pad2(i + 1);
    return `<option value="${m}">${m}</option>`;
  }).join("");

  selYear.value = String(data.app.year || cur);
  selMonth.value = String(data.app.month || pad2(new Date().getMonth() + 1));

  selYear.addEventListener("change", () => {
    const d = loadData();
    d.app.year = Number(selYear.value);
    saveData(d);
    render();
  });
  selMonth.addEventListener("change", () => {
    const d = loadData();
    d.app.month = String(selMonth.value);
    saveData(d);
    render();
  });
}

function currentYM() {
  const data = loadData();
  const y = Number(data.app.year);
  const m = String(data.app.month);
  return `${y}-${m}`;
}

/* -------------------------
   Tabs
------------------------- */
function showTab(tabId) {
  const tabs = ["tabBudget", "tabTx", "tabBal"];
  tabs.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", id !== tabId);
  });
}

function wireTabs() {
  $("btnTabBudget")?.addEventListener("click", () => showTab("tabBudget"));
  $("btnTabTx")?.addEventListener("click", () => showTab("tabTx"));
  $("btnTabBal")?.addEventListener("click", () => showTab("tabBal"));
}

/* -------------------------
   Categories + Plans
------------------------- */
function categoryById(id) {
  const data = loadData();
  const all = [...data.categories.income, ...data.categories.expense];
  return all.find(c => String(c.id) === String(id)) || null;
}

function getCatPlanUSD(cat, ym) {
  if (!cat) return 0;
  if (!cat.plans || typeof cat.plans !== "object") cat.plans = {};
  return Number(cat.plans?.[ym] || 0);
}

function setCatPlanUSD(catId, ym, value) {
  const data = loadData();
  const all = [...data.categories.income, ...data.categories.expense];
  const cat = all.find(c => String(c.id) === String(catId));
  if (!cat) return;
  cat.plans = cat.plans && typeof cat.plans === "object" ? cat.plans : {};
  cat.plans[ym] = Number(value || 0);
  saveData(data);
}

function ensureDefaultCategoriesIfEmpty() {
  const data = loadData();
  const empty = data.categories.income.length === 0 && data.categories.expense.length === 0;
  if (!empty) return;

  data.categories.income.push({ id: String(data.nextCategoryId++), name: "Maaş", plans: {} });
  data.categories.expense.push({ id: String(data.nextCategoryId++), name: "Kira", plans: {} });
  data.categories.expense.push({ id: String(data.nextCategoryId++), name: "Market", plans: {} });
  saveData(data);
}

function renderCategories() {
  const box = $("catBox");
  if (!box) return;

  const data = loadData();
  const ym = currentYM();

  function row(cat, type) {
    const plan = getCatPlanUSD(cat, ym);
    return `
      <div class="row" style="gap:10px;align-items:center;margin:6px 0;">
        <div style="flex:1;">
          <input data-catname="${esc(cat.id)}" value="${esc(cat.name)}" placeholder="Kategori adı" />
          <div class="muted small">${type === "income" ? "Gelir" : "Gider"}</div>
        </div>
        <div style="width:180px;">
          <label class="small muted">Plan (USD) - ${ym}</label>
          <input data-catplan="${esc(cat.id)}" type="number" step="0.01" value="${plan}" />
        </div>
        <div>
          <button class="btn danger" data-catdel="${esc(cat.id)}" type="button">Sil</button>
        </div>
      </div>
    `;
  }

  box.innerHTML = `
    <section class="card" style="margin-bottom:12px;">
      <h3>Gelir Kategorileri</h3>
      ${data.categories.income.map(c => row(c, "income")).join("")}
      <div class="row" style="gap:10px;margin-top:8px;">
        <button class="btn" id="btnAddIncomeCat" type="button">+ Gelir Kategorisi</button>
      </div>
    </section>

    <section class="card">
      <h3>Gider Kategorileri</h3>
      ${data.categories.expense.map(c => row(c, "expense")).join("")}
      <div class="row" style="gap:10px;margin-top:8px;">
        <button class="btn" id="btnAddExpenseCat" type="button">+ Gider Kategorisi</button>
      </div>
    </section>
  `;

  // events
  box.querySelectorAll("[data-catname]").forEach(inp => {
    inp.addEventListener("change", () => {
      const id = inp.getAttribute("data-catname");
      const d = loadData();
      const all = [...d.categories.income, ...d.categories.expense];
      const cat = all.find(x => String(x.id) === String(id));
      if (!cat) return;
      cat.name = inp.value.trim();
      saveData(d);
      renderTxCategorySelect();
      renderBalanceEditors();
      render();
    });
  });

  box.querySelectorAll("[data-catplan]").forEach(inp => {
    inp.addEventListener("change", () => {
      const id = inp.getAttribute("data-catplan");
      setCatPlanUSD(id, ym, inp.value);
      render();
    });
  });

  box.querySelectorAll("[data-catdel]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-catdel");
      const d = loadData();
      d.categories.income = d.categories.income.filter(c => String(c.id) !== String(id));
      d.categories.expense = d.categories.expense.filter(c => String(c.id) !== String(id));
      saveData(d);
      renderTxCategorySelect();
      renderCategories();
      render();
    });
  });

  $("btnAddIncomeCat")?.addEventListener("click", () => {
    const d = loadData();
    d.categories.income.push({ id: String(d.nextCategoryId++), name: "Yeni Gelir", plans: {} });
    saveData(d);
    renderCategories();
    renderTxCategorySelect();
  });

  $("btnAddExpenseCat")?.addEventListener("click", () => {
    const d = loadData();
    d.categories.expense.push({ id: String(d.nextCategoryId++), name: "Yeni Gider", plans: {} });
    saveData(d);
    renderCategories();
    renderTxCategorySelect();
  });
}

/* -------------------------
   Monthly rate forecasts (budget only)
------------------------- */
function ensureMonthRates(ym) {
  const d = loadData();
  d.monthlyRates = d.monthlyRates && typeof d.monthlyRates === "object" ? d.monthlyRates : {};
  if (!d.monthlyRates[ym]) {
    d.monthlyRates[ym] = { TRY: 38.5, RUB: 96.0 };
    saveData(d);
  }
}

function renderRates() {
  const box = $("rateBox");
  if (!box) return;

  const ym = currentYM();
  ensureMonthRates(ym);

  const d = loadData();
  const r = d.monthlyRates[ym] || { TRY: 0, RUB: 0 };

  box.innerHTML = `
    <div class="grid">
      <div>
        <label>USD/TRY (tahmin) - ${ym}</label>
        <input id="rateTRY" type="number" step="0.0001" value="${Number(r.TRY || 0)}" />
      </div>
      <div>
        <label>USD/RUB (tahmin) - ${ym}</label>
        <input id="rateRUB" type="number" step="0.0001" value="${Number(r.RUB || 0)}" />
      </div>
      <div class="full row">
        <button class="btn primary" id="btnSaveRates" type="button">Kaydet</button>
        <span class="muted small">Bütçe dönüşümleri için</span>
      </div>
    </div>
  `;

  $("btnSaveRates")?.addEventListener("click", () => {
    const d2 = loadData();
    d2.monthlyRates[ym] = {
      TRY: Number($("rateTRY")?.value || 0),
      RUB: Number($("rateRUB")?.value || 0),
    };
    saveData(d2);
    render();
  });
}

/* -------------------------
   Transactions
------------------------- */
function renderTxCategorySelect() {
  const sel = $("txCategory");
  if (!sel) return;

  const d = loadData();
  const type = $("txType")?.value || "expense";
  const list = type === "income" ? d.categories.income : d.categories.expense;

  sel.innerHTML = list.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
}

function wireTxForm() {
  $("txType")?.addEventListener("change", () => renderTxCategorySelect());
  const dateInput = $("txDate");
  if (dateInput && !dateInput.value) dateInput.value = todayISO();

  $("btnAddTx")?.addEventListener("click", async () => {
    const type = $("txType")?.value || "expense";
    const date = $("txDate")?.value || todayISO();
    const amount = Number($("txAmount")?.value || 0);
    const currency = $("txCurrency")?.value || "USD";
    const categoryId = $("txCategory")?.value || "";
    const note = $("txNote")?.value || "";

    if (!amount || amount <= 0) {
      alert("Tutar gir (0'dan büyük) ❗️");
      return;
    }
    if (!categoryId) {
      alert("Kategori seç ❗️");
      return;
    }

    const info = $("txInfo");
    if (info) info.textContent = "Kur çekiliyor...";

    try {
      const usdPerUnit = await fetchUsdPerUnit(currency);
      const amountUSD = amount * usdPerUnit;

      const d = loadData();
      d.exchangeRates = d.exchangeRates || { USD: 1, TRY: 1, RUB: 1 };
      if (currency !== "USD") d.exchangeRates[currency] = 1 / usdPerUnit;

      const tx = {
        id: uid(),
        type,
        date,
        amount,
        currency,
        amountUSD,
        rateUsed: usdPerUnit,
        categoryId,
        note,
        createdAt: new Date().toISOString(),
      };
      d.transactions.push(tx);

      // otomasyon
      applyBalanceAutomation(d, tx);

      saveData(d);

      // reset
      if ($("txAmount")) $("txAmount").value = "";
      if ($("txNote")) $("txNote").value = "";
      if (info) info.textContent = `Kaydedildi: ${fmtUSD(amountUSD)}`;

      render();
    } catch (e) {
      console.error(e);
      if (info) info.textContent = "";
      alert("İşlem kaydedilemedi: " + (e?.message || e));
    }
  });
}

function renderTxList() {
  const box = $("txList");
  if (!box) return;

  const d = loadData();
  const last = d.transactions.slice(-20).reverse();
  if (!last.length) {
    box.textContent = "(işlem yok)";
    return;
  }

  const allCats = [...d.categories.income, ...d.categories.expense];
  box.innerHTML = last.map(t => {
    const cat = allCats.find(c => String(c.id) === String(t.categoryId));
    const sign = t.type === "expense" ? "-" : "+";
    return `<div>${esc(t.date)} | ${esc(cat?.name || "Kategori?")} | ${sign}${fmtNum(t.amount)} ${esc(t.currency)} → <b>${fmtNum(t.amountUSD)}</b> USD ${t.note ? ("| " + esc(t.note)) : ""}</div>`;
  }).join("");
}

/* -------------------------
   Balance sheets
------------------------- */
function getBalance(ym) {
  const d = loadData();
  d.balanceSheets = d.balanceSheets || {};
  if (!d.balanceSheets[ym]) {
    d.balanceSheets[ym] = normalizeBalanceSheet(null);
    saveData(d);
  }
  return normalizeBalanceSheet(d.balanceSheets[ym]);
}

function setBalance(ym, bs) {
  const d = loadData();
  d.balanceSheets = d.balanceSheets || {};
  d.balanceSheets[ym] = normalizeBalanceSheet(bs);
  saveData(d);
}

function sumItems(arr) {
  return (arr || []).reduce((s, it) => s + Number(it.amountUSD || 0), 0);
}

function calcBalanceTotals(bs) {
  const cash = sumItems(bs.assets.cash);
  const inv = sumItems(bs.assets.investments);
  const recv = sumItems(bs.assets.receivables);
  const assets = cash + inv + recv;

  const cr = sumItems(bs.liabilities.credits);
  const cc = sumItems(bs.liabilities.cards);
  const db = sumItems(bs.liabilities.debts);
  const liab = cr + cc + db;

  const equity = assets - liab;

  return { cash, inv, recv, assets, cr, cc, db, liab, equity };
}

function renderBalanceSummary() {
  const ym = currentYM();
  const bs = getBalance(ym);
  const t = calcBalanceTotals(bs);

  const el = $("balSummary");
  if (!el) return;

  el.textContent =
    `Ay: ${ym}\n` +
    `Varlıklar: ${fmtUSD(t.assets)}  (Nakit ${fmtUSD(t.cash)} | Yatırımlar ${fmtUSD(t.inv)} | Alacaklar ${fmtUSD(t.recv)})\n` +
    `Borçlar:  ${fmtUSD(t.liab)}  (Krediler ${fmtUSD(t.cr)} | K.Kartı ${fmtUSD(t.cc)} | Diğer ${fmtUSD(t.db)})\n` +
    `EQUITY:   ${fmtUSD(t.equity)}\n\n` +
    `PLAN: Varlık ${fmtUSD(bs.plan.assets)} | Borç ${fmtUSD(bs.plan.liab)} | Equity ${fmtUSD(bs.plan.equity)}\n` +
    `FARK: Equity ${fmtUSD(t.equity - Number(bs.plan.equity || 0))}`;
}

function getBalanceArray(bs, key) {
  const [root, sub] = key.split(".");
  if (root === "assets") {
    if (!bs.assets[sub]) bs.assets[sub] = [];
    return bs.assets[sub];
  }
  if (root === "liabilities") {
    if (!bs.liabilities[sub]) bs.liabilities[sub] = [];
    return bs.liabilities[sub];
  }
  return [];
}

function pushBalanceItem(bs, key, item) {
  const arr = getBalanceArray(bs, key);
  arr.push(item);
}
function deleteBalanceItem(bs, key, id) {
  const arr = getBalanceArray(bs, key);
  const idx = arr.findIndex(x => String(x.id) === String(id));
  if (idx >= 0) arr.splice(idx, 1);
}
function findBalanceItem(bs, key, id) {
  const arr = getBalanceArray(bs, key);
  return arr.find(x => String(x.id) === String(id)) || null;
}

function renderBalanceEditors() {
  const assetsBox = $("assetsBox");
  const liabBox = $("liabBox");
  if (!assetsBox || !liabBox) return;

  const ym = currentYM();
  const bs = getBalance(ym);

  function renderGroup(title, groupKey, items) {
    const rows = (items || []).map(it => `
      <div class="row" style="gap:10px;align-items:center;margin:6px 0;">
        <input data-bname="${esc(groupKey)}:${esc(it.id)}" value="${esc(it.name)}" placeholder="İsim (örn: Akbank)" style="flex:1;" />
        <input data-bamt="${esc(groupKey)}:${esc(it.id)}" type="number" step="0.01" value="${Number(it.amountUSD || 0)}" style="width:180px;" />
        <button class="btn danger" data-bdel="${esc(groupKey)}:${esc(it.id)}" type="button">Sil</button>
      </div>
    `).join("");

    return `
      <section class="card" style="margin:8px 0;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <h4 style="margin:0;">${esc(title)}</h4>
          <button class="btn" data-badd="${esc(groupKey)}" type="button">+ Ekle</button>
        </div>
        ${rows || `<div class="muted small" style="margin-top:8px;">(kalem yok)</div>`}
      </section>
    `;
  }

  assetsBox.innerHTML =
    renderGroup("Nakit", "assets.cash", bs.assets.cash) +
    renderGroup("Yatırımlar", "assets.investments", bs.assets.investments) +
    renderGroup("Alacaklar", "assets.receivables", bs.assets.receivables);

  liabBox.innerHTML =
    renderGroup("Krediler", "liabilities.credits", bs.liabilities.credits) +
    renderGroup("Kredi Kartları", "liabilities.cards", bs.liabilities.cards) +
    renderGroup("Diğer Borçlar", "liabilities.debts", bs.liabilities.debts);

  document.querySelectorAll("[data-badd]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-badd");
      const bs2 = getBalance(ym);
      const it = { id: uid(), name: "Yeni Kalem", amountUSD: 0 };
      pushBalanceItem(bs2, key, it);
      setBalance(ym, bs2);
      render();
    });
  });

  document.querySelectorAll("[data-bdel]").forEach(btn => {
    btn.addEventListener("click", () => {
      const token = btn.getAttribute("data-bdel");
      const [key, id] = token.split(":");
      const bs2 = getBalance(ym);
      deleteBalanceItem(bs2, key, id);
      setBalance(ym, bs2);
      render();
    });
  });

  document.querySelectorAll("[data-bname]").forEach(inp => {
    inp.addEventListener("change", () => {
      const token = inp.getAttribute("data-bname");
      const [key, id] = token.split(":");
      const bs2 = getBalance(ym);
      const it = findBalanceItem(bs2, key, id);
      if (!it) return;
      it.name = inp.value.trim();
      setBalance(ym, bs2);
      renderTxCategorySelect();
      render();
    });
  });

  document.querySelectorAll("[data-bamt]").forEach(inp => {
    inp.addEventListener("change", () => {
      const token = inp.getAttribute("data-bamt");
      const [key, id] = token.split(":");
      const bs2 = getBalance(ym);
      const it = findBalanceItem(bs2, key, id);
      if (!it) return;
      it.amountUSD = Number(inp.value || 0);
      setBalance(ym, bs2);
      render();
    });
  });
}

/* -------------------------
   Plan
------------------------- */
function renderBalancePlan() {
  const ym = currentYM();
  const bs = getBalance(ym);
  if ($("planAssets")) $("planAssets").value = Number(bs.plan.assets || 0);
  if ($("planLiab")) $("planLiab").value = Number(bs.plan.liab || 0);
  if ($("planEquity")) $("planEquity").value = Number(bs.plan.equity || 0);
}

function wireBalancePlanSave() {
  $("btnSavePlan")?.addEventListener("click", () => {
    const ym = currentYM();
    const bs = getBalance(ym);
    bs.plan.assets = Number($("planAssets")?.value || 0);
    bs.plan.liab = Number($("planLiab")?.value || 0);
    bs.plan.equity = Number($("planEquity")?.value || 0);
    setBalance(ym, bs);
    render();
  });
}

/* -------------------------
   Copy previous month
------------------------- */
function prevYM(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function wireCopyPrevMonth() {
  $("btnCopyPrevMonth")?.addEventListener("click", () => {
    const ym = currentYM();
    const prev = prevYM(ym);

    const d = loadData();
    const cur = d.balanceSheets?.[ym];
    const hasAny =
      cur && (cur.assets?.cash?.length || cur.assets?.investments?.length || cur.assets?.receivables?.length ||
      cur.liabilities?.credits?.length || cur.liabilities?.cards?.length || cur.liabilities?.debts?.length);

    if (hasAny) {
      const ok = confirm("Bu ayın bilançosu dolu görünüyor. Üzerine yazılsın mı?");
      if (!ok) return;
    }

    const prevBsRaw = d.balanceSheets?.[prev];
    if (!prevBsRaw) {
      alert("Önceki ayda ( " + prev + " ) bilanço kaydı yok.");
      return;
    }

    const prevBs = normalizeBalanceSheet(prevBsRaw);
    const cloneItems = (arr) => (arr || []).map(it => ({ id: uid(), name: it.name, amountUSD: Number(it.amountUSD || 0) }));

    const newBs = {
      plan: { ...prevBs.plan },
      assets: {
        cash: cloneItems(prevBs.assets.cash),
        investments: cloneItems(prevBs.assets.investments),
        receivables: cloneItems(prevBs.assets.receivables),
      },
      liabilities: {
        credits: cloneItems(prevBs.liabilities.credits),
        cards: cloneItems(prevBs.liabilities.cards),
        debts: cloneItems(prevBs.liabilities.debts),
      }
    };

    d.balanceSheets[ym] = newBs;
    saveData(d);
    render();
    alert("Kopyalandı: " + prev + " → " + ym);
  });
}

/* -------------------------
   Balance automation
------------------------- */
function applyBalanceAutomation(data, tx) {
  try {
    const cat = categoryById(tx.categoryId);
    const catName = normalizeName(cat?.name);
    if (!catName) return;

    const ym = ymFromDate(tx.date);
    data.balanceSheets = data.balanceSheets || {};
    const bs = normalizeBalanceSheet(data.balanceSheets[ym]);

    // liabilities match?
    const liabKeys = ["credits", "cards", "debts"];
    let matchedLiab = null;

    for (const k of liabKeys) {
      const arr = bs.liabilities[k] || [];
      const found = arr.find(it => normalizeName(it.name) === catName);
      if (found) { matchedLiab = found; break; }
    }

    if (matchedLiab) {
      const v = Number(matchedLiab.amountUSD || 0);
      matchedLiab.amountUSD = Math.max(0, v - Number(tx.amountUSD || 0));

      const invArr = bs.assets.investments || [];
      let inv = invArr.find(it => normalizeName(it.name) === catName);
      if (!inv) {
        inv = { id: uid(), name: cat?.name || "Yatırım", amountUSD: 0 };
        invArr.push(inv);
        bs.assets.investments = invArr;
      }
      inv.amountUSD = Number(inv.amountUSD || 0) + Number(tx.amountUSD || 0);

      data.balanceSheets[ym] = bs;
      return;
    }

    // assets match?
    const assetKeys = ["cash", "investments", "receivables"];
    for (const k of assetKeys) {
      const arr = bs.assets[k] || [];
      const found = arr.find(it => normalizeName(it.name) === catName);
      if (found) {
        found.amountUSD = Number(found.amountUSD || 0) + Number(tx.amountUSD || 0);
        data.balanceSheets[ym] = bs;
        return;
      }
    }

    // none
    data.balanceSheets[ym] = bs;
  } catch (e) {
    console.warn("Automation skipped:", e);
  }
}

/* -------------------------
   Monthly summary
------------------------- */
function getPlanSum(ym, type) {
  const d = loadData();
  const list = type === "income" ? d.categories.income : d.categories.expense;
  return list.reduce((s, c) => s + getCatPlanUSD(c, ym), 0);
}

function calcMonthlySummary(ym) {
  const d = loadData();
  const tx = d.transactions.filter(t => ymFromDate(t.date) === ym);

  const incomeTx = tx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amountUSD || 0), 0);
  const expenseTx = tx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amountUSD || 0), 0);

  const planIncome = getPlanSum(ym, "income");
  const planExpense = getPlanSum(ym, "expense");

  return {
    planIncome, planExpense,
    incomeTx, expenseTx,
    netPlan: planIncome - planExpense,
    netActual: incomeTx - expenseTx
  };
}

function renderMonthlySummary() {
  const box = $("monthlySummary");
  if (!box) return;
  const ym = currentYM();
  const s = calcMonthlySummary(ym);
  box.textContent =
    `Ay: ${ym}\n\n` +
    `Plan Gelir:      ${fmtUSD(s.planIncome)}\n` +
    `Gerçek Gelir:    ${fmtUSD(s.incomeTx)}\n\n` +
    `Plan Gider:      ${fmtUSD(s.planExpense)}\n` +
    `Gerçek Gider:    ${fmtUSD(s.expenseTx)}\n\n` +
    `Net (Plan):      ${fmtUSD(s.netPlan)}\n` +
    `Net (Gerçek):    ${fmtUSD(s.netActual)}`;
}

/* -------------------------
   Trend (Plan vs Actual Equity) - Canvas
------------------------- */
function parseYM(s) {
  const m = String(s || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split("-").map(Number);
  if (mo < 1 || mo > 12) return null;
  return `${y}-${pad2(mo)}`;
}

function ymRange(fromYM, toYM) {
  const out = [];
  const [fy, fm] = fromYM.split("-").map(Number);
  const [ty, tm] = toYM.split("-").map(Number);
  let d = new Date(fy, fm - 1, 1);
  const end = new Date(ty, tm - 1, 1);
  while (d <= end) {
    out.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function drawTrend(canvas, pointsActual, pointsPlan, labels) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const ml = 52, mr = 18, mt = 18, mb = 32;

  const vals = [...pointsActual, ...pointsPlan].filter(v => isFinite(v));
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = (max - min) || 1;

  function x(i) {
    if (labels.length <= 1) return ml;
    return ml + (i * (w - ml - mr)) / (labels.length - 1);
  }
  function y(v) {
    return mt + (max - v) * (h - mt - mb) / span;
  }

  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ml, mt);
  ctx.lineTo(ml, h - mb);
  ctx.lineTo(w - mr, h - mb);
  ctx.stroke();

  for (let i = 0; i <= 5; i++) {
    const vv = min + (span * i) / 5;
    const yy = y(vv);
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.moveTo(ml, yy);
    ctx.lineTo(w - mr, yy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(String(Math.round(vv)), 6, yy + 3);
  }

  function drawLine(arr, dash) {
    ctx.setLineDash(dash ? [6, 5] : []);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    arr.forEach((v, i) => {
      const xx = x(i);
      const yy = y(v);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.lineWidth = 2;
  drawLine(pointsActual, false);

  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  drawLine(pointsPlan, true);

  ctx.globalAlpha = 1;
  pointsActual.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
    ctx.fill();
  });

  const step = Math.ceil(labels.length / 8);
  labels.forEach((lab, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    ctx.fillText(lab, x(i) - 18, h - 10);
  });

  ctx.globalAlpha = 1;
  ctx.fillText("Actual Equity (solid)", ml + 10, 14);
  ctx.fillText("Plan Equity (dashed)", ml + 180, 14);
}

function wireTrend() {
  $("btnTrend")?.addEventListener("click", () => {
    const from = parseYM($("trendFrom")?.value);
    const to = parseYM($("trendTo")?.value);
    if (!from || !to) {
      alert("Trend için YYYY-MM formatında tarih gir (örn: 2026-01).");
      return;
    }
    const months = ymRange(from, to);
    const d = loadData();

    const actual = [];
    const plan = [];
    const lines = [];

    months.forEach(ym => {
      const bs = normalizeBalanceSheet(d.balanceSheets?.[ym]);
      const totals = calcBalanceTotals(bs);
      actual.push(totals.equity);
      plan.push(Number(bs.plan?.equity || 0));
      lines.push(`${ym} | Actual ${fmtNum(totals.equity)} | Plan ${fmtNum(Number(bs.plan?.equity || 0))}`);
    });

    const canvas = $("trendCanvas");
    if (canvas) drawTrend(canvas, actual, plan, months);
    const txt = $("trendText");
    if (txt) txt.textContent = lines.join("\n");
  });
}

/* -------------------------
   Backup / Restore
------------------------- */
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

function wireBackupRestore() {
  $("btnExport")?.addEventListener("click", () => {
    const d = loadData();
    const today = new Date().toISOString().slice(0, 10);
    downloadJson(`butce-yedek-${today}.json`, d);
  });

  $("fileImport")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      const d = migrateIfNeeded(parsed);
      saveData(d);
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
}

/* -------------------------
   Status
------------------------- */
function setStatus() {
  const el = $("status");
  if (!el) return;

  const d = loadData();
  const ym = currentYM();
  const bs = normalizeBalanceSheet(d.balanceSheets?.[ym]);
  const totals = calcBalanceTotals(bs);

  el.textContent = [
    `YM: ${ym}`,
    `Kategoriler: gelir ${d.categories.income.length}, gider ${d.categories.expense.length}`,
    `İşlem: ${d.transactions.length}`,
    `Equity: ${fmtNum(totals.equity)}`
  ].join("\n");
}

/* -------------------------
   Wire everything
------------------------- */
function wireEvents() {
  console.log("app.js wireEvents çalıştı");

  wireTabs();
  ensureYearMonthSelectors();
  wireTxForm();
  wireBalancePlanSave();
  wireCopyPrevMonth();
  wireTrend();
  wireBackupRestore();

  console.log("app.js wireEvents tamamlandı (login butonları hariç)");
}

/* -------------------------
   Render
------------------------- */
function render() {
  ensureDefaultCategoriesIfEmpty();

  ensureYearMonthSelectors();
  renderTxCategorySelect();

  renderCategories();
  renderRates();

  renderMonthlySummary();
  renderTxList();

  renderBalancePlan();
  renderBalanceEditors();
  renderBalanceSummary();

  setStatus();
}

window.render = render;

// boot
document.addEventListener("DOMContentLoaded", () => {
  console.log("app.js DOMContentLoaded");
  wireEvents();
  render();
});
