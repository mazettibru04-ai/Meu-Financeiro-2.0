import { db } from "./firebase.js";
import { collection, addDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let taxa = 0;
let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;

let chart;

// 🎨 animação global
Chart.defaults.animation = {
  duration: 1800,
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
  taxa = data.rates.BRL || 0;

  document.getElementById("cambio").innerText =
    `€1 = R$ ${taxa.toFixed(2)}`;
}
pegarCambio();

// =====================
// RESUMO (CORRIGIDO 100%)
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  document.getElementById("total-receitas").innerText =
    `Receitas: €${totalReceitas.toFixed(2)}`;

  document.getElementById("total-despesas").innerText =
    `Despesas: €${totalDespesas.toFixed(2)}`;

  document.getElementById("total-dividas").innerText =
    `Dívidas: €${totalDividas.toFixed(2)}`;

  document.getElementById("saldo").innerText =
    `Saldo: €${saldo.toFixed(2)}`;

  document.getElementById("saldo-real").innerText =
    `Saldo real: €${saldoReal.toFixed(2)}`;

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
        backgroundColor: ["#00ff88", "#ff2e63", "#00c2ff"],
        borderRadius: 20
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      animation: {
        duration: 2000,
        easing: "easeOutElastic"
      }
    }
  });
}

// =====================
// ADICIONAR RECEITA
// =====================
window.addReceita = async () => {
  await addDoc(collection(db, "receitas"), {
    desc: document.getElementById("r-desc").value,
    categoria: document.getElementById("r-cat").value,
    val: Number(document.getElementById("r-val").value),
    moeda: document.getElementById("r-moeda").value,
    criadoEm: Date.now()
  });
};

// =====================
// ADICIONAR DESPESA
// =====================
window.addDespesa = async () => {
  await addDoc(collection(db, "despesas"), {
    desc: document.getElementById("d-desc").value,
    categoria: document.getElementById("d-cat").value,
    val: Number(document.getElementById("d-val").value),
    moeda: document.getElementById("d-moeda").value,
    criadoEm: Date.now()
  });
};

// =====================
// ADICIONAR DÍVIDA
// =====================
window.addDivida = async () => {
  await addDoc(collection(db, "dividas"), {
    desc: document.getElementById("div-desc").value,
    valorOriginal: Number(document.getElementById("div-valor").value),
    moeda: document.getElementById("div-moeda").value,
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

    html += `
      <div class="card">
        <strong>${r.desc}</strong>
        <p>${r.categoria}</p>
        <small>€ ${v.toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-receitas").innerHTML = html;
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

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>${d.categoria}</p>
        <small>€ ${v.toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-despesas").innerHTML = html;
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

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <small>€ ${eur(d.valorOriginal, d.moeda).toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-dividas").innerHTML = html;
  atualizarResumo();
});
