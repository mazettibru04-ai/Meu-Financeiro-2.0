import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
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

// Estado do modal
let modalDividaId = null;
let modalDividaData = null;

// =====================
// GRÁFICOS
// =====================
let chart;
let chartReceitas;
let chartDespesas;

// =====================
// CORES
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
function fmt(valor) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
// AGRUPAR CATEGORIAS
// =====================
function agruparPorCategoria(lista) {
  const dados = {};
  lista.forEach(item => {
    const cat = item.categoria || "Outros";
    dados[cat] = (dados[cat] || 0) + eur(item.val, item.moeda);
  });
  return dados;
}

// =====================
// GRÁFICOS
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
    data: { labels, datasets: [{ data: valores, backgroundColor: cores }] },
    options: { plugins: { legend: { labels: { color: "#fff" } } } }
  });
}

function atualizarGraficoReceitas(lista) {
  const ctx = document.getElementById("graficoReceitas");
  if (!ctx) return;
  const dados = agruparPorCategoria(lista);
  const labels = Object.keys(dados);
  const valores = Object.values(dados);
  if (chartReceitas) chartReceitas.destroy();
  chartReceitas = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: valores, backgroundColor: ["#22c55e", "#3b82f6", "#a855f7", "#94a3b8"] }] },
    options: { plugins: { legend: { labels: { color: "#fff" } } } }
  });
}

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
    document.getElementById("cambio").innerText = `€1 = R$ ${fmt(taxa)}`;
  } catch {
    document.getElementById("cambio").innerText = "Erro ao carregar câmbio";
  }
}

// =====================
// RESUMO
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  document.getElementById("total-receitas").innerText = `Receitas: € ${fmt(totalReceitas)}`;
  document.getElementById("total-despesas").innerText = `Despesas: € ${fmt(totalDespesas)}`;
  document.getElementById("total-dividas").innerText = `Dívidas: € ${fmt(totalDividas)}`;
  document.getElementById("saldo").innerText = `Saldo: € ${fmt(saldo)}`;
  document.getElementById("saldo-real").innerText = `Saldo real (com dívidas): € ${fmt(saldoReal)}`;

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
// PROGRESS BAR (inline no card)
// =====================
function renderProgress(pago, total) {
  const pct = Math.min(100, total > 0 ? Math.round((pago / total) * 100) : 0);
  const classe = pct >= 100 ? "done" : pct >= 50 ? "mid" : "low";
  const label = pct >= 100 ? "✅ Pago!" : `${pct}% pago`;

  return `
    <div class="progress-wrap">
      <div class="progress-label">
        <span>Progresso</span>
        <span class="pct ${classe}">${label}</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill ${classe}" style="width: ${pct}%"></div>
      </div>
    </div>
  `;
}

// =====================
// MODAL — ABRIR
// =====================
window.abrirModalPagamento = function (id, data) {
  modalDividaId = id;
  modalDividaData = data;

  const totalEUR = eur(data.valorOriginal, data.moeda);
  const pagoEUR  = eur(data.pago || 0, data.moeda);
  const restaEUR = Math.max(0, totalEUR - pagoEUR);
  const pct = Math.min(100, totalEUR > 0 ? Math.round((pagoEUR / totalEUR) * 100) : 0);

  // Textos
  document.getElementById("modal-nome").textContent = data.desc;
  document.getElementById("modal-moeda-info").textContent =
    `Moeda original: ${data.moeda} ${data.valorOriginal}`;
  document.getElementById("modal-total").textContent = `€ ${fmt(totalEUR)}`;
  document.getElementById("modal-pago").textContent  = `€ ${fmt(pagoEUR)}`;
  document.getElementById("modal-resta").textContent = `€ ${fmt(restaEUR)}`;
  document.getElementById("modal-valor-pagar").value = "";

  // Anel
  const circumference = 2 * Math.PI * 60; // r=60 → 377
  const offset = circumference - (pct / 100) * circumference;
  const ringFill = document.getElementById("ring-fill");
  const ringPct  = document.getElementById("ring-pct");

  // Cor do anel
  const cor = pct >= 100 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  ringFill.style.stroke = cor;
  ringPct.style.color   = cor;

  // Pequeno delay para a animação rodar ao abrir
  ringFill.style.strokeDashoffset = circumference;
  setTimeout(() => {
    ringFill.style.strokeDashoffset = offset;
  }, 80);

  ringPct.textContent = `${pct}%`;

  document.getElementById("modal-pagamento").classList.add("active");
};

// =====================
// MODAL — FECHAR
// =====================
window.fecharModal = function () {
  document.getElementById("modal-pagamento").classList.remove("active");
  modalDividaId = null;
  modalDividaData = null;
};

// Fechar clicando fora
document.getElementById("modal-pagamento").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) fecharModal();
});

