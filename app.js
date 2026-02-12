/* app.js - Budget Pro v2
   - Arkadaş UI mantığı: tabs + fab + modal
   - Plan kur: aylık tahmin (USD->TRY, USD->RUB)
   - İşlem kur: işlem anında çekilir, USD kilitlenir (sonradan değişmez)
   - Bilanço: alt kalemler + isim eşleşince otomasyon
   - Grafik: Assets / Liabilities / Equity (aylık)
*/

const STORAGE_KEY = "butce_data_v2";
const CURRENCIES = ["USD","TRY","RUB"];

let currentTxType = "income"; // income/expense
let currentTab = "budget";
let selectedYM = ""; // YYYY-MM
let _balanceChart = null;

// Balance item modal state
let balModalSide = null;   // 'asset' | 'liab'
let balModalGroup = null;  // cash/invest/recv or loan/card/other

// ----------------------- Data model -----------------------
function defaultData() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,"0");
  const ym = `${y}-${m}`;

  return {
    version: 2,
    app: {
      baseCurrency: "USD",
      createdAt: Date.now(),
    },
    // plan categories
    categories: {
      income: [],  // {id,name,currency,yearly,months:{'YYYY-MM':amount}}
      expense: [],
      nextId: 1
    },
    // plan monthly rates: for each ym -> {TRY: number (1 USD = ? TRY), RUB: number}
    planRates: {
      [ym]: { TRY: null, RUB: null }
    },
    // transactions: {id,date,ym,type,currency,amountOriginal,usdLocked,rateUsed,note,categoryName}
    transactions: [],
    // balance snapshots per month:
    // balance[ym] = { assets:{cash:[],invest:[],recv:[]}, liab:{loan:[],card:[],other:[]} }
    // each item: {id,name,currency,amountOriginal,usdLocked,rateUsed,note}
    balance: {},
    balanceNextId: 1
  };
}

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData();
  try {
    const d = JSON.parse(raw);
    return migrate(d);
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

window.saveData = saveData; // firebase.js override için

function migrate(d) {
  const base = defaultData();
  const out = { ...base, ...d };
  out.app = { ...base.app, ...(d.app||{}) };

  // categories
  out.categories = d.categories || base.categories;
  if (!out.categories.nextId) out.categories.nextId = 1;

  // planRates
  out.planRates = d.planRates || base.planRates;

  // transactions
  out.transactions = Array.isArray(d.transactions) ? d.transactions : [];

  // balance
  out.balance = d.balance || {};
  out.balanceNextId = d.balanceNextId || 1;

  return out;
}

// ----------------------- Helpers -----------------------
function $(id){ return document.getElementById(id); }
function fmtUSD(n){ return `$${Number(n||0).toFixed(0)}`; }
function fmtUSD2(n){ return `$${Number(n||0).toFixed(2)}`; }
function toISODate(d){
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,"0");
  const day = String(x.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function ymFromDate(iso){
  const [y,m] = iso.split("-");
  return `${y}-${m}`;
}
function todayISO(){ return toISODate(new Date()); }

function ensureSelectedYM(data){
  if (selectedYM) return;
  // seçili ay yoksa: bugün
  selectedYM = ymFromDate(todayISO());

  // planRates yoksa oluştur
  if (!data.planRates[selectedYM]) data.planRates[selectedYM] = { TRY:null, RUB:null };
}

// ----------------------- Tabs -----------------------
function wireTabs(){
  document.querySelectorAll(".tab").forEach(t=>{
    t.addEventListener("click", ()=>{
      const tab = t.getAttribute("data-tab");
      setTab(tab);
    });
  });
}
function setTab(tab){
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelector(`.tab[data-tab="${tab}"]`)?.classList.add("active");

  ["budget","transactions","balance"].forEach(k=>{
    $(`${k}-section`).classList.remove("active");
  });
  $(`${tab}-section`).classList.add("active");

  render();
}

// ----------------------- Modals -----------------------
function openModal(id){ $(id).classList.add("active"); }
function closeModal(id){ $(id).classList.remove("active"); }
window.closeModal = closeModal;

function openCategoryModal(type){
  const data = loadData();
  ensureSelectedYM(data);

  window._catType = type;
  $("catModalTitle").textContent = type === "income" ? "Gelir Kategorisi" : "Gider Kategorisi";
  $("catName").value = "";
  $("catCurrency").value = "USD";
  $("catYearly").value = "";
  openModal("categoryModal");
}
window.openCategoryModal = openCategoryModal;

function openTransactionModal(){
  const data = loadData();
  ensureSelectedYM(data);

  // default date
  $("txDate").value = todayISO();
  $("txCurrency").value = "USD";
  $("txAmount").value = "";
  $("txNote").value = "";

  // fill categories
  fillTxCategorySelect(currentTxType);
  $("txInfo").textContent = "İşlem girildiği an kur çekilir ve USD değeri kilitlenir.";
  openModal("transactionModal");
}
window.openTransactionModal = openTransactionModal;

function setTransactionType(t){
  currentTxType = t;
  document.querySelectorAll(".type-btn").forEach(b=>b.classList.remove("active"));
  if (t==="income") document.querySelector(".type-btn.income")?.classList.add("active");
  if (t==="expense") document.querySelector(".type-btn.expense")?.classList.add("active");
  fillTxCategorySelect(t);
}
window.setTransactionType = setTransactionType;

// Balance item modal
function openBalItemModal(side, group){
  balModalSide = side;
  balModalGroup = group;

  const sideName = side==="asset" ? "Varlık" : "Borç";
  const groupNameMap = {
    cash:"Nakit", invest:"Yatırımlar", recv:"Alacaklar",
    loan:"Krediler", card:"Kredi Kartı", other:"Diğer Borçlar"
  };
  $("balItemTitle").textContent = `${sideName} Kalemi Ekle • ${groupNameMap[group]||""}`;

  $("balItemName").value = "";
  $("balItemCurrency").value = "USD";
  $("balItemAmount").value = "";
  $("balItemNote").value = "";
  openModal("balItemModal");
}
window.openBalItemModal = openBalItemModal;

// ----------------------- Rates (Plan) -----------------------
function renderRatesCard(data){
  ensureSelectedYM(data);
  const r = data.planRates[selectedYM] || {TRY:null,RUB:null};
  const t = (r.TRY==null) ? "—" : String(r.TRY);
  const ru = (r.RUB==null) ? "—" : String(r.RUB);

  $("ratesCard").innerHTML =
    `<div><b>Seçili Ay:</b> ${selectedYM}</div>
     <div style="margin-top:6px;">
       <div><b>1 USD =</b> <span>${t}</span> <b>TRY</b></div>
       <div><b>1 USD =</b> <span>${ru}</span> <b>RUB</b></div>
     </div>
     <div class="muted small" style="margin-top:8px;">
       Plan hesapları bu aylık tahmin kurlarla USD’ye çevrilir.
     </div>`;
}

function promptEditRates(){
  const data = loadData();
  ensureSelectedYM(data);
  const r = data.planRates[selectedYM] || {TRY:null,RUB:null};

  const tryVal = prompt(`${selectedYM} için 1 USD = ? TRY (plan tahmini)`, r.TRY ?? "");
  if (tryVal === null) return;
  const rubVal = prompt(`${selectedYM} için 1 USD = ? RUB (plan tahmini)`, r.RUB ?? "");
  if (rubVal === null) return;

  const nTRY = tryVal.trim()==="" ? null : Number(tryVal);
  const nRUB = rubVal.trim()==="" ? null : Number(rubVal);

  data.planRates[selectedYM] = {
    TRY: (nTRY==null || !isFinite(nTRY) || nTRY<=0) ? null : nTRY,
    RUB: (nRUB==null || !isFinite(nRUB) || nRUB<=0) ? null : nRUB
  };
  saveData(data);
  render();
}

// ----------------------- Fetch FX (Actual) -----------------------
async function fetchUsdPerUnit(currency, dateISO){
  // returns USD per 1 unit of currency (USD=1, TRY->USD, RUB->USD)
  if (!currency || currency==="USD") return 1;

  // frankfurter doesn't support RUB sometimes. We'll use ER API first for reliability.
  // ER API gives USD->CURRENCY.
  const url = "https://open.er-api.com/v6/latest/USD";
  const r = await fetch(url, { cache:"no-store" });
  if (!r.ok) throw new Error("Kur çekilemedi (ER API).");
  const j = await r.json();
  const perUSD = Number(j?.rates?.[currency]); // 1 USD = perUSD currency
  if (!perUSD || !isFinite(perUSD)) throw new Error(`Kur yok: ${currency}`);
  return 1 / perUSD; // 1 currency = ? USD
}

async function toUsdLocked(amount, currency){
  const usdPerUnit = await fetchUsdPerUnit(currency);
  const usd = Number(amount) * usdPerUnit;
  return { usdLocked: usd, rateUsed: usdPerUnit };
}

// ----------------------- Categories (Plan) -----------------------
function addCategory(type, name, currency, yearly){
  const data = loadData();
  ensureSelectedYM(data);

  const id = data.categories.nextId++;
  const cat = {
    id,
    type,
    name: name.trim(),
    currency,
    yearly: Number(yearly || 0),
    months: {} // 'YYYY-MM' -> amount in original currency
  };

  // default: yearly/12 into selected month? (and other months blank)
  // We keep month blank; user can plan later, but we’ll seed selected month as yearly/12.
  if (cat.yearly > 0) {
    cat.months[selectedYM] = cat.yearly / 12;
  }

  data.categories[type].push(cat);
  saveData(data);
}

function deleteCategory(type, id){
  const data = loadData();
  data.categories[type] = data.categories[type].filter(c=>c.id!==id);
  saveData(data);
}

function renderBudgetLists(data){
  const inBox = $("incomeBudgets");
  const exBox = $("expenseBudgets");
  inBox.innerHTML = "";
  exBox.innerHTML = "";

  const renderOne = (cat, type) => {
    const monthAmt = Number(cat.months?.[selectedYM] || 0);
    const planUSD = planToUSD(data, monthAmt, cat.currency, selectedYM);

    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="row">
        <div>
          <div style="font-weight:900">${escapeHtml(cat.name)}</div>
          <div class="muted small">Plan: ${monthAmt.toFixed(2)} ${cat.currency} → ${fmtUSD2(planUSD)}</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button class="pill" style="cursor:pointer" data-edit="${cat.id}" data-type="${type}">Düzenle</button>
          <button class="pill" style="cursor:pointer;color:var(--expense)" data-del="${cat.id}" data-type="${type}">Sil</button>
        </div>
      </div>
    `;
    div.querySelector("[data-edit]")?.addEventListener("click", ()=>{
      const val = prompt(`${cat.name} (${selectedYM}) plan (${cat.currency})`, String(monthAmt));
      if (val===null) return;
      const n = Number(val);
      if (!isFinite(n) || n<0) return alert("Geçersiz sayı");
      const d2 = loadData();
      const arr = d2.categories[type];
      const ref = arr.find(x=>x.id===cat.id);
      if (!ref) return;
      ref.months[selectedYM] = n;
      saveData(d2);
      render();
    });
    div.querySelector("[data-del]")?.addEventListener("click", ()=>{
      if (!confirm("Silinsin mi?")) return;
      deleteCategory(type, cat.id);
      render();
    });
    return div;
  };

  data.categories.income.forEach(cat=> inBox.appendChild(renderOne(cat,"income")));
  data.categories.expense.forEach(cat=> exBox.appendChild(renderOne(cat,"expense")));
}

function planToUSD(data, amt, currency, ym){
  if (!amt) return 0;
  if (currency==="USD") return Number(amt);

  const r = data.planRates[ym] || {};
  const perUSD = r[currency]; // 1 USD = ? currency (plan)
  if (!perUSD || !isFinite(perUSD) || perUSD<=0) return 0;
  // amt currency -> USD
  return Number(amt) / perUSD;
}

function fillTxCategorySelect(type){
  const data = loadData();
  const sel = $("txCategory");
  if (!sel) return;
  const list = data.categories[type] || [];
  sel.innerHTML = "";
  list.forEach(c=>{
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  if (!list.length){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(Önce bütçeden kategori ekle)";
    sel.appendChild(opt);
  }
}

// ----------------------- Transactions (Actual) -----------------------
async function addTransaction(){
  const date = $("txDate").value || todayISO();
  const ym = ymFromDate(date);
  const currency = $("txCurrency").value;
  const amount = Number($("txAmount").value);
  const note = $("txNote").value || "";
  const categoryName = $("txCategory").value || "";

  if (!amount || amount<=0 || !isFinite(amount)) {
    alert("Tutar gir (0'dan büyük).");
    return;
  }
  if (!categoryName) {
    alert("Kategori seç (bütçeden kategori ekle).");
    return;
  }

  $("btnAddTx").disabled = true;
  $("txInfo").textContent = "Kur çekiliyor...";

  try {
    const { usdLocked, rateUsed } = await toUsdLocked(amount, currency);

    const data = loadData();
    // planRates ensure
    if (!data.planRates[ym]) data.planRates[ym] = { TRY:null, RUB:null };

    const tx = {
      id: crypto.randomUUID(),
      date,
      ym,
      type: currentTxType, // income/expense
      currency,
      amountOriginal: amount,
      usdLocked,
      rateUsed, // USD per 1 unit currency
      note,
      categoryName
    };

    data.transactions.push(tx);

    // otomasyon: bu işlem bilanço ile eşleşiyor mu?
    applyAutomationFromTx(data, tx);

    saveData(data);
    closeModal("transactionModal");
    render();
  } catch (e) {
    console.error(e);
    alert("Kur çekilemedi. İnternet/servis kontrol et.\n" + (e?.message||e));
  } finally {
    $("btnAddTx").disabled = false;
    $("txInfo").textContent = "İşlem girildiği an kur çekilir ve USD değeri kilitlenir.";
  }
}

function applyAutomationFromTx(data, tx){
  const ym = tx.ym;
  ensureBalanceMonth(data, ym);

  // borçlarda aynı isimli kalem var mı?
  const liabItem = findBalanceItemByName(data.balance[ym].liab, tx.categoryName);
  if (liabItem) {
    // gider ise borç düşür (income olursa borç artması gibi bir mantık yok, dokunma)
    if (tx.type === "expense") {
      // borç düşer => usdLocked azalt
      liabItem.usdLocked = Math.max(0, Number(liabItem.usdLocked||0) - Number(tx.usdLocked||0));
      // originalAmount'ı da aynı para biriminde düşürmek karmaşık; biz USD kilit üzerinden gidiyoruz.
      // not: kullanıcı zaten "USD baz" demişti.
    }
  }

  // varlıklarda aynı isimli kalem var mı?
  const assetItem = findBalanceItemByName(data.balance[ym].assets, tx.categoryName);
  if (assetItem) {
    // borç ödemesi ile varlık artışı isteniyor (senin kuralın)
    if (tx.type === "expense") {
      assetItem.usdLocked = Number(assetItem.usdLocked||0) + Number(tx.usdLocked||0);
    }
  }
  // asset yoksa → hiçbir yere yazma (senin seçimin)
}

function findBalanceItemByName(groupsObj, name){
  const key = norm(name);
  const groups = Object.values(groupsObj);
  for (const arr of groups) {
    const it = arr.find(x => norm(x.name) === key);
    if (it) return it;
  }
  return null;
}

// ----------------------- Balance -----------------------
function ensureBalanceMonth(data, ym){
  if (!data.balance[ym]) {
    data.balance[ym] = {
      assets: { cash:[], invest:[], recv:[] },
      liab: { loan:[], card:[], other:[] }
    };
  }
}

function addBalanceItem(){
  const data = loadData();
  ensureSelectedYM(data);
  const ym = selectedYM;
  ensureBalanceMonth(data, ym);

  const name = $("balItemName").value.trim();
  const currency = $("balItemCurrency").value;
  const amount = Number($("balItemAmount").value);
  const note = $("balItemNote").value || "";

  if (!name) return alert("Kategori adı gir.");
  if (!amount || amount<=0 || !isFinite(amount)) return alert("Tutar gir (0'dan büyük).");

  // USD kilit: bilanço kalemi de giriş anı kur ile kilitlenir
  $("btnSaveBalItem").disabled = true;

  toUsdLocked(amount, currency).then(({usdLocked, rateUsed})=>{
    const item = {
      id: data.balanceNextId++,
      name,
      currency,
      amountOriginal: amount,
      usdLocked,
      rateUsed,
      note
    };

    if (balModalSide==="asset") {
      data.balance[ym].assets[balModalGroup].push(item);
    } else {
      data.balance[ym].liab[balModalGroup].push(item);
    }

    saveData(data);
    closeModal("balItemModal");
    render();
  }).catch(e=>{
    console.error(e);
    alert("Kur çekilemedi. İnternet/servis kontrol et.");
  }).finally(()=>{
    $("btnSaveBalItem").disabled = false;
  });
}

function deleteBalanceItem(side, group, id){
  const data = loadData();
  ensureSelectedYM(data);
  const ym = selectedYM;
  ensureBalanceMonth(data, ym);

  if (side==="asset") {
    data.balance[ym].assets[group] = data.balance[ym].assets[group].filter(x=>x.id!==id);
  } else {
    data.balance[ym].liab[group] = data.balance[ym].liab[group].filter(x=>x.id!==id);
  }
  saveData(data);
}

function sumBalanceMonth(data, ym){
  ensureBalanceMonth(data, ym);
  const b = data.balance[ym];
  const assets = Object.values(b.assets).flat().reduce((a,x)=>a+Number(x.usdLocked||0),0);
  const liab = Object.values(b.liab).flat().reduce((a,x)=>a+Number(x.usdLocked||0),0);
  const eq = assets - liab;
  return { assets, liab, eq };
}

function renderBalanceLists(data){
  ensureSelectedYM(data);
  const ym = selectedYM;
  ensureBalanceMonth(data, ym);

  const bindGroup = (side, group, elId, arr) => {
    const box = $(elId);
    box.innerHTML = "";
    arr.forEach(item=>{
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div>
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-note">${escapeHtml(item.note||"")}</div>
        </div>
        <div class="item-right">
          <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
            <div>
              <div class="item-amt">${Number(item.amountOriginal||0).toFixed(2)} ${item.currency}</div>
              <div class="item-usd">${fmtUSD2(item.usdLocked)} (kilit)</div>
            </div>
            <button class="item-del" title="Sil"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `;
      div.querySelector(".item-del")?.addEventListener("click", ()=>{
        if (!confirm("Silinsin mi?")) return;
        deleteBalanceItem(side, group, item.id);
        render();
      });
      box.appendChild(div);
    });
  };

  const b = data.balance[ym];
  bindGroup("asset","cash","asset-cash", b.assets.cash);
  bindGroup("asset","invest","asset-invest", b.assets.invest);
  bindGroup("asset","recv","asset-recv", b.assets.recv);

  bindGroup("liab","loan","liab-loan", b.liab.loan);
  bindGroup("liab","card","liab-card", b.liab.card);
  bindGroup("liab","other","liab-other", b.liab.other);
}

