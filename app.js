import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let taxa = 0;

let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;

// GRÁFICO
let chart;

function atualizarGrafico() {
  const ctx = document.getElementById("graficoFinanceiro");

  if (!ctx) return;

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Receitas", "Despesas"],
      datasets: [{
        label: "€ (Euro)",
        data: [totalReceitas, totalDespesas],
        backgroundColor: ["#22c55e", "#ef4444"]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// =====================
// CÂMBIO
// =====================
async function pegarCambio() {
  const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
  const data = await res.json();
  taxa = data?.rates?.BRL || 0;

  document.getElementById("cambio").innerText =
    `€1 = R$ ${taxa.toFixed(2)}`;
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
// RECEITA
// =====================
window.addReceita = async function () {
  const desc = document.getElementById("r-desc").value;
  const cat = document.getElementById("r-cat").value;
  const val = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  await addDoc(collection(db, "receitas"), {
    desc,
    categoria: cat,
    val,
    moeda,
    criadoEm: Date.now()
  });
};

// =====================
// DESPESA
// =====================
window.addDespesa = async function () {
  const desc = document.getElementById("d-desc").value;
  const cat = document.getElementById("d-cat").value;
  const val = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  await addDoc(collection(db, "despesas"), {
    desc,
    categoria: cat,
    val,
    moeda,
    criadoEm: Date.now()
  });
};

// =====================
// DÍVIDAS
// =====================
window.addDivida = async function () {
  const desc = document.getElementById("div-desc").value;
  const valor = Number(document.getElementById("div-valor").value);
  const moeda = document.getElementById("div-moeda").value;

  await addDoc(collection(db, "dividas"), {
    desc,
    valorOriginal: valor,
    moeda,
    pago: 0,
    criadoEm: Date.now()
  });
};

// =====================
// RECEITAS STREAM
// =====================
onSnapshot(collection(db, "receitas"), (snap) => {
  totalReceitas = 0;
  let html = "";

  snap.forEach((i) => {
    const r = i.data();
    const v = eur(r.val, r.moeda);

    totalReceitas += v;

    html += `
      <div class="card">
        <strong>${r.desc}</strong>
        <p>📁 ${r.categoria}</p>
        <p>${r.moeda} ${r.val}</p>
        <small>€ ${v.toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-receitas").innerHTML = html;
  atualizarResumo();
});

// =====================
// DESPESAS STREAM
// =====================
onSnapshot(collection(db, "despesas"), (snap) => {
  totalDespesas = 0;
  let html = "";

  snap.forEach((i) => {
    const d = i.data();
    const v = eur(d.val, d.moeda);

    totalDespesas += v;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>📁 ${d.categoria}</p>
        <p>${d.moeda} ${d.val}</p>
        <small>€ ${v.toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-despesas").innerHTML = html;
  atualizarResumo();
});

// =====================
// DÍVIDAS STREAM
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
        <p>Total: ${d.moeda} ${d.valorOriginal}</p>
      </div>
    `;
  });

  document.getElementById("lista-dividas").innerHTML = html;
  atualizarResumo();
});
