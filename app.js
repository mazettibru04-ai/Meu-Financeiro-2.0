/**
 * app.js — Meu Financeiro 2.0
 * Sistema completo: receitas, despesas, dívidas, histórico, edição, exclusão,
 * modais, progress bar, collapse, câmbio EUR/BRL.
 *
 * ISOLAMENTO POR USUÁRIO:
 *   Todos os caminhos usam getCol() e getDoc() que injetam window.userId.
 *   O userId é definido pelo auth.js via onAuthStateChanged.
 *
 * NUNCA acesse o Firestore diretamente — use sempre getCol() e getDoc().
 */

import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
  getDocs,
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =====================
// HELPERS DE CAMINHO
// Toda operação Firestore passa por aqui.
// =====================
function getCol(nome) {
  if (!window.userId) { console.warn("getCol: userId não definido"); return null; }
  return collection(db, "usuarios", window.userId, nome);
}

function getDoc(nome, id) {
  if (!window.userId) { console.warn("getDoc: userId não definido"); return null; }
  return doc(db, "usuarios", window.userId, nome, id);
}

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

// =====================
// CÂMBIO
// =====================
async function pegarCambio() {
  try {
    const res  = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
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
  const ref = getCol("historico");
  if (!ref) return;
  try {
    await addDoc(ref, { acao, desc, valor: String(valor), moeda, criadoEm: Date.now() });
  } catch (e) {
    console.error("Histórico:", e);
  }
}

function iniciarStreamHistorico() {
  const ref = getCol("historico");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"), limit(30));
  const u = onSnapshot(q, (snap) => {
    if (snap.empty) {
      document.getElementById("lista-historico").innerHTML =
        "<p style='color:#94a3b8'>Nenhuma alteração ainda</p>";
      return;
    }

    let html = "";
    snap.forEach((i) => {
      const h    = i.data();
      const hora = new Date(h.criadoEm).toLocaleString("pt-BR");
      const icone = h.acao.split(" ")[0];
      const texto = h.acao.replace(/^\S+\s/, "");
      html += `
        <div class="historico-item">
          <div class="historico-icon">${icone}</div>
          <div class="historico-info">
            <div class="historico-acao">${texto} — ${h.desc}</div>
            <div class="historico-detalhe">${h.moeda !== "-" ? `${h.moeda} ${h.valor}` : ""} · ${hora}</div>
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

  const ref = getDoc("dividas", modalDividaId);
  if (!ref) return;

  await updateDoc(ref, { pago: novoPago });
  await registrarHistorico("💸 Pagamento realizado", data.desc, valorPagar, data.moeda);

  // Atualiza cache e recarrega modal com novos valores
  guardar(modalDividaId, { ...data, pago: novoPago });
  abrirModalPagamento(modalDividaId);
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

  const ref = getDoc("dividas", corrigirDividaId);
  if (!ref) return;

  await updateDoc(ref, { pago: novoValor });
  await registrarHistorico("🔧 Pagamento corrigido", data.desc, novoValor, data.moeda);

  guardar(corrigirDividaId, { ...data, pago: novoValor });
  fecharModal("modal-corrigir");
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

  const ref = getDoc(editColecao, editId);
  if (!ref) return;

  await updateDoc(ref, { desc, val, moeda, categoria: cat });
  await registrarHistorico("✏️ Lançamento editado", desc, val, moeda);

  fecharModal("modal-edicao");
};

// =====================
// DELETAR (receitas, despesas, dívidas)
// =====================
window.deletarItem = async function(colecao, id, desc) {
  if (!confirm(`Remover "${desc}"?\n\nEssa ação não pode ser desfeita.`)) return;

  const ref = getDoc(colecao, id);
  if (!ref) return;

  await deleteDoc(ref);
  await registrarHistorico(
    `🗑️ ${colecao === "receitas" ? "Receita" : colecao === "despesas" ? "Despesa" : "Dívida"} removida`,
    desc, "-", "-"
  );
};

// =====================
// ADD RECEITA
// =====================
window.addReceita = async function() {
  const ref = getCol("receitas");
  if (!ref) return alert("Faça login primeiro");

  const desc  = document.getElementById("r-desc").value.trim();
  const cat   = document.getElementById("r-cat").value;
  const val   = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(ref, { desc, categoria: cat, val, moeda, criadoEm: Date.now() });
  await registrarHistorico("➕ Receita adicionada", desc, val, moeda);

  document.getElementById("r-desc").value = "";
  document.getElementById("r-val").value  = "";
};

// =====================
// ADD DESPESA
// =====================
window.addDespesa = async function() {
  const ref = getCol("despesas");
  if (!ref) return alert("Faça login primeiro");

  const desc  = document.getElementById("d-desc").value.trim();
  const cat   = document.getElementById("d-cat").value;
  const val   = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(ref, { desc, categoria: cat, val, moeda, criadoEm: Date.now() });
  await registrarHistorico("➖ Despesa adicionada", desc, val, moeda);

  document.getElementById("d-desc").value = "";
  document.getElementById("d-val").value  = "";
};

// =====================
// ADD DÍVIDA
// =====================
window.addDivida = async function() {
  const ref = getCol("dividas");
  if (!ref) return alert("Faça login primeiro");

  const desc  = document.getElementById("div-desc").value.trim();
  const valor = Number(document.getElementById("div-valor").value);
  const moeda = document.getElementById("div-moeda").value;

  if (!desc || valor <= 0) return alert("Preencha corretamente");

  await addDoc(ref, { desc, valorOriginal: valor, moeda, pago: 0, criadoEm: Date.now() });
  await registrarHistorico("💳 Dívida adicionada", desc, valor, moeda);

  document.getElementById("div-desc").value  = "";
  document.getElementById("div-valor").value = "";
};

// =====================
// STREAM RECEITAS
// =====================
function iniciarStreamReceitas() {
  const ref = getCol("receitas");
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

      html += `
        <div class="card">
          <strong>${r.desc}</strong>
          <p>${r.categoria}</p>
          <p>${r.moeda} ${fmt(r.val)}</p>
          <small>€ ${fmt(v)}</small>
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
  const ref = getCol("despesas");
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

      html += `
        <div class="card">
          <strong>${d.desc}</strong>
          <p>${d.categoria}</p>
          <p>${d.moeda} ${fmt(d.val)}</p>
          <small>€ ${fmt(v)}</small>
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
  const ref = getCol("dividas");
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

      html += `
        <div class="card ${quitada ? "pago-total" : ""}">
          <strong>
            ${d.desc}
            ${quitada ? '<span class="badge-pago">✅ Quitada</span>' : ""}
          </strong>
          <p>${d.moeda} ${fmt(d.valorOriginal)} · Pago: ${d.moeda} ${fmt(d.pago || 0)}</p>
          <small>€ ${fmt(totalEUR)} total · Resta € ${fmt(restaEUR)}</small>
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
  iniciarStreamProdutos();
};

// ============================================================
// MÓDULO: PRODUTOS
// Coleção: usuarios/{userId}/produtos
// Não modifica nenhuma lógica existente do sistema.
// ============================================================

// Estado do módulo
let produtoEditId  = null; // null = novo produto, string = edição
let _skusEmCache   = {};   // { sku: docId } para validação rápida de duplicidade

// =====================
// FECHAR MODAL PRODUTO
// Registrado junto com os outros modais
// =====================
document.getElementById("modal-produto")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) fecharModalProduto();
});

window.fecharModalProduto = function() {
  document.getElementById("modal-produto")?.classList.remove("active");
  produtoEditId = null;
};

// =====================
// ABRIR MODAL — NOVO PRODUTO
// =====================
window.abrirModalNovoProduto = function() {
  produtoEditId = null;

  // Limpa todos os campos
  document.getElementById("p-nome").value         = "";
  document.getElementById("p-sku").value          = "";
  document.getElementById("p-preco").value        = "";
  document.getElementById("p-custo").value        = "";
  document.getElementById("p-estoque").value      = "0";
  document.getElementById("p-categoria").value    = "Geral";
  document.getElementById("p-ativo").checked      = true;
  document.getElementById("p-controla-estoque").checked = true;

  document.getElementById("produto-modal-titulo").textContent = "➕ Novo Produto";
  document.getElementById("p-sku").disabled = false;
  document.getElementById("modal-produto").classList.add("active");
};

// =====================
// ABRIR MODAL — EDITAR PRODUTO
// =====================
window.abrirModalEditarProduto = function(id) {
  const data = recuperar(id);
  if (!data) return;

  produtoEditId = id;

  document.getElementById("p-nome").value         = data.nome        || "";
  document.getElementById("p-sku").value          = data.sku         || "";
  document.getElementById("p-preco").value        = data.precoVenda  ?? "";
  document.getElementById("p-custo").value        = data.custo       ?? "";
  document.getElementById("p-estoque").value      = data.estoqueAtual ?? 0;
  document.getElementById("p-categoria").value    = data.categoria   || "Geral";
  document.getElementById("p-ativo").checked      = data.ativo !== false;
  document.getElementById("p-controla-estoque").checked = data.controlaEstoque !== false;

  document.getElementById("produto-modal-titulo").textContent = "✏️ Editar Produto";
  // SKU não pode ser alterado após criação (evita colisões de índice)
  document.getElementById("p-sku").disabled = true;

  document.getElementById("modal-produto").classList.add("active");
};

// =====================
// VALIDAR SKU ÚNICO
// Consulta os SKUs já armazenados em cache local para resposta imediata.
// Fallback para Firestore caso o cache ainda não esteja populado.
// =====================
async function skuJaExiste(sku, excludeId = null) {
  // Verifica no cache primeiro (rápido, sem round-trip)
  for (const [docId, docSku] of Object.entries(_skusEmCache)) {
    if (docSku.toLowerCase() === sku.toLowerCase() && docId !== excludeId) {
      return true;
    }
  }

  // Fallback Firestore — garante consistência mesmo antes do stream carregar
  const ref = getCol("produtos");
  if (!ref) return false;

  const q    = query(ref, where("sku", "==", sku.trim()));
  const snap = await getDocs(q);

  for (const d of snap.docs) {
    if (d.id !== excludeId) return true;
  }

  return false;
}

// =====================
// SALVAR PRODUTO (novo ou edição)
// =====================
window.salvarProduto = async function() {
  const ref = getCol("produtos");
  if (!ref) return alert("Faça login primeiro");

  const nome      = document.getElementById("p-nome").value.trim();
  const sku       = document.getElementById("p-sku").value.trim().toUpperCase();
  const precoVenda = Number(document.getElementById("p-preco").value);
  const custo      = Number(document.getElementById("p-custo").value) || 0;
  const estoqueAtual = Number(document.getElementById("p-estoque").value) || 0;
  const categoria  = document.getElementById("p-categoria").value;
  const ativo      = document.getElementById("p-ativo").checked;
  const controlaEstoque = document.getElementById("p-controla-estoque").checked;

  // Validações
  if (!nome)           return alert("Informe o nome do produto");
  if (!sku)            return alert("Informe o SKU do produto");
  if (precoVenda <= 0) return alert("Preço de venda deve ser maior que zero");

  // Validação de SKU único (apenas no cadastro; edição mantém o mesmo SKU)
  if (!produtoEditId) {
    const duplicado = await skuJaExiste(sku);
    if (duplicado) return alert(`SKU "${sku}" já está em uso. Escolha outro.`);
  }

  const payload = {
    nome,
    sku,
    precoVenda,
    custo,
    estoqueAtual,
    categoria,
    ativo,
    controlaEstoque
  };

  if (produtoEditId) {
    // EDIÇÃO
    const docR = getDoc("produtos", produtoEditId);
    if (!docR) return;

    if (!confirm(`Confirmar edição de "${nome}"?`)) return;

    await updateDoc(docR, payload);
    await registrarHistorico("✏️ Produto editado", nome, precoVenda, "BRL");
  } else {
    // NOVO
    await addDoc(ref, { ...payload, criadoEm: Date.now() });
    await registrarHistorico("📦 Produto adicionado", nome, precoVenda, "BRL");
  }

  fecharModalProduto();
};

// =====================
// TOGGLE ATIVO/INATIVO
// Não exclui o produto — apenas alterna o campo `ativo`.
// =====================
window.toggleAtivoProduto = async function(id) {
  const data = recuperar(id);
  if (!data) return;

  const novoStatus = !data.ativo;
  const acao       = novoStatus ? "ativar" : "desativar";

  if (!confirm(`Deseja ${acao} o produto "${data.nome}"?`)) return;

  const docR = getDoc("produtos", id);
  if (!docR) return;

  await updateDoc(docR, { ativo: novoStatus });
  await registrarHistorico(
    novoStatus ? "✅ Produto ativado" : "⏸️ Produto desativado",
    data.nome, "-", "-"
  );

  // Atualiza cache imediatamente para refletir na UI sem esperar o snapshot
  guardar(id, { ...data, ativo: novoStatus });
};

// =====================
// DELETAR PRODUTO
// =====================
window.deletarProduto = async function(id) {
  const data = recuperar(id);
  if (!data) return;

  if (!confirm(
    `Remover o produto "${data.nome}" (SKU: ${data.sku})?\n\nEssa ação não pode ser desfeita.`
  )) return;

  const docR = getDoc("produtos", id);
  if (!docR) return;

  await deleteDoc(docR);
  await registrarHistorico("🗑️ Produto removido", data.nome, "-", "-");

  // Remove do cache de SKUs
  delete _skusEmCache[id];
};

// =====================
// RENDER — card de produto
// =====================
function renderCardProduto(id, p) {
  const nomeEsc = p.nome.replace(/'/g, "\\'");
  const margem  = p.precoVenda > 0 && p.custo > 0
    ? (((p.precoVenda - p.custo) / p.precoVenda) * 100).toFixed(1)
    : null;

  const statusBadge = p.ativo
    ? `<span class="badge-pago">✅ Ativo</span>`
    : `<span style="display:inline-block;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.3);font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;margin-left:6px;vertical-align:middle">⏸ Inativo</span>`;

  const estoqueInfo = p.controlaEstoque
    ? `<p style="margin:4px 0"><small>Estoque: <strong style="color:${p.estoqueAtual > 0 ? "#22c55e" : "#ef4444"}">${p.estoqueAtual} un</strong></small></p>`
    : `<p><small style="color:#475569">Sem controle de estoque</small></p>`;

  const margemInfo = margem !== null
    ? `<small style="color:#94a3b8">Margem: ${margem}%</small>`
    : "";

  return `
    <div class="card ${!p.ativo ? "pago-total" : ""}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px">
        <strong>${p.nome} ${statusBadge}</strong>
        <span style="font-size:11px;background:rgba(56,189,248,0.1);color:#38bdf8;padding:2px 8px;border-radius:99px;border:1px solid rgba(56,189,248,0.2);white-space:nowrap;flex-shrink:0">
          SKU: ${p.sku}
        </span>
      </div>
      <p style="color:#64748b;font-size:12px;margin-bottom:6px">${p.categoria}</p>
      <p>Preço: <strong>R$ ${fmt(p.precoVenda)}</strong>${p.custo > 0 ? ` · Custo: R$ ${fmt(p.custo)}` : ""}</p>
      ${estoqueInfo}
      ${margemInfo}
      <div class="actions">
        <button class="btn-editar"  onclick="abrirModalEditarProduto('${id}')">✏️ Editar</button>
        <button class="${p.ativo ? "btn-corrigir" : "btn-pagar"}" onclick="toggleAtivoProduto('${id}')">${p.ativo ? "⏸ Desativar" : "▶ Ativar"}</button>
        <button class="btn-remover" onclick="deletarProduto('${id}')">🗑️ Remover</button>
      </div>
    </div>`;
}

// =====================
// FILTRAR PRODUTOS (busca em tempo real na lista local)
// =====================
window.filtrarProdutos = function() {
  const busca    = document.getElementById("p-busca")?.value.toLowerCase().trim() || "";
  const filtroSt = document.getElementById("p-filtro-status")?.value || "todos";
  const filtroCat = document.getElementById("p-filtro-cat")?.value || "todas";

  // Recupera todos os produtos do cache via _skusEmCache
  const ids = Object.keys(_skusEmCache);
  let html  = "";
  let count = 0;

  for (const id of ids) {
    const p = recuperar(id);
    if (!p || p.__tipo !== "produto") continue;

    const matchBusca = !busca ||
      p.nome.toLowerCase().includes(busca) ||
      p.sku.toLowerCase().includes(busca)  ||
      (p.categoria || "").toLowerCase().includes(busca);

    const matchStatus = filtroSt === "todos" ||
      (filtroSt === "ativo" && p.ativo) ||
      (filtroSt === "inativo" && !p.ativo);

    const matchCat = filtroCat === "todas" || p.categoria === filtroCat;

    if (matchBusca && matchStatus && matchCat) {
      html += renderCardProduto(id, p);
      count++;
    }
  }

  document.getElementById("count-produtos").textContent  = count || "";
  document.getElementById("lista-produtos").innerHTML    =
    html || "<p style='color:#94a3b8'>Nenhum produto encontrado</p>";
};

// =====================
// STREAM PRODUTOS
// =====================
function iniciarStreamProdutos() {
  const ref = getCol("produtos");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    // Reseta cache de SKUs para este usuário
    for (const key of Object.keys(_skusEmCache)) delete _skusEmCache[key];

    let html        = "";
    let totalAtivos = 0;

    snap.forEach((i) => {
      const p = i.data();
      guardar(i.id, { ...p, __tipo: "produto" }); // marca no cache para filtrarProdutos
      _skusEmCache[i.id] = p.sku;

      if (p.ativo) totalAtivos++;
      html += renderCardProduto(i.id, p);
    });

    document.getElementById("count-produtos").textContent  = snap.size || "";
    document.getElementById("lista-produtos").innerHTML    =
      html || "<p style='color:#94a3b8'>Nenhum produto cadastrado</p>";

    // Resumo do módulo
    const elTotal  = document.getElementById("stat-produtos-total");
    const elAtivos = document.getElementById("stat-produtos-ativos");
    if (elTotal)  elTotal.textContent  = snap.size;
    if (elAtivos) elAtivos.textContent = totalAtivos;
  });

  unsubs.push(u);
}
// ============================================================
// MÓDULO: VENDAS
// Arquitetura event-driven com controle de estoque
// ============================================================

// Estado do módulo
let vendaItens = []; // Array de itens da venda atual
let proximoNumeroVenda = 1;
let _produtosAtivos = []; // Cache de produtos ativos para busca rápida

// =====================
// FECHAR MODAL VENDA
// =====================
document.getElementById("modal-venda")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) fecharModalVenda();
});