// ----------------------- Month filters -----------------------
function buildMonthList(data){
  // months from transactions, planRates, balance + include last 12
  const set = new Set();

  Object.keys(data.planRates||{}).forEach(k=>set.add(k));
  (data.transactions||[]).forEach(t=>set.add(t.ym));
  Object.keys(data.balance||{}).forEach(k=>set.add(k));

  // add last 12 months
  const now = new Date();
  for (let i=0;i<12;i++){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    set.add(ym);
  }

  return Array.from(set).sort();
}

function renderMonthFilters(data){
  const months = buildMonthList(data);
  if (!selectedYM) selectedYM = months[months.length-1] || ymFromDate(todayISO());

  const mk = (containerId) => {
    const box = $(containerId);
    box.innerHTML = "";
    months.forEach(ym=>{
      const b = document.createElement("button");
      b.className = "pill" + (ym===selectedYM ? " active": "");
      b.textContent = ym;
      b.addEventListener("click", ()=>{
        selectedYM = ym;
        // ensure planRates exist
        if (!data.planRates[selectedYM]) {
          const d2 = loadData();
          d2.planRates[selectedYM] = { TRY:null, RUB:null };
          saveData(d2);
        }
        render();
      });
      box.appendChild(b);
    });
  };

  mk("monthFilter");
  mk("balMonthFilter");
}

