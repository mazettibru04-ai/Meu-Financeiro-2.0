import { db } from "./firebase.js";
import { collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let taxa = 0;
let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;

let chart;
let chartReceitas;
let chartDespesas;

// 🎨 animação global
Chart.defaults.animation = {
  duration: 1600,
  easing: "easeOutQuart"
};

// =====================
// CONVERSÃO
// =====================
function eur(v, m) {
  if (m === "EUR") return v;
  if (m === "BRL") return v / taxa;
  return v;
}

// =====================
// CÂMBIO
// =====================
async function pegarCambio() {
  const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
  const data = await res.json();
  taxa = data.rates.BRL;
  document.getElementById("cambio").innerText = `€1 = R$ ${taxa.toFixed(2)}`;
}
pegarCambio();

// =====================
// RESUMO
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  document.getElementById("total-receitas").innerText = `Receitas: €${totalReceitas.toFixed(2)}`;
  document.getElementById("total-despesas").innerText = `Despesas: €${totalDespesas.toFixed(2)}`;
  document.getElementById("total-dividas").innerText = `Dívidas: €${totalDividas.toFixed(2)}`;
  document.getElementById("saldo").innerText = `Saldo: €${saldo.toFixed(2)}`;
  document.getElementById("saldo-real").innerText = `Saldo real: €${saldoReal.toFixed(2)}`;

  atualizarGrafico();
}

// =====================
// GRÁFICO PRINCIPAL
// =====================
function atualizarGrafico() {
  const ctx = document.getElementById("graficoFinanceiro");
  if (!ctx) return;

  if (chart) chart.destroy();

  const saldo = totalReceitas - totalDespesas;

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Receitas", "Despesas", "Saldo"],
      datasets: [{
        data: [totalReceitas, totalDespesas, saldo],
        backgroundColor: ["#22c55e", "#ef4444", "#3b82f6"],
        borderRadius: 18
      }]
    },
    options: {
      plugins: { legend: { display: false } }
    }
  });
}

// =====================
// RECEITAS
// =====================
window.addReceita = async function () {
  await addDoc(collection(db, "receitas"), {
    desc: r-desc.value,
    categoria: r-cat.value,
    val: Number(r-val.value),
    moeda: r-moeda.value,
    criadoEm: Date.now()
  });
};

// =====================
// DESPESAS
// =====================
window.addDespesa = async function () {
  await addDoc(collection(db, "despesas"), {
    desc: d-desc.value,
    categoria: d-cat.value,
    val: Number(d-val.value),
    moeda: d-moeda.value,
    criadoEm: Date.now()
  });
};

// =====================
// DÍVIDAS
// =====================
window.addDivida = async function () {
  await addDoc(collection(db, "dividas"), {
    desc: div-desc.value,
    valorOriginal: Number(div-valor.value),
    moeda: div-moeda.value,
    criadoEm: Date.now()
  });
};

// =====================
// STREAM RECEITAS
// =====================
onSnapshot(collection(db, "receitas"), snap => {
  totalReceitas = 0;
  let html = "";

  snap.forEach(i => {
    const r = i.data();
    const v = eur(r.val, r.moeda);
    totalReceitas += v;

    html += `<div class="card">${r.desc} - €${v.toFixed(2)}</div>`;
  });

  lista-receitas.innerHTML = html;
  atualizarResumo();
});

// =====================
// STREAM DESPESAS
// =====================
onSnapshot(collection(db, "despesas"), snap => {
  totalDespesas = 0;
  let html = "";

  snap.forEach(i => {
    const d = i.data();
    const v = eur(d.val, d.moeda);
    totalDespesas += v;

    html += `<div class="card">${d.desc} - €${v.toFixed(2)}</div>`;
  });

  lista-despesas.innerHTML = html;
  atualizarResumo();
});

// =====================
// STREAM DÍVIDAS
// =====================
onSnapshot(collection(db, "dividas"), snap => {
  totalDividas = 0;
  let html = "";

  snap.forEach(i => {
    const d = i.data();
    totalDividas += eur(d.valorOriginal, d.moeda);

    html += `<div class="card">${d.desc}</div>`;
  });

  lista-dividas.innerHTML = html;
  atualizarResumo();
});
