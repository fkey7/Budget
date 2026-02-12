/* app.js - Budget Pro v2 (NULL-SAFE) */

const STORAGE_KEY = "butce_data_v2";
let currentTxType = "income";
let selectedYM = "";
let _balanceChart = null;

// Modal state
let balModalSide = null;
let balModalGroup = null;

function $(id){ return document.getElementById(id); }
function fmtUSD(n){ return `$${Number(n||0).toFixed(0)}`; }
function fmtUSD2(n){ return `$${Number(n||0).toFixed(2)}`; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function ymFromDate(iso){ const [y,m]=iso.split("-"); return `${y}-${m}`; }
function esc(s){ return String(s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function norm(s){ return String(s||"").trim().toLowerCase(); }

function defaultData(){
  const ym = ymFromDate(todayISO());
  return {
    version: 2,
    categories: { income: [], expense: [], nextId: 1 },
    planRates: { [ym]: { TRY:null, RUB:null } },
    transactions: [],
    balance: {},
    balanceNextId: 1
  };
}
function loadData(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return defaultData();
  try { return migrate(JSON.parse(raw)); } catch { return defaultData(); }
}
function saveData(d){ localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
window.saveData = saveData;
function migrate(d){
  const base = defaultData();
  return {
    ...base,
    ...d,
    categories: d.categories || base.categories,
    planRates: d.planRates || base.planRates,
    transactions: Array.isArray(d.transactions) ? d.transactions : [],
    balance: d.balance || {},
    balanceNextId: d.balanceNextId || 1
  };
}

function ensureSelectedYM(data){
  if(selectedYM) return;
  selectedYM = ymFromDate(todayISO());
  if(!data.planRates[selectedYM]) data.planRates[selectedYM] = {TRY:null,RUB:null};
}

function openModal(id){ const el=$(id); if(el) el.classList.add("active"); }
function closeModal(id){ const el=$(id); if(el) el.classList.remove("active"); }
window.closeModal = closeModal;

function wireTabs(){
  document.querySelectorAll(".tab").forEach(t=>{
    t.addEventListener("click", ()=>{
      const tab = t.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
      t.classList.add("active");
      ["budget","transactions","balance"].forEach(k=>{
        const sec = $(`${k}-section`);
        if(sec) sec.classList.remove("active");
      });
      const target = $(`${tab}-section`);
      if(target) target.classList.add("active");
      render();
    });
  });
}

function openCategoryModal(type){
  window._catType = type;
  const title = $("catModalTitle");
  if(title) title.textContent = type==="income" ? "Gelir Kategorisi" : "Gider Kategorisi";
  if($("catName")) $("catName").value="";
  if($("catCurrency")) $("catCurrency").value="USD";
  if($("catYearly")) $("catYearly").value="";
  openModal("categoryModal");
}
window.openCategoryModal = openCategoryModal;

function openTransactionModal(){
  if($("txDate")) $("txDate").value = todayISO();
  if($("txCurrency")) $("txCurrency").value="USD";
  if($("txAmount")) $("txAmount").value="";
  if($("txNote")) $("txNote").value="";
  fillTxCategorySelect(currentTxType);
  if($("txInfo")) $("txInfo").textContent="İşlem girildiği an kur çekilir ve USD değeri kilitlenir.";
  openModal("transactionModal");
}
window.openTransactionModal = openTransactionModal;

function setTransactionType(t){
  currentTxType = t;
  document.querySelectorAll(".type-btn").forEach(b=>b.classList.remove("active"));
  if(t==="income") document.querySelector(".type-btn.income")?.classList.add("active");
  if(t==="expense") document.querySelector(".type-btn.expense")?.classList.add("active");
  fillTxCategorySelect(t);
}
window.setTransactionType = setTransactionType;

function openBalItemModal(side, group){
  balModalSide = side;
  balModalGroup = group;
  const title = $("balItemTitle");
  if(title) title.textContent = "Kalem Ekle";
  if($("balItemName")) $("balItemName").value="";
  if($("balItemCurrency")) $("balItemCurrency").value="USD";
  if($("balItemAmount")) $("balItemAmount").value="";
  if($("balItemNote")) $("balItemNote").value="";
  openModal("balItemModal");
}
window.openBalItemModal = openBalItemModal;

function addCategory(){
  const data = loadData();
  ensureSelectedYM(data);

  const type = window._catType || "income";
  const name = ($("catName")?.value || "").trim();
  const currency = $("catCurrency")?.value || "USD";
  const yearly = Number($("catYearly")?.value || 0);

  if(!name) return alert("Kategori adı gir.");

  const id = data.categories.nextId++;
  const cat = { id, name, currency, yearly, months:{} };
  if(yearly>0) cat.months[selectedYM] = yearly/12;
  data.categories[type].push(cat);

  saveData(data);
  closeModal("categoryModal");
  render();
}

function planToUSD(data, amt, currency, ym){
  if(!amt) return 0;
  if(currency==="USD") return Number(amt);
  const r = data.planRates[ym] || {};
  const perUSD = r[currency];
  if(!perUSD || !isFinite(perUSD) || perUSD<=0) return 0;
  return Number(amt) / perUSD;
}

function renderRatesCard(data){
  const r = data.planRates[selectedYM] || {TRY:null,RUB:null};
  const t = r.TRY==null ? "—" : r.TRY;
  const ru = r.RUB==null ? "—" : r.RUB;
  const box = $("ratesCard");
  if(!box) return;
  box.innerHTML = `<div><b>${selectedYM}</b></div>
  <div style="margin-top:6px;"><b>1 USD =</b> ${t} TRY</div>
  <div><b>1 USD =</b> ${ru} RUB</div>`;
}

function promptEditRates(){
  const data = loadData();
  ensureSelectedYM(data);
  const r = data.planRates[selectedYM] || {TRY:null,RUB:null};
  const tryVal = prompt(`${selectedYM} için 1 USD = ? TRY`, r.TRY ?? "");
  if(tryVal===null) return;
  const rubVal = prompt(`${selectedYM} için 1 USD = ? RUB`, r.RUB ?? "");
  if(rubVal===null) return;

  const nTRY = tryVal.trim()==="" ? null : Number(tryVal);
  const nRUB = rubVal.trim()==="" ? null : Number(rubVal);

  data.planRates[selectedYM] = {
    TRY: (!nTRY || !isFinite(nTRY) || nTRY<=0) ? null : nTRY,
    RUB: (!nRUB || !isFinite(nRUB) || nRUB<=0) ? null : nRUB
  };
  saveData(data);
  render();
}

function renderBudgetLists(data){
  const inBox = $("incomeBudgets");
  const exBox = $("expenseBudgets");
  if(inBox) inBox.innerHTML="";
  if(exBox) exBox.innerHTML="";

  const renderOne = (cat, type) => {
    const monthAmt = Number(cat.months?.[selectedYM] || 0);
    const planUSD = planToUSD(data, monthAmt, cat.currency, selectedYM);

    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="row">
        <div>
          <div style="font-weight:900">${esc(cat.name)}</div>
          <div class="muted small">Plan: ${monthAmt.toFixed(2)} ${cat.currency} → ${fmtUSD2(planUSD)}</div>
        </div>
      </div>`;
    return div;
  };

  data.categories.income.forEach(c=> inBox?.appendChild(renderOne(c,"income")));
  data.categories.expense.forEach(c=> exBox?.appendChild(renderOne(c,"expense")));
}

function fillTxCategorySelect(type){
  const data = loadData();
  const sel = $("txCategory");
  if(!sel) return;
  sel.innerHTML="";
  const list = data.categories[type] || [];
  if(!list.length){
    const o = document.createElement("option");
    o.value=""; o.textContent="(Önce bütçeden kategori ekle)";
    sel.appendChild(o);
    return;
  }
  list.forEach(c=>{
    const o=document.createElement("option");
    o.value=c.name; o.textContent=c.name;
    sel.appendChild(o);
  });
}

async function fetchUsdPerUnit(currency){
  if(!currency || currency==="USD") return 1;
  const r = await fetch("https://open.er-api.com/v6/latest/USD", {cache:"no-store"});
  if(!r.ok) throw new Error("Kur çekilemedi.");
  const j = await r.json();
  const perUSD = Number(j?.rates?.[currency]); // 1 USD = perUSD currency
  if(!perUSD || !isFinite(perUSD)) throw new Error("Kur yok: "+currency);
  return 1/perUSD; // 1 currency = ? USD
}

async function toUsdLocked(amount, currency){
  const usdPerUnit = await fetchUsdPerUnit(currency);
  return { usdLocked: Number(amount)*usdPerUnit, rateUsed: usdPerUnit };
}

function ensureBalanceMonth(data, ym){
  if(!data.balance[ym]){
    data.balance[ym] = {
      assets:{cash:[],invest:[],recv:[]},
      liab:{loan:[],card:[],other:[]}
    };
  }
}

function findBalanceItemByName(groupsObj, name){
  const key = norm(name);
  for(const arr of Object.values(groupsObj)){
    const it = arr.find(x=>norm(x.name)===key);
    if(it) return it;
  }
  return null;
}

function applyAutomationFromTx(data, tx){
  const ym = tx.ym;
  ensureBalanceMonth(data, ym);

  const liabItem = findBalanceItemByName(data.balance[ym].liab, tx.categoryName);
  if(liabItem && tx.type==="expense"){
    liabItem.usdLocked = Math.max(0, Number(liabItem.usdLocked||0) - Number(tx.usdLocked||0));
  }

  const assetItem = findBalanceItemByName(data.balance[ym].assets, tx.categoryName);
  if(assetItem && tx.type==="expense"){
    assetItem.usdLocked = Number(assetItem.usdLocked||0) + Number(tx.usdLocked||0);
  }
}

async function addTransaction(){
  const date = $("txDate")?.value || todayISO();
  const ym = ymFromDate(date);
  const currency = $("txCurrency")?.value || "USD";
  const amount = Number($("txAmount")?.value || 0);
  const note = $("txNote")?.value || "";
  const categoryName = $("txCategory")?.value || "";

  if(!amount || amount<=0) return alert("Tutar gir.");
  if(!categoryName) return alert("Kategori seç (bütçeden ekle).");

  const btn = $("btnAddTx");
  if(btn) btn.disabled = true;
  if($("txInfo")) $("txInfo").textContent="Kur çekiliyor...";

  try{
    const {usdLocked, rateUsed} = await toUsdLocked(amount, currency);
    const data = loadData();
    if(!data.planRates[ym]) data.planRates[ym] = {TRY:null,RUB:null};

    const tx = { id: crypto.randomUUID(), date, ym, type: currentTxType, currency,
      amountOriginal: amount, usdLocked, rateUsed, note, categoryName };

    data.transactions.push(tx);
    applyAutomationFromTx(data, tx);
    saveData(data);
    closeModal("transactionModal");
    render();
  }catch(e){
    console.error(e);
    alert("Kur çekilemedi: "+(e?.message||e));
  }finally{
    if(btn) btn.disabled=false;
    if($("txInfo")) $("txInfo").textContent="İşlem girildiği an kur çekilir ve USD değeri kilitlenir.";
  }
}

function addBalanceItem(){
  const data = loadData();
  ensureSelectedYM(data);
  ensureBalanceMonth(data, selectedYM);

  const name = ($("balItemName")?.value || "").trim();
  const currency = $("balItemCurrency")?.value || "USD";
  const amount = Number($("balItemAmount")?.value || 0);
  const note = $("balItemNote")?.value || "";

  if(!name) return alert("Kategori adı gir.");
  if(!amount || amount<=0) return alert("Tutar gir.");

  const btn = $("btnSaveBalItem");
  if(btn) btn.disabled=true;

  toUsdLocked(amount,currency).then(({usdLocked,rateUsed})=>{
    const item = { id: data.balanceNextId++, name, currency, amountOriginal:amount, usdLocked, rateUsed, note };
    if(balModalSide==="asset") data.balance[selectedYM].assets[balModalGroup].push(item);
    else data.balance[selectedYM].liab[balModalGroup].push(item);

    saveData(data);
    closeModal("balItemModal");
    render();
  }).catch(e=>{
    console.error(e);
    alert("Kur çekilemedi.");
  }).finally(()=>{
    if(btn) btn.disabled=false;
  });
}

function renderTransactions(data){
  const list = $("transactionsList");
  if(!list) return;
  list.innerHTML = "";
  const tx = data.transactions.filter(t=>t.ym===selectedYM).sort((a,b)=>a.date>b.date?-1:1);
  if(!tx.length){
    const d=document.createElement("div");
    d.className="card muted";
    d.textContent="Bu ay işlem yok.";
    list.appendChild(d);
    return;
  }
  tx.forEach(t=>{
    const div=document.createElement("div");
    div.className="card";
    const sign = t.type==="expense" ? "-" : "+";
    div.innerHTML = `
      <div class="row">
        <div>
          <div style="font-weight:900">${esc(t.categoryName)}</div>
          <div class="muted small">${t.date} • ${esc(t.note||"")}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:900">${sign}${Number(t.amountOriginal).toFixed(2)} ${t.currency}</div>
          <div class="muted small">${fmtUSD2(t.usdLocked)} (kilit)</div>
        </div>
      </div>`;
    list.appendChild(div);
  });
}

function sumBalanceMonth(data, ym){
  ensureBalanceMonth(data, ym);
  const b = data.balance[ym];
  const assets = Object.values(b.assets).flat().reduce((a,x)=>a+Number(x.usdLocked||0),0);
  const liab = Object.values(b.liab).flat().reduce((a,x)=>a+Number(x.usdLocked||0),0);
  return {assets, liab, eq: assets-liab};
}

function renderBalanceLists(data){
  ensureBalanceMonth(data, selectedYM);
  const b = data.balance[selectedYM];

  function bind(elId, side, group, arr){
    const box = $(elId);
    if(!box) return;
    box.innerHTML="";
    arr.forEach(item=>{
      const div=document.createElement("div");
      div.className="item";
      div.innerHTML = `
        <div>
          <div class="item-name">${esc(item.name)}</div>
          <div class="item-note">${esc(item.note||"")}</div>
        </div>
        <div class="item-right">
          <div class="item-amt">${Number(item.amountOriginal||0).toFixed(2)} ${item.currency}</div>
          <div class="item-usd">${fmtUSD2(item.usdLocked)} (kilit)</div>
        </div>`;
      box.appendChild(div);
    });
  }

  bind("asset-cash","asset","cash",b.assets.cash);
  bind("asset-invest","asset","invest",b.assets.invest);
  bind("asset-recv","asset","recv",b.assets.recv);

  bind("liab-loan","liab","loan",b.liab.loan);
  bind("liab-card","liab","card",b.liab.card);
  bind("liab-other","liab","other",b.liab.other);

  const s = sumBalanceMonth(data, selectedYM);
  if($("balAssets")) $("balAssets").textContent = fmtUSD(s.assets);
  if($("balLiab")) $("balLiab").textContent = fmtUSD(s.liab);
  if($("balEquity")) $("balEquity").textContent = fmtUSD(s.eq);

  // chart (optional)
  const canvas = $("balanceChart");
  if(canvas && window.Chart){
    const months = Object.keys(data.planRates||{}).concat(Object.keys(data.balance||{})).concat(data.transactions.map(t=>t.ym));
    const uniq = Array.from(new Set(months)).filter(Boolean).sort();
    if(!uniq.length) return;

    const labels = uniq;
    const assets = labels.map(ym=>sumBalanceMonth(data, ym).assets);
    const liab = labels.map(ym=>sumBalanceMonth(data, ym).liab);
    const eq = labels.map(ym=>sumBalanceMonth(data, ym).eq);

    if(_balanceChart){
      _balanceChart.data.labels = labels;
      _balanceChart.data.datasets[0].data = assets;
      _balanceChart.data.datasets[1].data = liab;
      _balanceChart.data.datasets[2].data = eq;
      _balanceChart.update();
    }else{
      _balanceChart = new Chart(canvas, {
        type:"line",
        data:{ labels, datasets:[
          {label:"Varlıklar", data:assets, tension:.25},
          {label:"Borçlar", data:liab, tension:.25},
          {label:"Öz Sermaye", data:eq, tension:.25}
        ]},
        options:{ responsive:true, maintainAspectRatio:false }
      });
      canvas.parentElement && (canvas.parentElement.style.height="260px");
    }
  }
}

function renderMonthFilters(data){
  const months = Array.from(new Set(
    Object.keys(data.planRates||{})
    .concat(Object.keys(data.balance||{}))
    .concat(data.transactions.map(t=>t.ym))
  )).filter(Boolean).sort();

  if(!months.length){
    const ym = ymFromDate(todayISO());
    months.push(ym);
  }
  if(!selectedYM) selectedYM = months[months.length-1];

  const mk = (id) => {
    const box = $(id);
    if(!box) return;
    box.innerHTML="";
    months.forEach(ym=>{
      const b=document.createElement("button");
      b.className="pill" + (ym===selectedYM ? " active": "");
      b.textContent=ym;
      b.addEventListener("click", ()=>{
        selectedYM = ym;
        const d2 = loadData();
        if(!d2.planRates[selectedYM]) { d2.planRates[selectedYM] = {TRY:null,RUB:null}; saveData(d2); }
        render();
      });
      box.appendChild(b);
    });
  };
  mk("monthFilter");
  mk("balMonthFilter");
}

function calcMonthlySummary(data, ym){
  const planIncome = data.categories.income.reduce((a,c)=>a+planToUSD(data, Number(c.months?.[ym]||0), c.currency, ym), 0);
  const planExpense = data.categories.expense.reduce((a,c)=>a+planToUSD(data, Number(c.months?.[ym]||0), c.currency, ym), 0);
  const actualIncome = data.transactions.filter(t=>t.ym===ym && t.type==="income").reduce((a,t)=>a+Number(t.usdLocked||0),0);
  const actualExpense = data.transactions.filter(t=>t.ym===ym && t.type==="expense").reduce((a,t)=>a+Number(t.usdLocked||0),0);
  return { planIncome, planExpense, actualIncome, actualExpense, planNet: planIncome-planExpense, actualNet: actualIncome-actualExpense };
}

function renderTopSummary(data){
  const s = calcMonthlySummary(data, selectedYM);
  if($("sumIncome")) $("sumIncome").textContent = fmtUSD(s.actualIncome);
  if($("sumIncomeSub")) $("sumIncomeSub").textContent = `Plan ${fmtUSD(s.planIncome)} / Gerçek ${fmtUSD(s.actualIncome)}`;
  if($("sumExpense")) $("sumExpense").textContent = fmtUSD(s.actualExpense);
  if($("sumExpenseSub")) $("sumExpenseSub").textContent = `Plan ${fmtUSD(s.planExpense)} / Gerçek ${fmtUSD(s.actualExpense)}`;
  if($("sumNet")) $("sumNet").textContent = fmtUSD(s.actualNet);
  if($("sumNetSub")) $("sumNetSub").textContent = `Plan ${fmtUSD(s.planNet)} / Gerçek ${fmtUSD(s.actualNet)}`;
  if($("headerSubtitle")) $("headerSubtitle").textContent = `${selectedYM} • USD baz`;
}

function render(){
  const data = loadData();
  ensureSelectedYM(data);
  if(!data.planRates[selectedYM]){ data.planRates[selectedYM] = {TRY:null,RUB:null}; saveData(data); }

  renderMonthFilters(data);
  renderRatesCard(data);
  renderBudgetLists(data);
  renderTransactions(data);
  renderTopSummary(data);
  renderBalanceLists(data);
}

// wire events (NULL SAFE)
document.addEventListener("DOMContentLoaded", ()=>{
  wireTabs();

  $("btnSaveCategory")?.addEventListener("click", addCategory);
  $("btnAddTx")?.addEventListener("click", addTransaction);
  $("btnSaveBalItem")?.addEventListener("click", addBalanceItem);
  $("btnRatesEdit")?.addEventListener("click", promptEditRates);

  if($("txDate")) $("txDate").value = todayISO();
  render();
});
