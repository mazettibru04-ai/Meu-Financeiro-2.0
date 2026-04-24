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
  limit
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
// =====================
// PRODUTOS — MODAL NOVO
// =====================
window.abrirModalNovoProduto = function () {
  document.getElementById("produto-modal-titulo").textContent = "➕ Novo Produto";

  // limpa campos
  document.getElementById("p-nome").value = "";
  document.getElementById("p-sku").value = "";
  document.getElementById("p-preco").value = "";
  document.getElementById("p-custo").value = "";
  document.getElementById("p-estoque").value = 0;
  document.getElementById("p-categoria").value = "Geral";
  document.getElementById("p-ativo").checked = true;
  document.getElementById("p-controla-estoque").checked = true;

  document.getElementById("modal-produto").classList.add("active");
};

// =====================
// FECHAR MODAL PRODUTO
// =====================
window.fecharModalProduto = function () {
  document.getElementById("modal-produto").classList.remove("active");
};

// =====================
// SALVAR PRODUTO
// =====================
window.salvarProduto = async function () {
  const ref = getCol("produtos");
  if (!ref) return alert("Faça login primeiro");

  const nome = document.getElementById("p-nome").value.trim();
  const sku = document.getElementById("p-sku").value.trim().toUpperCase();
  const preco = Number(document.getElementById("p-preco").value);
  const custo = Number(document.getElementById("p-custo").value) || 0;
  const estoque = Number(document.getElementById("p-estoque").value) || 0;
  const categoria = document.getElementById("p-categoria").value;
  const ativo = document.getElementById("p-ativo").checked;
  const controlaEstoque = document.getElementById("p-controla-estoque").checked;

  if (!nome || !sku || preco <= 0) {
    return alert("Preencha nome, SKU e preço corretamente");
  }

  await addDoc(ref, {
    nome,
    sku,
    preco,
    custo,
    estoque,
    categoria,
    ativo,
    controlaEstoque,
    criadoEm: Date.now()
  });

  await registrarHistorico("📦 Produto criado", nome, preco, "€");

  fecharModalProduto();
};
// =====================
// STREAM PRODUTOS
// =====================
function iniciarStreamProdutos() {
  const ref = getCol("produtos");
  if (!ref) return;

  const q = query(ref, orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    let html = "";
    let total = 0;
    let ativos = 0;

    snap.forEach((i) => {
      const p = i.data();
      total++;
      if (p.ativo) ativos++;

      guardar(i.id, p);

      const descEsc = p.nome.replace(/'/g, "\\'");

      html += `
        <div class="card">
          <strong>${p.nome}</strong>
          <p>SKU: ${p.sku}</p>
          <p>€ ${fmt(p.preco)}</p>
          <small>Estoque: ${p.estoque}</small>

          <div class="actions">
            <button onclick="deletarItem('produtos','${i.id}','${descEsc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("lista-produtos").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhum produto</p>";

    document.getElementById("count-produtos").textContent = snap.size || "";
    document.getElementById("stat-produtos-total").textContent = total;
    document.getElementById("stat-produtos-ativos").textContent = ativos;
  });

  unsubs.push(u);
}