// =====================
// CONFIRMAR PAGAMENTO
// =====================
window.confirmarPagamento = async function () {
  if (!modalDividaId || !modalDividaData) return;

  const valorPagar = Number(document.getElementById("modal-valor-pagar").value);
  if (!valorPagar || valorPagar <= 0) return alert("Informe um valor válido");

  const pagoAtual = Number(modalDividaData.pago) || 0;
  const novoPago  = pagoAtual + valorPagar;
  const total     = Number(modalDividaData.valorOriginal);

  if (novoPago > total) {
    return alert(`O valor excede o total da dívida. Máximo a pagar: ${modalDividaData.moeda} ${fmt(total - pagoAtual)}`);
  }

  await updateDoc(doc(db, "dividas", modalDividaId), { pago: novoPago });

  registrarHistorico(
    "💸 Pagamento realizado",
    modalDividaData.desc,
    valorPagar,
    modalDividaData.moeda
  );

  // Atualiza modal com novos valores
  const novoData = { ...modalDividaData, pago: novoPago };
  abrirModalPagamento(modalDividaId, novoData);
};

// =====================
// ADICIONAR RECEITA
// =====================
window.addReceita = async function () {
  const desc  = document.getElementById("r-desc").value.trim();
  const cat   = document.getElementById("r-cat").value;
  const val   = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "receitas"), { desc, categoria: cat, val, moeda, criadoEm: Date.now() });
  registrarHistorico("➕ Receita adicionada", desc, val, moeda);

  document.getElementById("r-desc").value = "";
  document.getElementById("r-val").value  = "";
};

// =====================
// ADICIONAR DESPESA
// =====================
window.addDespesa = async function () {
  const desc  = document.getElementById("d-desc").value.trim();
  const cat   = document.getElementById("d-cat").value;
  const val   = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "despesas"), { desc, categoria: cat, val, moeda, criadoEm: Date.now() });
  registrarHistorico("➖ Despesa adicionada", desc, val, moeda);

  document.getElementById("d-desc").value = "";
  document.getElementById("d-val").value  = "";
};

// =====================
// ADICIONAR DÍVIDA
// =====================
window.addDivida = async function () {
  const desc  = document.getElementById("div-desc").value.trim();
  const valor = Number(document.getElementById("div-valor").value);
  const moeda = document.getElementById("div-moeda").value;

  if (!desc || valor <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "dividas"), {
    desc, valorOriginal: valor, moeda, pago: 0, criadoEm: Date.now()
  });
  registrarHistorico("💳 Dívida adicionada", desc, valor, moeda);

  document.getElementById("div-desc").value   = "";
  document.getElementById("div-valor").value  = "";
};

// =====================
// DELETAR
// =====================
window.deletarItem = async function (colecao, id, desc) {
  if (!confirm(`Remover "${desc}"?`)) return;
  await deleteDoc(doc(db, colecao, id));
  registrarHistorico(
    `🗑️ ${colecao.charAt(0).toUpperCase() + colecao.slice(1)} removido`,
    desc, "-", "-"
  );
};

// =====================
// INICIALIZAR
// =====================
async function inicializar() {
  await pegarCambio();

  // RECEITAS
  const qReceitas = query(collection(db, "receitas"), orderBy("criadoEm", "desc"));
  onSnapshot(qReceitas, (snap) => {
    totalReceitas = 0;
    let lista = [];
    let html  = "";

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
          <small>€ ${fmt(v)}</small>
          <div class="actions">
            <button onclick="deletarItem('receitas','${i.id}','${r.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("lista-receitas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma receita</p>";
    atualizarResumo();
    atualizarGraficoReceitas(lista);
  });

  // DESPESAS
  const qDespesas = query(collection(db, "despesas"), orderBy("criadoEm", "desc"));
  onSnapshot(qDespesas, (snap) => {
    totalDespesas = 0;
    let lista = [];
    let html  = "";

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
          <small>€ ${fmt(v)}</small>
          <div class="actions">
            <button onclick="deletarItem('despesas','${i.id}','${d.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("lista-despesas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma despesa</p>";
    atualizarResumo();
    atualizarGraficoDespesas(lista);
  });

  // DÍVIDAS
  const qDividas = query(collection(db, "dividas"), orderBy("criadoEm", "desc"));
  onSnapshot(qDividas, (snap) => {
    totalDividas = 0;
    let html = "";

    snap.forEach((i) => {
      const d = i.data();
      const totalEUR = eur(d.valorOriginal, d.moeda);
      const pagoEUR  = eur(d.pago || 0, d.moeda);
      const restante = Math.max(0, totalEUR - pagoEUR);
      const quitada  = pagoEUR >= totalEUR && totalEUR > 0;

      // Só conta no total as não quitadas
      if (!quitada) totalDividas += restante;

      const dataJson = JSON.stringify({ ...d }).replace(/'/g, "\\'");

      html += `
        <div class="card ${quitada ? 'pago-total' : ''}">
          <strong>${d.desc} ${quitada ? '<span class="badge-pago">✅ Quitada</span>' : ''}</strong>
          <p>${d.moeda} ${d.valorOriginal}</p>
          <small>€ ${fmt(totalEUR)} total · Resta € ${fmt(restante)}</small>

          ${renderProgress(pagoEUR, totalEUR)}

          <div class="actions">
            ${!quitada ? `<button class="btn-pagar" onclick='abrirModalPagamento("${i.id}", ${JSON.stringify(d)})'>💸 Pagar</button>` : ""}
            <button onclick="deletarItem('dividas','${i.id}','${d.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("lista-dividas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma dívida</p>";
    atualizarResumo();
  });
}

inicializar();
