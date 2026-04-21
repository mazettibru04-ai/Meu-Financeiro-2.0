import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =====================
// VARIÁVEIS
// =====================
let taxa = 0;

let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;

let historico = [];

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
// FORMATAÇÃO
// =====================
function formatarEUR(valor) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
        legend: { labels: { color: "#fff" } }
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
        legend: { labels: { color: "#fff" } }
      }
    }
  });
}

// =====================
// GRÁFICO GERAL (CORRIGIDO — canvas existente)
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
      plugins: { legend: { display: false } },
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
    document.getElementById("cambio").innerText = `€1 = R$ ${formatarEUR(taxa)}`;
  } catch {
    document.getElementById("cambio").innerText = "Erro ao carregar câmbio";
  }
}

// =====================
// CONVERSÃO
// =====================
function eur(v, m) {
  if (m === "EUR") return Number(v);
  if (m === "BRL" && taxa > 0) return Number(v) / taxa;
  return Number(v);
}

// =====================
// RESUMO
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  document.getElementById("total-receitas").innerText = `Receitas: € ${formatarEUR(totalReceitas)}`;
  document.getElementById("total-despesas").innerText = `Despesas: € ${formatarEUR(totalDespesas)}`;
  document.getElementById("total-dividas").innerText = `Dívidas: € ${formatarEUR(totalDividas)}`;
  document.getElementById("saldo").innerText = `Saldo: € ${formatarEUR(saldo)}`;
  document.getElementById("saldo-real").innerText = `Saldo real (com dívidas): € ${formatarEUR(saldoReal)}`;

  atualizarGrafico();
}

// =====================
// HISTÓRICO
// =====================
function registrarHistorico(acao, desc, valor, moeda) {
  const agora = new Date().toLocaleString("pt-BR");
  historico.unshift({ acao, desc, valor, moeda, hora: agora });

  const html = historico.slice(0, 20).map(h => `
    <div class="card">
      <small>${h.hora}</small>
      <p><strong>${h.acao}</strong> — ${h.desc}</p>
      <small>${h.moeda} ${h.valor}</small>
    </div>
  `).join("");

  document.getElementById("lista-historico").innerHTML = html;
}

// =====================
// ADICIONAR RECEITA
// =====================
window.addReceita = async function () {
  const desc = document.getElementById("r-desc").value.trim();
  const cat = document.getElementById("r-cat").value;
  const val = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "receitas"), {
    desc, categoria: cat, val, moeda, criadoEm: Date.now()
  });

  registrarHistorico("➕ Receita adicionada", desc, val, moeda);

  document.getElementById("r-desc").value = "";
  document.getElementById("r-val").value = "";
};

// =====================
// ADICIONAR DESPESA
// =====================
window.addDespesa = async function () {
  const desc = document.getElementById("d-desc").value.trim();
  const cat = document.getElementById("d-cat").value;
  const val = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "despesas"), {
    desc, categoria: cat, val, moeda, criadoEm: Date.now()
  });

  registrarHistorico("➖ Despesa adicionada", desc, val, moeda);

  document.getElementById("d-desc").value = "";
  document.getElementById("d-val").value = "";
};

// =====================
// ADICIONAR DÍVIDA
// =====================
window.addDivida = async function () {
  const desc = document.getElementById("div-desc").value.trim();
  const valor = Number(document.getElementById("div-valor").value);
  const moeda = document.getElementById("div-moeda").value;

  if (!desc || valor <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "dividas"), {
    desc, valorOriginal: valor, moeda, pago: 0, criadoEm: Date.now()
  });

  registrarHistorico("💳 Dívida adicionada", desc, valor, moeda);

  document.getElementById("div-desc").value = "";
  document.getElementById("div-valor").value = "";
};

// =====================
// DELETAR
// =====================
window.deletarItem = async function (colecao, id, desc) {
  if (!confirm(`Remover "${desc}"?`)) return;

  await deleteDoc(doc(db, colecao, id));
  registrarHistorico(`🗑️ ${colecao.charAt(0).toUpperCase() + colecao.slice(1)} removido`, desc, "-", "-");
};

// =====================
// INICIALIZAR — aguarda câmbio antes dos listeners (FIX race condition)
// =====================
async function inicializar() {
  await pegarCambio();

  // STREAM RECEITAS (com orderBy)
  const qReceitas = query(collection(db, "receitas"), orderBy("criadoEm", "desc"));
  onSnapshot(qReceitas, (snap) => {
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
          <small>€ ${formatarEUR(v)}</small>
          <div class="actions">
            <button onclick="deletarItem('receitas', '${i.id}', '${r.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("lista-receitas").innerHTML = html || "<p style='color:#94a3b8'>Nenhuma receita</p>";
    atualizarResumo();
    atualizarGraficoReceitas(lista);
  });

  // STREAM DESPESAS (com orderBy)
  const qDespesas = query(collection(db, "despesas"), orderBy("criadoEm", "desc"));
  onSnapshot(qDespesas, (snap) => {
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
          <small>€ ${formatarEUR(v)}</small>
          <div class="actions">
            <button onclick="deletarItem('despesas', '${i.id}', '${d.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("lista-despesas").innerHTML = html || "<p style='color:#94a3b8'>Nenhuma despesa</p>";
    atualizarResumo();
    atualizarGraficoDespesas(lista);
  });

  // STREAM DÍVIDAS (com orderBy)
  const qDividas = query(collection(db, "dividas"), orderBy("criadoEm", "desc"));
  onSnapshot(qDividas, (snap) => {
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
          <small>€ ${formatarEUR(v)}</small>
          <div class="actions">
            <button onclick="deletarItem('dividas', '${i.id}', '${d.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("lista-dividas").innerHTML = html || "<p style='color:#94a3b8'>Nenhuma dívida</p>";
    atualizarResumo();
  });
}

inicializar();