window.fecharModalVenda = function() {
  document.getElementById("modal-venda")?.classList.remove("active");
  vendaItens = [];
  document.getElementById("v-cliente").value = "";
  document.getElementById("v-busca-produto").value = "";
  document.getElementById("v-produto-dropdown").style.display = "none";
  renderItensVenda();
};

// =====================
// ABRIR MODAL NOVA VENDA
// =====================
window.abrirModalNovaVenda = function() {
  vendaItens = [];
  document.getElementById("v-cliente").value = "";
  document.getElementById("v-busca-produto").value = "";
  document.getElementById("v-forma-pagamento").value = "Dinheiro";
  document.getElementById("v-status").value = "Pendente";
  document.getElementById("v-produto-dropdown").style.display = "none";
  renderItensVenda();
  document.getElementById("modal-venda").classList.add("active");
};

// =====================
// BUSCAR PRODUTO (autocomplete)
// =====================
window.buscarProdutoVenda = function() {
  const busca = document.getElementById("v-busca-produto").value.toLowerCase().trim();
  const dropdown = document.getElementById("v-produto-dropdown");

  if (!busca || busca.length < 2) {
    dropdown.style.display = "none";
    return;
  }

  const resultados = _produtosAtivos.filter(p => 
    p.nome.toLowerCase().includes(busca) || 
    p.sku.toLowerCase().includes(busca)
  ).slice(0, 8); // Máximo 8 resultados

  if (!resultados.length) {
    dropdown.innerHTML = `<div style="padding:12px;color:#94a3b8;font-size:13px">Nenhum produto encontrado</div>`;
    dropdown.style.display = "block";
    return;
  }

  let html = "";
  resultados.forEach(p => {
    const estoqueOk = p.estoqueAtual > 0;
    html += `
      <div onclick="adicionarItemVenda('${p._id}')" 
        style="padding:10px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);transition:background 0.2s"
        onmouseover="this.style.background='rgba(56,189,248,0.08)'"
        onmouseout="this.style.background='transparent'">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:13px;font-weight:600">${p.nome}</div>
            <div style="font-size:11px;color:#94a3b8">SKU: ${p.sku} · R$ ${fmt(p.precoVenda)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:${estoqueOk ? '#22c55e' : '#ef4444'};font-weight:600">
              ${estoqueOk ? `${p.estoqueAtual} un` : 'SEM ESTOQUE'}
            </div>
          </div>
        </div>
      </div>`;
  });

  dropdown.innerHTML = html;
  dropdown.style.display = "block";
};

