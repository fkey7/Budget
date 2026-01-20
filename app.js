const STORAGE_KEY = "butce_data_v1";

// Senin gönderdiğin JSON formatına uygun "boş şablon"
function defaultData() {
  return {
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
  // Geriye uyumluluk için alan yoksa ekle
  const base = defaultData();
  return {
    ...base,
    ...d,
    categories: d.categories ?? base.categories,
    transactions: d.transactions ?? base.transactions,
    monthlyRates: d.monthlyRates ?? base.monthlyRates,
    exchangeRates: d.exchangeRates ?? base.exchangeRates,
    nextCategoryId: d.nextCategoryId ?? base.nextCategoryId,
  };
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

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function render() {
  const data = loadData();

  setStatus([
    `Kategoriler (Gelir): ${data.categories.income.length}`,
    `Kategoriler (Gider): ${data.categories.expense.length}`,
    `İşlem sayısı: ${data.transactions.length}`,
    `Kur: ${JSON.stringify(data.exchangeRates)}`,
    `monthlyRates anahtar sayısı: ${Object.keys(data.monthlyRates).length}`,
  ].join("\n"));

  const txList = document.getElementById("txList");
  if (!data.transactions.length) {
    txList.textContent = "(işlem yok)";
    return;
  }

  // Son 10 işlemi basitçe göster
  const last = data.transactions.slice(-10).reverse();
 txList.innerHTML = last.map(t => {
  const sign = t.type === "expense" ? "-" : "+";
  return `<div>${t.date} | ${sign}${t.amount} ${t.currency} | ${t.note}</div>`;
}).join("");

}

document.getElementById("btnExport").addEventListener("click", () => {
  const data = loadData();
  const today = new Date().toISOString().slice(0, 10);
  downloadJson(`butce-yedek-${today}.json`, data);
});

document.getElementById("fileImport").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    const data = migrateIfNeeded(parsed);
    saveData(data);
    render();
    alert("JSON içe aktarıldı ✅");
  } catch (err) {
    alert("JSON okunamadı ❌");
  } finally {
    e.target.value = "";
  }
});

document.getElementById("btnReset").addEventListener("click", () => {
  if (!confirm("Tüm veriyi sıfırlamak istiyor musun?")) return;
  localStorage.removeItem(STORAGE_KEY);
  render();
});

render();
function addTransaction({ type, date, amount, currency, note }) {
  const data = loadData();

  const tx = {
    id: crypto.randomUUID(),
    type,            // "expense" | "income"
    date,            // "YYYY-MM-DD"
    amount: Number(amount),
    currency,
    note: note || ""
  };

  data.transactions.push(tx);
  saveData(data);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Varsayılan tarih bugün olsun
const dateInput = document.getElementById("txDate");
if (dateInput && !dateInput.value) dateInput.value = todayISO();

document.getElementById("btnAddTx").addEventListener("click", () => {
  const type = document.getElementById("txType").value;
  const date = document.getElementById("txDate").value || todayISO();
  const amount = document.getElementById("txAmount").value;
  const currency = document.getElementById("txCurrency").value;
  const note = document.getElementById("txNote").value;

  if (!amount || Number(amount) <= 0) {
    alert("Tutar gir (0'dan büyük) ❗️");
    return;
  }

  addTransaction({ type, date, amount, currency, note });

  // input temizle
  document.getElementById("txAmount").value = "";
  document.getElementById("txNote").value = "";

  render();
});