// ----------------------- Render Transactions list -----------------------
function renderTransactions(data){
  const list = $("transactionsList");
  list.innerHTML = "";

  const tx = data.transactions
    .filter(t=>t.ym===selectedYM)
    .sort((a,b)=> (a.date>b.date? -1: 1));

  if (!tx.length) {
    const empty = document.createElement("div");
    empty.className = "card muted";
    empty.textContent = "Bu ay işlem yok.";
    list.appendChild(empty);
    return;
  }

  tx.forEach(t=>{
    const div = document.createElement("div");
    div.className = "card";
    const sign = (t.type==="expense") ? "-" : "+";
    const color = (t.type==="expense") ? "var(--expense)" : "var(--income)";
    div.innerHTML = `
      <div class="row">
        <div>
          <div style="font-weight:900">${escapeHtml(t.categoryName)}</div>
          <div class="muted small">${t.date} • ${escapeHtml(t.note||"")}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:900;color:${color}">${sign}${Number(t.amountOriginal).toFixed(2)} ${t.currency}</div>
          <div class="muted small">${fmtUSD2(t.usdLocked)} (kilit)</div>
        </div>
      </div>
    `;
    list.appendChild(div);
  });
}

// ----------------------- Summary (Plan vs Actual for selected month) -----------------------
function calcMonthlySummary(data, ym){
  // Plan: categories months -> USD using planRates
  const planIncome = data.categories.income.reduce((a,c)=>a + planToUSD(data, Number(c.months?.[ym]||0), c.currency, ym), 0);
  const planExpense = data.categories.expense.reduce((a,c)=>a + planToUSD(data, Number(c.months?.[ym]||0), c.currency, ym), 0);

  // Actual: transactions usdLocked
  const actualIncome = data.transactions.filter(t=>t.ym===ym && t.type==="income").reduce((a,t)=>a+Number(t.usdLocked||0),0);
  const actualExpense = data.transactions.filter(t=>t.ym===ym && t.type==="expense").reduce((a,t)=>a+Number(t.usdLocked||0),0);

  return {
    planIncome, planExpense,
    actualIncome, actualExpense,
    planNet: planIncome - planExpense,
    actualNet: actualIncome - actualExpense
  };
}