// =====================
// ADICIONAR ITEM À VENDA
// =====================
window.adicionarItemVenda = function(produtoId) {
  const produto = _produtosAtivos.find(p => p._id === produtoId);
  if (!produto) return alert("Produto não encontrado");

  if (!produto.ativo) return alert("Produto inativo não pode ser vendido");
  if (produto.controlaEstoque && produto.estoqueAtual <= 0) 
    return alert(`Produto "${produto.nome}" sem estoque disponível`);

  // Verifica se já existe na lista
  const itemExistente = vendaItens.find(i => i.produtoId === produtoId);
  
  if (itemExistente) {
    const novaQtd = itemExistente.quantidade + 1;
    if (produto.controlaEstoque && novaQtd > produto.estoqueAtual) {
      return alert(`Estoque insuficiente. Disponível: ${produto.estoqueAtual} un`);
    }
    itemExistente.quantidade = novaQtd;
    itemExistente.subtotal = itemExistente.quantidade * itemExistente.preco;
  } else {
    vendaItens.push({
      produtoId: produtoId,
      nome: produto.nome,
      sku: produto.sku,
      preco: produto.precoVenda,
      quantidade: 1,
      subtotal: produto.precoVenda,
      controlaEstoque: produto.controlaEstoque,
      estoqueDisponivel: produto.estoqueAtual
    });
  }

  document.getElementById("v-busca-produto").value = "";
  document.getElementById("v-produto-dropdown").style.display = "none";
  renderItensVenda();
};

