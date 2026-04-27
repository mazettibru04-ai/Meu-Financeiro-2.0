/**
 * app.js — Meu Financeiro 2.0
 * Sistema completo: receitas, despesas, dívidas, histórico, edição, exclusão,
 * modais, progress bar, collapse, câmbio EUR/BRL.
 *
 * ISOLAMENTO POR USUÁRIO:
 *   Todos os caminhos usam getUserCollection() e getUserDoc() que injetam window.userId.
 *   O userId é definido pelo auth.js via onAuthStateChanged.
 *
 * NUNCA acesse o Firestore diretamente — use sempre getUserCollection() e getUserDoc().
 */

import {
  addDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getUserCollection, getUserDoc } from "./modules/firestorePaths.js";
import { fetchCambioSummary } from "./modules/cambioService.js";
import { escapeHtml, runSafely } from "./modules/security.js";

// =====================
// HELPERS DE CAMINHO
// Toda operação Firestore passa por getUserCollection/getUserDoc.
// =====================

// =====================
// CACHE GLOBAL
// Armazena dados dos docs para usar nos modais sem passar JSON no onclick.
// =====================
const _cache = {};
const guardar   = (id, data) => { _cache[id] = data; };
const recuperar = (id)       => _cache[id] || null;

// =====================
// ESTADO
// =====================
let taxa          = 0;
let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas  = 0;

// Modal state
let modalDividaId    = null;
let corrigirDividaId = null;
let editId           = null;
let editColecao      = null;

// Unsubscribers dos listeners (para cancelar ao fazer logout)
const unsubs = [];

let chart;

