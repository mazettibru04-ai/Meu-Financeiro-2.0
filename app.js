import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =====================
// VARIÁVEIS
// =====================
let taxa = 0;

let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;

// =====================
// GRÁFICOS
// =====================
let chart;
let chartReceitas;
let chartDespesas;

// =====================
// CATEGORIAS CORES
// =====================
const coresCategoria = {
  Alimentação: "#ef4444",
  Transporte: "#3b82f6",
  Moradia: "#f97316",
  Saúde: "#10b981",
  Lazer: "#a855f7",
  Outros: "#94a3b8"
};

// =====================
// AGRUPAR CATEGORIAS
// =====================
function agruparPorCategoria(lista, campoValor = "val", campoCat = "categoria") {
  const dados = {};

  lista.forEach(item => {
    const cat = item[campoCat] || "Outros";
    const valor = eur(item[campoValor], item.moeda);

    dados[cat] = (dados[cat] || 0) + valor;
  });

  return dados;
}

// =====================
// GRÁFICO DESPESAS
// =====================
function atualizarGraficoDespesas(lista) {
  const ctx = document.getElementById("graficoDespesas");
  if (!ctx) return;

  const dados = agruparPorCategoria(lista);

  const labels = Object.keys(dados);
  const valores = Object.values(dados);
  const cores = labels.map(c => coresCategoria[c] || "#999");

  if (chartDespesas) chartDespesas.destroy();

  chartDespesas = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: cores
      }]
    },
    options: {
      plugins: {
        legend: {
          labels: { color: "#fff" }
        }
      }
    }
  });
}

// =====================
// GRÁFICO RECEITAS
// =====================
function atualizarGraficoReceitas(lista) {
  const ctx = document.getElementById("graficoReceitas");
  if (!ctx) return;

  const dados = agruparPorCategoria(lista);

  const labels = Object.keys(dados);
  const valores = Object.values(dados);

  if (chartReceitas) chartReceitas.destroy();

  chartReceitas = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: valores,
        backgroundColor: ["#22c55e", "#3b82f6", "#a855f7", "#94a3b8"]
      }]
    },
    options: {
      plugins: {
        legend: {
          labels: { color: "#fff" }
        }
      }
    }
  });
}

// =====================
// GRÁFICO GERAL
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
        borderRadius: 10,
        barThickness: 45
      }]
    },
    options: {
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { ticks: { color: "#fff" } },
        y: { ticks: { color: "#fff" } }
      }
    }
  });
}

// =====================
// CÂMBIO
// =====================
async function pegarCambio() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
    const data = await res.json();

    taxa = data?.rates?.BRL || 0;

    document.getElementById("cambio").innerText =
      `€1 = R$ ${taxa.toFixed(2)}`;

  } catch {
    document.getElementById("cambio").innerText =
      "Erro ao carregar câmbio";
  }
}

pegarCambio();

// =====================
// CONVERSÃO
// =====================
function eur(v, m) {
  if (m === "EUR") return v;
  if (m === "BRL") return v / taxa;
  return v;
}

// =====================
// RESUMO
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  document.getElementById("total-receitas").innerText =
    `Receitas: € ${totalReceitas.toFixed(2)}`;

  document.getElementById("total-despesas").innerText =
    `Despesas: € ${totalDespesas.toFixed(2)}`;

  document.getElementById("total-dividas").innerText =
    `Dívidas: € ${totalDividas.toFixed(2)}`;

  document.getElementById("saldo").innerText =
    `Saldo: € ${saldo.toFixed(2)}`;

  document.getElementById("saldo-real").innerText =
    `Saldo real (com dívidas): € ${saldoReal.toFixed(2)}`;

  atualizarGrafico();
}

// =====================
// ADICIONAR RECEITA
// =====================
window.addReceita = async function () {
  const desc = document.getElementById("r-desc").value;
  const cat = document.getElementById("r-cat").value;
  const val = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "receitas"), {
    desc,
    categoria: cat,
    val,
    moeda,
    criadoEm: Date.now()
  });

  document.getElementById("r-desc").value = "";
  document.getElementById("r-val").value = "";
};

// =====================
// ADICIONAR DESPESA
// =====================
window.addDespesa = async function () {
  const desc = document.getElementById("d-desc").value;
  const cat = document.getElementById("d-cat").value;
  const val = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "despesas"), {
    desc,
    categoria: cat,
    val,
    moeda,
    criadoEm: Date.now()
  });

  document.getElementById("d-desc").value = "";
  document.getElementById("d-val").value = "";
};

// =====================
// ADICIONAR DÍVIDA
// =====================
window.addDivida = async function () {
  const desc = document.getElementById("div-desc").value;
  const valor = Number(document.getElementById("div-valor").value);
  const moeda = document.getElementById("div-moeda").value;

  if (!desc || valor <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "dividas"), {
    desc,
    valorOriginal: valor,
    moeda,
    pago: 0,
    criadoEm: Date.now()
  });

  document.getElementById("div-desc").value = "";
  document.getElementById("div-valor").value = "";
};

// =====================
// STREAM RECEITAS
// =====================
onSnapshot(collection(db, "receitas"), (snap) => {
  totalReceitas = 0;
  let lista = [];
  let html = "";

  snap.forEach((i) => {
    const r = i.data();
    const v = eur(r.val, r.moeda);

    totalReceitas += v;
    lista.push(r);

    html += `
      <div class="card">
        <strong>${r.desc}</strong>
        <p>${r.categoria}</p>
        <p>${r.moeda} ${r.val}</p>
        <small>€ ${v.toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-receitas").innerHTML = html;

  atualizarResumo();
  atualizarGraficoReceitas(lista);
});

// =====================
// STREAM DESPESAS
// =====================
onSnapshot(collection(db, "despesas"), (snap) => {
  totalDespesas = 0;
  let lista = [];
  let html = "";

  snap.forEach((i) => {
    const d = i.data();
    const v = eur(d.val, d.moeda);

    totalDespesas += v;
    lista.push(d);

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>${d.categoria}</p>
        <p>${d.moeda} ${d.val}</p>
        <small>€ ${v.toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-despesas").innerHTML = html;

  atualizarResumo();
  atualizarGraficoDespesas(lista);
});

// =====================
// STREAM DÍVIDAS
// =====================
onSnapshot(collection(db, "dividas"), (snap) => {
  totalDividas = 0;
  let html = "";

  snap.forEach((i) => {
    const d = i.data();
    const v = eur(d.valorOriginal, d.moeda);

    totalDividas += v;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>${d.moeda} ${d.valorOriginal}</p>
      </div>
    `;
  });

  document.getElementById("lista-dividas").innerHTML = html;

  atualizarResumo();
});