// =====================
// ALTERAR QUANTIDADE
// =====================
window.alterarQuantidadeItem = function(index, delta) {
  const item = vendaItens[index];
  if (!item) return;

  const novaQtd = item.quantidade + delta;
  if (novaQtd <= 0) return removerItemVenda(index);

  if (item.controlaEstoque && novaQtd > item.estoqueDisponivel) {
    return alert(`Estoque insuficiente. Disponível: ${item.estoqueDisponivel} un`);
  }

  item.quantidade = novaQtd;
  item.subtotal = item.quantidade * item.preco;
  renderItensVenda();
};

// =====================
// REMOVER ITEM
// =====================
window.removerItemVenda = function(index) {
  vendaItens.splice(index, 1);
  renderItensVenda();
};

// =====================
// RENDER ITENS DA VENDA
// =====================
function renderItensVenda() {
  const container = document.getElementById("v-itens-lista");
  const vazio = document.getElementById("v-itens-vazio");

  if (!vendaItens.length) {
    container.innerHTML = "";
    vazio.style.display = "block";
    document.getElementById("v-total").textContent = "R$ 0,00";
    return;
  }

  vazio.style.display = "none";
  let html = "";
  let total = 0;

  vendaItens.forEach((item, idx) => {
    total += item.subtotal;
    html += `
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${item.nome}</div>
            <div style="font-size:11px;color:#94a3b8">SKU: ${item.sku} · R$ ${fmt(item.preco)}/un</div>
          </div>
          <button onclick="removerItemVenda(${idx})" 
            style="width:auto;padding:4px 8px;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.2);font-size:11px;border-radius:6px">
            ✕
          </button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px">
            <button onclick="alterarQuantidadeItem(${idx}, -1)"
              style="width:28px;height:28px;padding:0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;font-size:16px;line-height:1">
              −
            </button>
            <span style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;min-width:30px;text-align:center">
              ${item.quantidade}
            </span>
            <button onclick="alterarQuantidadeItem(${idx}, 1)"
              style="width:28px;height:28px;padding:0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;font-size:16px;line-height:1">
              +
            </button>
          </div>
          <div style="font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#22c55e">
            R$ ${fmt(item.subtotal)}
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
  document.getElementById("v-total").textContent = `R$ ${fmt(total)}`;
}

// =====================
// SALVAR VENDA
// =====================
window.salvarVenda = async function() {
  const refVendas = getCol("vendas");
  const refMovimentos = getCol("movimentos_estoque");
  if (!refVendas || !refMovimentos) return alert("Faça login primeiro");

  if (!vendaItens.length) return alert("Adicione pelo menos um item à venda");

  const cliente = document.getElementById("v-cliente").value.trim() || "Cliente não informado";
  const formaPagamento = document.getElementById("v-forma-pagamento").value;
  const status = document.getElementById("v-status").value;

  const total = vendaItens.reduce((sum, item) => sum + item.subtotal, 0);

  if (!confirm(`Finalizar venda de R$ ${fmt(total)}?`)) return;

  try {
    // Cria a venda
    const vendaPayload = {
      numero: proximoNumeroVenda,
      cliente,
      itens: vendaItens.map(i => ({
        produtoId: i.produtoId,
        nome: i.nome,
        sku: i.sku,
        preco: i.preco,
        quantidade: i.quantidade,
        subtotal: i.subtotal
      })),
      total,
      formaPagamento,
      status,
      criadoEm: Date.now()
    };

    const vendaDoc = await addDoc(refVendas, vendaPayload);

    // Gera movimentos de estoque (saída)
    for (const item of vendaItens) {
      if (item.controlaEstoque) {
        await addDoc(refMovimentos, {
          tipo: "saida",
          origem: "venda",
          produtoId: item.produtoId,
          produtoNome: item.nome,
          quantidade: item.quantidade,
          referenciaId: vendaDoc.id,
          referenciaNumero: proximoNumeroVenda,
          criadoEm: Date.now()
        });

        // Atualiza estoque do produto
        const produtoRef = getDoc("produtos", item.produtoId);
        const produtoAtual = recuperar(item.produtoId);
        if (produtoRef && produtoAtual) {
          await updateDoc(produtoRef, {
            estoqueAtual: produtoAtual.estoqueAtual - item.quantidade
          });
        }
      }
    }

    // Se status = Pago, gera receita automática
    if (status === "Pago") {
      const refReceitas = getCol("receitas");
      if (refReceitas) {
        await addDoc(refReceitas, {
          desc: `Venda #${proximoNumeroVenda} - ${cliente}`,
          categoria: "Vendas",
          val: total,
          moeda: "BRL",
          origemId: vendaDoc.id,
          origemTipo: "venda",
          criadoEm: Date.now()
        });
      }
    }

    await registrarHistorico("🛒 Venda realizada", `#${proximoNumeroVenda} - ${cliente}`, total, "BRL");

    alert(`✅ Venda #${proximoNumeroVenda} finalizada com sucesso!`);
    fecharModalVenda();

  } catch (e) {
    console.error(e);
    alert("Erro ao salvar venda: " + e.message);
  }
};