function renderTopSummary(data){
  const s = calcMonthlySummary(data, selectedYM);

  $("sumIncome").textContent = fmtUSD(s.actualIncome);
  $("sumIncomeSub").textContent = `Plan ${fmtUSD(s.planIncome)} / Gerçek ${fmtUSD(s.actualIncome)}`;

  $("sumExpense").textContent = fmtUSD(s.actualExpense);
  $("sumExpenseSub").textContent = `Plan ${fmtUSD(s.planExpense)} / Gerçek ${fmtUSD(s.actualExpense)}`;

  $("sumNet").textContent = fmtUSD(s.actualNet);
  $("sumNetSub").textContent = `Plan ${fmtUSD(s.planNet)} / Gerçek ${fmtUSD(s.actualNet)}`;

  $("headerSubtitle").textContent = `${selectedYM} • USD baz`;
}

// ----------------------- Balance KPI + Chart -----------------------
function renderBalanceKPIAndChart(data){
  ensureSelectedYM(data);

  // KPI (selectedYM)
  const s = sumBalanceMonth(data, selectedYM);
  $("balAssets").textContent = fmtUSD(s.assets);
  $("balLiab").textContent = fmtUSD(s.liab);
  $("balEquity").textContent = fmtUSD(s.eq);

  // chart (monthly trend)
  const months = buildMonthList(data);
  const labels = months;
  const assets = months.map(ym=> sumBalanceMonth(data, ym).assets);
  const liab = months.map(ym=> sumBalanceMonth(data, ym).liab);
  const eq = months.map(ym=> sumBalanceMonth(data, ym).eq);

  const ctx = $("balanceChart");
  if (!ctx) return;

  if (_balanceChart) {
    _balanceChart.data.labels = labels;
    _balanceChart.data.datasets[0].data = assets;
    _balanceChart.data.datasets[1].data = liab;
    _balanceChart.data.datasets[2].data = eq;
    _balanceChart.update();
    return;
  }

  _balanceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Varlıklar", data: assets, tension: 0.25 },
        { label: "Borçlar", data: liab, tension: 0.25 },
        { label: "Öz Sermaye", data: eq, tension: 0.25 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: {
        y: { ticks: { callback: (v)=> `$${v}` } }
      }
    }
  });

  // chart canvas height fix
  ctx.parentElement.style.height = "260px";
}