// =====================
// UTILS
// =====================
function fmt(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function eur(v, m) {
  if (m === "EUR") return Number(v);
  if (m === "BRL" && taxa > 0) return Number(v) / taxa;
  return Number(v);
}

function brl(valorEur) {
  return taxa > 0 ? valorEur * taxa : null;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildDateMeta(now = new Date()) {
  return {
    createdAt: serverTimestamp(),
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  };
}

function parseDateKey(dateKey) {
  const [y, m, d] = String(dateKey || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toDateMeta(data) {
  if (data?.date && data?.time) return { date: data.date, time: data.time };

  if (Number.isFinite(data?.criadoEm)) {
    const base = new Date(data.criadoEm);
    return {
      date: `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`,
      time: `${pad2(base.getHours())}:${pad2(base.getMinutes())}:${pad2(base.getSeconds())}`
    };
  }

  const now = new Date();
  return {
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  };
}

function toUpdatedMeta(data) {
  if (data?.updatedDate && data?.updatedTime) {
    return { date: data.updatedDate, time: data.updatedTime };
  }
  return null;
}

function dayLabel(dateKey) {
  const date = parseDateKey(dateKey);
  if (!date) return "Data indisponível";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  if (target.getTime() === today.getTime()) return "Hoje";
  if (target.getTime() === yesterday.getTime()) return "Ontem";

  return target.toLocaleDateString("pt-BR");
}

function parseMetaDateTime(meta) {
  const safeDate = String(meta?.date || "");
  const safeTime = String(meta?.time || "00:00:00");
  const parsed = new Date(`${safeDate}T${safeTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTimeProfessional(meta) {
  const parsed = parseMetaDateTime(meta);
  if (!parsed) return "Data indisponível";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

  const data = parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const hora = parsed.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  if (target.getTime() === today.getTime()) return `Hoje às ${hora}`;
  if (target.getTime() === yesterday.getTime()) return `Ontem às ${hora}`;
  return `${data} às ${hora}`;
}

function formatCreatedLabel(meta) {
  const parsed = parseMetaDateTime(meta);
  if (!parsed) return "🟢 Adicionado: Data indisponível";
  const base = formatDateTimeProfessional(meta);
  return `🟢 Adicionado: ${base}`;
}

function formatUpdatedLabel(meta) {
  if (!meta) return "";
  const parsed = parseMetaDateTime(meta);
  if (!parsed) return "🕓 Atualizado em: Data indisponível";
  return `🕓 Atualizado em: ${formatDateTimeProfessional(meta)}`;
}

function formatDateTimePt(date, time) {
  return formatDateTimeProfessional({ date, time });
}

function getParcelasHistorico(data) {
  if (!Array.isArray(data?.pagamentosHistorico)) return [];
  return [...data.pagamentosHistorico]
    .filter((item) => Number(item?.valor) > 0)
    .sort((a, b) => Number(b?.criadoEm || 0) - Number(a?.criadoEm || 0));
}

function renderParcelasHistorico(data) {
  const lista = document.getElementById("lista-parcelas");
  const count = document.getElementById("parcelas-count");
  const btnUndo = document.getElementById("btn-desfazer-parcela");
  if (!lista || !count) return;

  const parcelas = getParcelasHistorico(data);
  count.textContent = String(parcelas.length);
  if (btnUndo) btnUndo.disabled = parcelas.length === 0;

  if (!parcelas.length) {
    lista.innerHTML = `<p class="parcelas-empty">Nenhum pagamento registrado</p>`;
    return;
  }

  const html = parcelas.map((p) => {
    const valor = `${escapeHtml(data.moeda)} ${fmt(p.valor)}`;
    const dt = escapeHtml(formatDateTimePt(p.date, p.time));
    return `
      <div class="parcela-item">
        <span class="parcela-valor">💸 ${valor}</span>
        <span class="parcela-data">${dt}</span>
      </div>
    `;
  }).join("");

  lista.innerHTML = html;
}

window.desfazerUltimaParcela = async function() {
  if (!modalDividaId) return;
  const data = recuperar(modalDividaId);
  if (!data) return;

  const parcelas = getParcelasHistorico(data);
  if (!parcelas.length) return alert("Não há parcelas para desfazer.");

  const ultima = parcelas[0];
  if (!confirm(
    `Desfazer a última parcela?\n` +
    `Valor: ${data.moeda} ${fmt(ultima.valor)}\n` +
    `Data: ${formatDateTimePt(ultima.date, ultima.time)}`
  )) return;

  const restantes = parcelas.slice(1);
  const novoPago = restantes.reduce((acc, item) => acc + Number(item.valor || 0), 0);
  const ref = getUserDoc("dividas", modalDividaId);
  if (!ref) return;

  await runSafely(async () => {
    await updateDoc(ref, {
      pago: novoPago,
      pagamentosHistorico: restantes,
      ...buildUpdatedMeta()
    });

    await registrarHistorico("↩ Parcela desfeita", data.desc, ultima.valor, data.moeda);
    guardar(modalDividaId, { ...data, pago: novoPago, pagamentosHistorico: restantes });
    abrirModalPagamento(modalDividaId);
  }, "Falha ao desfazer parcela");
};

function buildUpdatedMeta(now = new Date()) {
  return {
    updatedAt: serverTimestamp(),
    updatedDate: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    updatedTime: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  };
}

// =====================
// CÂMBIO
// =====================
async function pegarCambio() {
  try {
    const { today, history } = await fetchCambioSummary();
    taxa = today;

    const cambioEl = document.getElementById("cambio");
    const d7El = document.getElementById("cambio-7d");
    const d15El = document.getElementById("cambio-15d");
    const d30El = document.getElementById("cambio-30d");
    const tendenciaEl = document.getElementById("cambio-tendencia");

    cambioEl.innerText = `Hoje: €1 = R$ ${fmt(today)}`;
    d7El.innerText = `7 dias atrás: €1 = R$ ${fmt(history.d7)}`;
    d15El.innerText = `15 dias atrás: €1 = R$ ${fmt(history.d15)}`;
    d30El.innerText = `30 dias atrás: €1 = R$ ${fmt(history.d30)}`;

    const diff = today - history.d7;
    if (diff > 0) {
      tendenciaEl.innerHTML = `Tendência: <span class="trend-up">↑ em alta</span>`;
    } else if (diff < 0) {
      tendenciaEl.innerHTML = `Tendência: <span class="trend-down">↓ em queda</span>`;
    } else {
      tendenciaEl.innerHTML = `Tendência: <span class="trend-flat">→ estável</span>`;
    }
  } catch {
    document.getElementById("cambio").innerText = "Erro ao carregar câmbio";
    document.getElementById("cambio-7d").innerText = "7 dias atrás: indisponível";
    document.getElementById("cambio-15d").innerText = "15 dias atrás: indisponível";
    document.getElementById("cambio-30d").innerText = "30 dias atrás: indisponível";
    document.getElementById("cambio-tendencia").innerText = "Tendência: indisponível";
  }
}

// =====================
// RESUMO
// =====================
function atualizarResumo() {
  const saldo     = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  document.getElementById("total-receitas").innerText = `Receitas: € ${fmt(totalReceitas)}`;
  document.getElementById("total-despesas").innerText = `Despesas: € ${fmt(totalDespesas)}`;
  document.getElementById("total-dividas").innerText  = `Dívidas: € ${fmt(totalDividas)}`;
  document.getElementById("saldo").innerText          = `Saldo: € ${fmt(saldo)}`;
  document.getElementById("saldo-real").innerText     = `Saldo real (com dívidas): € ${fmt(saldoReal)}`;

  atualizarGrafico();
}

// =====================
// GRÁFICO
// =====================
function atualizarGrafico() {
  const ctx = document.getElementById("graficoFinanceiro");
  if (!ctx || !window.Chart) return;
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
// HISTÓRICO
// =====================
async function registrarHistorico(acao, desc, valor, moeda) {
  const ref = getUserCollection("historico");
  if (!ref) return;
  try {
    await addDoc(ref, { acao, desc, valor: String(valor), moeda, criadoEm: Date.now(), ...buildDateMeta() });
  } catch (e) {
    console.error("Histórico:", e);
  }
}

function iniciarStreamHistorico() {
  const ref = getUserCollection("historico");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"), limit(30));
  const u = onSnapshot(q, (snap) => {
    if (snap.empty) {
      document.getElementById("lista-historico").innerHTML =
        "<p style='color:#94a3b8'>Nenhuma alteração ainda</p>";
      return;
    }

    let html = "";
    let lastDay = null;
    snap.forEach((i) => {
      const h    = i.data();
      const meta = toDateMeta(h);
      const groupLabel = dayLabel(meta.date);
      const icone = escapeHtml(h.acao.split(" ")[0]);
      const texto = escapeHtml(h.acao.replace(/^\S+\s/, ""));
      const desc = escapeHtml(h.desc);

      if (groupLabel !== lastDay) {
        html += `<p class="historico-group">${groupLabel}</p>`;
        lastDay = groupLabel;
      }

      html += `
        <div class="historico-item">
          <div class="historico-icon">${icone}</div>
          <div class="historico-info">
            <div class="historico-acao">${texto} — ${desc}</div>
            <div class="historico-detalhe">${h.moeda !== "-" ? `${escapeHtml(h.moeda)} ${escapeHtml(h.valor)}` : ""} · ${escapeHtml(formatDateTimeProfessional(meta))}</div>
          </div>
        </div>`;
    });

    document.getElementById("lista-historico").innerHTML = html;
  });

  unsubs.push(u);
}

// =====================
// PROGRESS BAR
// =====================
function renderProgress(pago, total) {
  const pct    = Math.min(100, total > 0 ? Math.round((pago / total) * 100) : 0);
  const classe = pct >= 100 ? "done" : pct >= 50 ? "mid" : "low";
  const label  = pct >= 100 ? "✅ Pago!" : `${pct}% pago`;

  return `
    <div class="progress-wrap">
      <div class="progress-label">
        <span>Progresso</span>
        <span class="pct ${classe}">${label}</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill ${classe}" style="width:${pct}%"></div>
      </div>
    </div>`;
}

// =====================
// COLLAPSIBLE (setinhas)
// =====================
window.toggleSection = function(id) {
  document.getElementById(id)?.classList.toggle("collapsed");
  document.getElementById("chevron-" + id)?.classList.toggle("collapsed");
};

// =====================
// FECHAR MODAL
// =====================
window.fecharModal = function(id) {
  document.getElementById(id)?.classList.remove("active");
  if (id === "modal-pagamento") modalDividaId    = null;
  if (id === "modal-corrigir")  corrigirDividaId = null;
  if (id === "modal-edicao")    { editId = null; editColecao = null; }
};

// Fechar clicando fora
["modal-pagamento", "modal-corrigir", "modal-edicao"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", e => {
    if (e.target === e.currentTarget) fecharModal(id);
  });
});

// =====================
// MODAL PAGAMENTO — abrir
// =====================
window.abrirModalPagamento = function(id) {
  const data = recuperar(id);
  if (!data) return;
  modalDividaId = id;

  const totalEUR = eur(data.valorOriginal, data.moeda);
  const pagoEUR  = eur(data.pago || 0, data.moeda);
  const restaEUR = Math.max(0, totalEUR - pagoEUR);
  const pct      = Math.min(100, totalEUR > 0 ? Math.round((pagoEUR / totalEUR) * 100) : 0);

  document.getElementById("modal-nome").textContent       = data.desc;
  document.getElementById("modal-moeda-info").textContent = `${data.moeda} ${fmt(data.valorOriginal)}`;
  document.getElementById("modal-total").textContent      = `€ ${fmt(totalEUR)}`;
  document.getElementById("modal-pago").textContent       = `€ ${fmt(pagoEUR)}`;
  document.getElementById("modal-resta").textContent      = `€ ${fmt(restaEUR)}`;
  document.getElementById("modal-valor-pagar").value      = "";

  const circum   = 2 * Math.PI * 60; // r=60 → 377
  const ringFill = document.getElementById("ring-fill");
  const ringPct  = document.getElementById("ring-pct");
  const cor      = pct >= 100 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  ringFill.style.stroke           = cor;
  ringPct.style.color             = cor;
  ringFill.style.strokeDashoffset = circum;
  setTimeout(() => {
    ringFill.style.strokeDashoffset = circum - (pct / 100) * circum;
  }, 80);
  ringPct.textContent = `${pct}%`;
  renderParcelasHistorico(data);

  document.getElementById("modal-pagamento").classList.add("active");
};

// =====================
// MODAL PAGAMENTO — confirmar
// =====================
window.confirmarPagamento = async function() {
  if (!modalDividaId) return;
  const data = recuperar(modalDividaId);
  if (!data) return;

  const valorPagar = Number(document.getElementById("modal-valor-pagar").value);
  if (!valorPagar || valorPagar <= 0) return alert("Informe um valor válido");

  const pagoAtual = Number(data.pago) || 0;
  const novoPago  = pagoAtual + valorPagar;
  const total     = Number(data.valorOriginal);

  if (novoPago > total)
    return alert(`Máximo a pagar: ${data.moeda} ${fmt(total - pagoAtual)}`);

  const ref = getUserDoc("dividas", modalDividaId);
  if (!ref) return;

  const now = new Date();
  const parcela = {
    valor: valorPagar,
    date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
    criadoEm: now.getTime()
  };
  const historicoAtual = getParcelasHistorico(data);
  const novoHistorico = [parcela, ...historicoAtual];

  await runSafely(async () => {
    await updateDoc(ref, {
      pago: novoPago,
      pagamentosHistorico: novoHistorico,
      ...buildUpdatedMeta()
    });
    await registrarHistorico("💸 Pagamento realizado", data.desc, valorPagar, data.moeda);

    // Atualiza cache e recarrega modal com novos valores
    guardar(modalDividaId, { ...data, pago: novoPago, pagamentosHistorico: novoHistorico });
    abrirModalPagamento(modalDividaId);
  }, "Falha ao registrar pagamento");
};

// =====================
// MODAL CORRIGIR PAGAMENTO — abrir
// =====================
window.abrirModalCorrigir = function(id) {
  const data = recuperar(id);
  if (!data) return;
  corrigirDividaId = id;

  document.getElementById("corrigir-nome").textContent  = data.desc;
  document.getElementById("corrigir-total").textContent = `Total: ${data.moeda} ${fmt(data.valorOriginal)}`;
  document.getElementById("corrigir-atual").textContent = `Pago atual: ${data.moeda} ${fmt(data.pago || 0)}`;
  document.getElementById("corrigir-valor").value       = data.pago || 0;

  document.getElementById("modal-corrigir").classList.add("active");
};

// =====================
// MODAL CORRIGIR PAGAMENTO — salvar
// =====================
window.salvarCorrecao = async function() {
  if (!corrigirDividaId) return;
  const data = recuperar(corrigirDividaId);
  if (!data) return;

  const novoValor = Number(document.getElementById("corrigir-valor").value);
  if (novoValor < 0) return alert("Valor não pode ser negativo");
  if (novoValor > Number(data.valorOriginal))
    return alert(`Máximo: ${data.moeda} ${fmt(data.valorOriginal)}`);

  if (!confirm(
    `Corrigir pagamento de "${data.desc}"?\n` +
    `Antes: ${data.moeda} ${fmt(data.pago || 0)}\n` +
    `Depois: ${data.moeda} ${fmt(novoValor)}`
  )) return;

  const ref = getUserDoc("dividas", corrigirDividaId);
  if (!ref) return;

  await runSafely(async () => {
    await updateDoc(ref, { pago: novoValor, ...buildUpdatedMeta() });
    await registrarHistorico("🔧 Pagamento corrigido", data.desc, novoValor, data.moeda);

    guardar(corrigirDividaId, { ...data, pago: novoValor });
    fecharModal("modal-corrigir");
  }, "Falha ao corrigir pagamento");
};

// =====================
// MODAL EDIÇÃO — abrir
// =====================
window.abrirModalEdicao = function(colecao, id) {
  const data = recuperar(id);
  if (!data) return;

  editId      = id;
  editColecao = colecao;

  document.getElementById("edit-subtitle").textContent =
    `Editando: ${colecao === "receitas" ? "Receita" : "Despesa"}`;
  document.getElementById("edit-desc").value  = data.desc;
  document.getElementById("edit-val").value   = data.val;
  document.getElementById("edit-moeda").value = data.moeda;

  const catSelect = document.getElementById("edit-cat");
  catSelect.innerHTML = "";
  const opcoes = colecao === "receitas"
    ? ["Trabalho", "Freelance", "Investimentos", "Outros"]
    : ["Alimentação", "Transporte", "Moradia", "Lazer", "Saúde", "Outros"];

  opcoes.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.text  = o;
    if (o === data.categoria) opt.selected = true;
    catSelect.appendChild(opt);
  });

  catSelect.style.display = "block";
  document.getElementById("modal-edicao").classList.add("active");
};

// =====================
// MODAL EDIÇÃO — salvar
// =====================
window.salvarEdicao = async function() {
  if (!editId || !editColecao) return;

  const desc  = document.getElementById("edit-desc").value.trim();
  const val   = Number(document.getElementById("edit-val").value);
  const moeda = document.getElementById("edit-moeda").value;
  const cat   = document.getElementById("edit-cat").value;

  if (!desc || val <= 0) return alert("Preencha todos os campos corretamente");
  if (!confirm(`Confirmar alteração de "${desc}"?`)) return;

  const ref = getUserDoc(editColecao, editId);
  if (!ref) return;

  await runSafely(async () => {
    await updateDoc(ref, { desc, val, moeda, categoria: cat, ...buildUpdatedMeta() });
    await registrarHistorico("✏️ Lançamento editado", desc, val, moeda);
    fecharModal("modal-edicao");
  }, "Falha ao salvar edição");
};

// =====================
// DELETAR (receitas, despesas, dívidas)
// =====================
window.deletarItem = async function(colecao, id, desc) {
  if (!confirm(`Remover "${desc}"?\n\nEssa ação não pode ser desfeita.`)) return;

  const ref = getUserDoc(colecao, id);
  if (!ref) return;

  await runSafely(async () => {
    await deleteDoc(ref);
    await registrarHistorico(
      `🗑️ ${colecao === "receitas" ? "Receita" : colecao === "despesas" ? "Despesa" : "Dívida"} removida`,
      desc, "-", "-"
    );
  }, "Falha ao remover item");
};

// =====================
// ADD RECEITA
// =====================
window.addReceita = async function() {
  const ref = getUserCollection("receitas");
  if (!ref) return alert("Faça login primeiro");

  const desc  = document.getElementById("r-desc").value.trim();
  const cat   = document.getElementById("r-cat").value;
  const val   = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await runSafely(async () => {
    await addDoc(ref, { desc, categoria: cat, val, moeda, criadoEm: Date.now(), ...buildDateMeta() });
    await registrarHistorico("➕ Receita adicionada", desc, val, moeda);
    document.getElementById("r-desc").value = "";
    document.getElementById("r-val").value  = "";
  }, "Falha ao salvar receita");
};

// =====================
// ADD DESPESA
// =====================
window.addDespesa = async function() {
  const ref = getUserCollection("despesas");
  if (!ref) return alert("Faça login primeiro");

  const desc  = document.getElementById("d-desc").value.trim();
  const cat   = document.getElementById("d-cat").value;
  const val   = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await runSafely(async () => {
    await addDoc(ref, { desc, categoria: cat, val, moeda, criadoEm: Date.now(), ...buildDateMeta() });
    await registrarHistorico("➖ Despesa adicionada", desc, val, moeda);
    document.getElementById("d-desc").value = "";
    document.getElementById("d-val").value  = "";
  }, "Falha ao salvar despesa");
};

// =====================
// ADD DÍVIDA
// =====================
window.addDivida = async function() {
  const ref = getUserCollection("dividas");
  if (!ref) return alert("Faça login primeiro");

  const desc  = document.getElementById("div-desc").value.trim();
  const valor = Number(document.getElementById("div-valor").value);
  const moeda = document.getElementById("div-moeda").value;

  if (!desc || valor <= 0) return alert("Preencha corretamente");

  await runSafely(async () => {
    await addDoc(ref, { desc, valorOriginal: valor, moeda, pago: 0, criadoEm: Date.now(), ...buildDateMeta() });
    await registrarHistorico("💳 Dívida adicionada", desc, valor, moeda);
    document.getElementById("div-desc").value  = "";
    document.getElementById("div-valor").value = "";
  }, "Falha ao salvar dívida");
};

// =====================
// STREAM RECEITAS
// =====================
function iniciarStreamReceitas() {
  const ref = getUserCollection("receitas");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    totalReceitas = 0;
    let html = "";

    snap.forEach((i) => {
      const r = i.data();
      const v = eur(r.val, r.moeda);
      totalReceitas += v;
      guardar(i.id, r);

      const descEsc = r.desc.replace(/'/g, "\\'");
      const safeDesc = escapeHtml(r.desc);
      const safeCategoria = escapeHtml(r.categoria);
      const safeMoeda = escapeHtml(r.moeda);
      const meta = toDateMeta(r);
      const updatedMeta = toUpdatedMeta(r);
      const updatedLine = updatedMeta
        ? `<small class="meta-updated">${escapeHtml(formatUpdatedLabel(updatedMeta))}</small>`
        : "";

      html += `
        <div class="card">
          <strong>${safeDesc}</strong>
          <p>${safeCategoria}</p>
          <p>${safeMoeda} ${fmt(r.val)}</p>
          <small>€ ${fmt(v)}</small>
          <small class="meta-created">${escapeHtml(formatCreatedLabel(meta))}</small>
          ${updatedLine}
          <div class="actions">
            <button class="btn-editar" onclick="abrirModalEdicao('receitas','${i.id}')">✏️ Editar</button>
            <button class="btn-remover" onclick="deletarItem('receitas','${i.id}','${descEsc}')">🗑️ Remover</button>
          </div>
        </div>`;
    });

    document.getElementById("count-receitas").textContent = snap.size || "";
    document.getElementById("lista-receitas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma receita</p>";

    atualizarResumo();
  });

  unsubs.push(u);
}

// =====================
// STREAM DESPESAS
// =====================
function iniciarStreamDespesas() {
  const ref = getUserCollection("despesas");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    totalDespesas = 0;
    let html = "";

    snap.forEach((i) => {
      const d = i.data();
      const v = eur(d.val, d.moeda);
      totalDespesas += v;
      guardar(i.id, d);

      const descEsc = d.desc.replace(/'/g, "\\'");
      const safeDesc = escapeHtml(d.desc);
      const safeCategoria = escapeHtml(d.categoria);
      const safeMoeda = escapeHtml(d.moeda);
      const meta = toDateMeta(d);
      const updatedMeta = toUpdatedMeta(d);
      const updatedLine = updatedMeta
        ? `<small class="meta-updated">${escapeHtml(formatUpdatedLabel(updatedMeta))}</small>`
        : "";

      html += `
        <div class="card">
          <strong>${safeDesc}</strong>
          <p>${safeCategoria}</p>
          <p>${safeMoeda} ${fmt(d.val)}</p>
          <small>€ ${fmt(v)}</small>
          <small class="meta-created">${escapeHtml(formatCreatedLabel(meta))}</small>
          ${updatedLine}
          <div class="actions">
            <button class="btn-editar" onclick="abrirModalEdicao('despesas','${i.id}')">✏️ Editar</button>
            <button class="btn-remover" onclick="deletarItem('despesas','${i.id}','${descEsc}')">🗑️ Remover</button>
          </div>
        </div>`;
    });

    document.getElementById("count-despesas").textContent = snap.size || "";
    document.getElementById("lista-despesas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma despesa</p>";

    atualizarResumo();
  });

  unsubs.push(u);
}

// =====================
// STREAM DÍVIDAS
// =====================
function iniciarStreamDividas() {
  const ref = getUserCollection("dividas");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    totalDividas = 0;
    let html = "";

    snap.forEach((i) => {
      const d        = i.data();
      const totalEUR = eur(d.valorOriginal, d.moeda);
      const pagoEUR  = eur(d.pago || 0, d.moeda);
      const restaEUR = Math.max(0, totalEUR - pagoEUR);
      const quitada  = pagoEUR >= totalEUR && totalEUR > 0;

      if (!quitada) totalDividas += restaEUR;
      guardar(i.id, d);

      // Valor em BRL
      const totalBRL = brl(totalEUR);
      const restaBRL = brl(restaEUR);
      const brlLine  = totalBRL
        ? `<br><small style="color:#475569">R$ ${fmt(totalBRL)} total · Resta R$ ${fmt(restaBRL || 0)}</small>`
        : "";

      const descEsc = d.desc.replace(/'/g, "\\'");
      const safeDesc = escapeHtml(d.desc);
      const safeMoeda = escapeHtml(d.moeda);
      const meta = toDateMeta(d);
      const updatedMeta = toUpdatedMeta(d);
      const updatedLine = updatedMeta
        ? `<small class="meta-updated">${escapeHtml(formatUpdatedLabel(updatedMeta))}</small>`
        : "";

      html += `
        <div class="card ${quitada ? "pago-total" : ""}">
          <strong>
            ${safeDesc}
            ${quitada ? '<span class="badge-pago">✅ Quitada</span>' : ""}
          </strong>
          <p>${safeMoeda} ${fmt(d.valorOriginal)} · Pago: ${safeMoeda} ${fmt(d.pago || 0)}</p>
          <small>€ ${fmt(totalEUR)} total · Resta € ${fmt(restaEUR)}</small>
          <small class="meta-created">${escapeHtml(formatCreatedLabel(meta))}</small>
          ${updatedLine}
          ${brlLine}

          ${renderProgress(pagoEUR, totalEUR)}

          <div class="actions">
            ${!quitada ? `
              <button class="btn-pagar"    onclick="abrirModalPagamento('${i.id}')">💸 Pagar</button>
              <button class="btn-corrigir" onclick="abrirModalCorrigir('${i.id}')">🔧 Corrigir</button>
            ` : ""}
            <button class="btn-remover" onclick="deletarItem('dividas','${i.id}','${descEsc}')">🗑️ Remover</button>
          </div>
        </div>`;
    });

    document.getElementById("count-dividas").textContent = snap.size || "";
    document.getElementById("lista-dividas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma dívida</p>";

    atualizarResumo();
  });

  unsubs.push(u);
}

// =====================
// INICIALIZAR
// Chamado pelo auth.js quando o usuário faz login.
// window.iniciarApp é chamado do auth.js após definir window.userId.
// =====================
window.iniciarApp = async function() {
  // Cancela streams anteriores (caso de re-login)
  unsubs.forEach(u => u());
  unsubs.length = 0;

  // Reseta totais
  totalReceitas = totalDespesas = totalDividas = 0;

  await pegarCambio();

  iniciarStreamReceitas();
  iniciarStreamDespesas();
  iniciarStreamDividas();
  iniciarStreamHistorico();
};