// =====================
// MARCAR VENDA COMO PAGA
// =====================
window.marcarVendaPaga = async function(vendaId) {
  const venda = recuperar(vendaId);
  if (!venda) return;

  if (venda.status === "Pago") return alert("Venda já está paga");
  if (venda.status === "Cancelado") return alert("Venda cancelada não pode ser paga");

  if (!confirm(`Marcar venda #${venda.numero} como paga?`)) return;

  const refVenda = getDoc("vendas", vendaId);
  if (!refVenda) return;

  await updateDoc(refVenda, { status: "Pago" });

  // Gera receita no financeiro
  const refReceitas = getCol("receitas");
  if (refReceitas) {
    await addDoc(refReceitas, {
      desc: `Venda #${venda.numero} - ${venda.cliente}`,
      categoria: "Vendas",
      val: venda.total,
      moeda: "BRL",
      origemId: vendaId,
      origemTipo: "venda",
      criadoEm: Date.now()
    });
  }

  await registrarHistorico("💰 Venda paga", `#${venda.numero}`, venda.total, "BRL");
};

// =====================
// CANCELAR VENDA (reverte estoque)
// =====================
window.cancelarVenda = async function(vendaId) {
  const venda = recuperar(vendaId);
  if (!venda) return;

  if (venda.status === "Cancelado") return alert("Venda já está cancelada");

  if (!confirm(
    `Cancelar venda #${venda.numero}?\n\n` +
    `Isso reverterá ${venda.itens.length} item(ns) ao estoque.`
  )) return;

  const refVenda = getDoc("vendas", vendaId);
  const refMovimentos = getCol("movimentos_estoque");
  if (!refVenda || !refMovimentos) return;

  try {
    // Reverte estoque
    for (const item of venda.itens) {
      const produto = recuperar(item.produtoId);
      if (!produto || !produto.controlaEstoque) continue;

      // Movimento de entrada (reversão)
      await addDoc(refMovimentos, {
        tipo: "entrada",
        origem: "cancelamento_venda",
        produtoId: item.produtoId,
        produtoNome: item.nome,
        quantidade: item.quantidade,
        referenciaId: vendaId,
        referenciaNumero: venda.numero,
        criadoEm: Date.now()
      });

      // Atualiza estoque do produto
      const produtoRef = getDoc("produtos", item.produtoId);
      await updateDoc(produtoRef, {
        estoqueAtual: produto.estoqueAtual + item.quantidade
      });
    }

    await updateDoc(refVenda, { status: "Cancelado" });
    await registrarHistorico("❌ Venda cancelada", `#${venda.numero}`, venda.total, "BRL");

    alert("Venda cancelada e estoque revertido");

  } catch (e) {
    console.error(e);
    alert("Erro ao cancelar venda: " + e.message);
  }
};