// ----------------------- Install banner -----------------------
function hideInstallBanner(){
  $("installBanner").style.display = "none";
  localStorage.setItem("installBannerHidden","1");
}
window.hideInstallBanner = hideInstallBanner;

function maybeShowInstallBanner(){
  // only iOS Safari and not dismissed
  if (localStorage.getItem("installBannerHidden")==="1") return;
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isIOS) return;
  // show once
  $("installBanner").style.display = "block";
}

// ----------------------- Escape / normalize -----------------------
function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function norm(s){
  return String(s||"").trim().toLowerCase();
}

// ----------------------- Events -----------------------
function wireEvents(){
  wireTabs();

  $("btnSaveCategory").addEventListener("click", ()=>{
    const type = window._catType || "income";
    const name = $("catName").value.trim();
    const currency = $("catCurrency").value;
    const yearly = $("catYearly").value;

    if (!name) return alert("Kategori adı gir.");
    addCategory(type, name, currency, yearly);
    closeModal("categoryModal");
    render();
  });

  $("btnAddTx").addEventListener("click", addTransaction);

  $("btnSaveBalItem").addEventListener("click", addBalanceItem);

  $("btnRatesEdit").addEventListener("click", promptEditRates);
}

// ----------------------- Main render -----------------------
function render(){
  const data = loadData();
  ensureSelectedYM(data);

  // ensure planRates exists for selected
  if (!data.planRates[selectedYM]) {
    data.planRates[selectedYM] = { TRY:null, RUB:null };
    saveData(data);
  }

  // month filters
  renderMonthFilters(data);

  // budget
  renderRatesCard(data);
  renderBudgetLists(data);

  // transactions
  renderTransactions(data);

  // summary
  renderTopSummary(data);

  // balance
  ensureBalanceMonth(data, selectedYM);
  renderBalanceLists(data);
  renderBalanceKPIAndChart(data);

  // install banner
  maybeShowInstallBanner();
}

window.render = render;

// init
document.addEventListener("DOMContentLoaded", ()=>{
  // default date in tx modal
  if ($("txDate")) $("txDate").value = todayISO();
  wireEvents();
  render();
});