// =====================
// RENDER CARD VENDA
// =====================
function renderCardVenda(id, v) {
  const statusBadge = v.status === "Pago" 
    ? `<span class="badge-pago">✅ Pago</span>`
    : v.status === "Cancelado"
    ? `<span style="display:inline-block;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.3);font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px">❌ Cancelado</span>`
    : `<span style="display:inline-block;background:rgba(245,158,11,0.15);color:#fcd34d;border:1px solid rgba(245,158,11,0.3);font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px">⏳ Pendente</span>`;

  const dataVenda = new Date(v.criadoEm).toLocaleDateString("pt-BR");

  let itensHTML = "";
  v.itens.forEach(i => {
    itensHTML += `<div style="font-size:12px;color:#94a3b8;margin:2px 0">• ${i.quantidade}x ${i.nome} - R$ ${fmt(i.subtotal)}</div>`;
  });

  return `
    <div class="card ${v.status === "Cancelado" ? "pago-total" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <strong>Venda #${v.numero} ${statusBadge}</strong>
          <p style="color:#64748b;font-size:12px;margin:4px 0">${v.cliente}</p>
          <p style="font-size:11px;color:#475569">${dataVenda} · ${v.formaPagamento}</p>
        </div>
        <div style="text-align:right">
          <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:#22c55e">
            R$ ${fmt(v.total)}
          </div>
          <div style="font-size:11px;color:#94a3b8">${v.itens.length} item(ns)</div>
        </div>
      </div>
      
      <div style="background:rgba(255,255,255,0.02);border-radius:8px;padding:8px;margin:10px 0">
        ${itensHTML}
      </div>

      <div class="actions">
        ${v.status === "Pendente" ? `<button class="btn-pagar" onclick="marcarVendaPaga('${id}')">💰 Marcar como Pago</button>` : ""}
        ${v.status !== "Cancelado" ? `<button class="btn-remover" onclick="cancelarVenda('${id}')">❌ Cancelar</button>` : ""}
      </div>
    </div>`;
}

// =====================
// FILTRAR VENDAS
// =====================
window.filtrarVendas = function() {
  const busca = document.getElementById("vendas-busca")?.value.toLowerCase().trim() || "";
  const filtroStatus = document.getElementById("vendas-filtro-status")?.value || "todos";

  const vendas = Object.keys(_cache)
    .map(id => ({ _id: id, ...recuperar(id) }))
    .filter(v => v.__tipo === "venda");

  const filtrado = vendas.filter(v => {
    const matchBusca = !busca || v.cliente.toLowerCase().includes(busca);
    const matchStatus = filtroStatus === "todos" || v.status === filtroStatus;
    return matchBusca && matchStatus;
  });

  if (!filtrado.length) {
    document.getElementById("lista-vendas").innerHTML = `<p style='color:#94a3b8'>Nenhuma venda encontrada</p>`;
    document.getElementById("count-vendas").textContent = "";
    return;
  }

  let html = "";
  filtrado.forEach(v => html += renderCardVenda(v._id, v));

  document.getElementById("lista-vendas").innerHTML = html;
  document.getElementById("count-vendas").textContent = filtrado.length || "";
};

// =====================
// STREAM VENDAS
// =====================
function iniciarStreamVendas() {
  const ref = getCol("vendas");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    let html = "";
    let totalVendas = 0;
    let valorTotal = 0;
    let pendentes = 0;

    // Atualiza próximo número
    let maiorNumero = 0;
    snap.forEach(i => {
      const v = i.data();
      if (v.numero > maiorNumero) maiorNumero = v.numero;
      guardar(i.id, { ...v, __tipo: "venda" });

      totalVendas++;
      if (v.status === "Pago") valorTotal += v.total;
      if (v.status === "Pendente") pendentes++;

      html += renderCardVenda(i.id, v);
    });

    proximoNumeroVenda = maiorNumero + 1;

    document.getElementById("count-vendas").textContent = totalVendas || "";
    document.getElementById("lista-vendas").innerHTML = 
      html || "<p style='color:#94a3b8'>Nenhuma venda cadastrada</p>";

    document.getElementById("stat-vendas-total").textContent = totalVendas;
    document.getElementById("stat-vendas-valor").textContent = `R$ ${fmt(valorTotal)}`;
    document.getElementById("stat-vendas-pendentes").textContent = pendentes;
  });

  unsubs.push(u);
}

// =====================
// CACHE DE PRODUTOS ATIVOS (para busca rápida)
// =====================
function atualizarCacheProdutosAtivos() {
  _produtosAtivos = Object.keys(_cache)
    .map(id => ({ _id: id, ...recuperar(id) }))
    .filter(p => p.__tipo === "produto" && p.ativo);
}

// ============================================================
// FIM MÓDULO VENDAS
// ============================================================
// ============================================================
// FIM MÓDULO PRODUTOS
// ============================================================
