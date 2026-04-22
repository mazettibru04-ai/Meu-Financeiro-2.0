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
// CACHE GLOBAL DE DADOS
// Evita passar JSON em onclick e previne SyntaxError
// =====================
const _cache = {};

function guardar(id, data) {
  _cache[id] = data;
}

function recuperar(id) {
  return _cache[id] || null;
}

// =====================
// VARIÁVEIS GLOBAIS
// =====================
let taxa          = 0;
let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas  = 0;

let modalDividaId   = null;
let editId          = null;
let editColecao     = null;
let corrigirDividaId = null;

let chart;

// =====================
// FORMATAÇÃO
// =====================
function fmt(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// =====================
// CONVERSÃO
// =====================
function eur(v, m) {
  if (m === "EUR") return Number(v);
  if (m === "BRL" && taxa > 0) return Number(v) / taxa;
  return Number(v);
}

function brl(valorEur) {
  return taxa > 0 ? valorEur * taxa : null;
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
// RESUMO + GRÁFICO
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
// HISTÓRICO — FIRESTORE
// =====================
async function registrarHistorico(acao, desc, valor, moeda) {
  try {
    await addDoc(collection(db, "historico"), {
      acao, desc, valor: String(valor), moeda, criadoEm: Date.now()
    });
  } catch (e) {
    console.error("Erro ao gravar histórico:", e);
  }
}

function iniciarStreamHistorico() {
  const q = query(collection(db, "historico"), orderBy("criadoEm", "desc"), limit(30));
  onSnapshot(q, (snap) => {
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
        </div>
      `;
    });

    document.getElementById("lista-historico").innerHTML = html;
  });
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
    </div>
  `;
}

// =====================
// COLLAPSIBLE
// =====================
window.toggleSection = function (id) {
  const body    = document.getElementById(id);
  const chevron = document.getElementById("chevron-" + id);
  if (!body) return;
  body.classList.toggle("collapsed");
  chevron.classList.toggle("collapsed");
};

// =====================
// FECHAR MODAL
// =====================
window.fecharModal = function (id) {
  document.getElementById(id)?.classList.remove("active");
  if (id === "modal-pagamento")  { modalDividaId = null; }
  if (id === "modal-edicao")     { editId = null; editColecao = null; }
  if (id === "modal-corrigir")   { corrigirDividaId = null; }
};

["modal-pagamento", "modal-edicao", "modal-corrigir"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) fecharModal(id);
  });
});

// =====================
// MODAL PAGAMENTO — ABRIR
// =====================
window.abrirModalPagamento = function (id) {
  const data = recuperar(id);
  if (!data) return;

  modalDividaId = id;

  const totalEUR = eur(data.valorOriginal, data.moeda);
  const pagoEUR  = eur(data.pago || 0, data.moeda);
  const restaEUR = Math.max(0, totalEUR - pagoEUR);
  const pct      = Math.min(100, totalEUR > 0 ? Math.round((pagoEUR / totalEUR) * 100) : 0);

  document.getElementById("modal-nome").textContent       = data.desc;
  document.getElementById("modal-moeda-info").textContent = `Moeda original: ${data.moeda} ${data.valorOriginal}`;
  document.getElementById("modal-total").textContent      = `€ ${fmt(totalEUR)}`;
  document.getElementById("modal-pago").textContent       = `€ ${fmt(pagoEUR)}`;
  document.getElementById("modal-resta").textContent      = `€ ${fmt(restaEUR)}`;
  document.getElementById("modal-valor-pagar").value      = "";

  const circumference = 2 * Math.PI * 60;
  const ringFill      = document.getElementById("ring-fill");
  const ringPct       = document.getElementById("ring-pct");
  const cor           = pct >= 100 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  ringFill.style.stroke           = cor;
  ringPct.style.color             = cor;
  ringFill.style.strokeDashoffset = circumference;
  setTimeout(() => { ringFill.style.strokeDashoffset = circumference - (pct / 100) * circumference; }, 80);
  ringPct.textContent = `${pct}%`;

  document.getElementById("modal-pagamento").classList.add("active");
};

// =====================
// MODAL PAGAMENTO — CONFIRMAR
// =====================
window.confirmarPagamento = async function () {
  if (!modalDividaId) return;
  const data = recuperar(modalDividaId);
  if (!data) return;

  const valorPagar = Number(document.getElementById("modal-valor-pagar").value);
  if (!valorPagar || valorPagar <= 0) return alert("Informe um valor válido");

  const pagoAtual = Number(data.pago) || 0;
  const novoPago  = pagoAtual + valorPagar;
  const total     = Number(data.valorOriginal);

  if (novoPago > total) {
    return alert(`Valor excede o total. Máximo: ${data.moeda} ${fmt(total - pagoAtual)}`);
  }

  await updateDoc(doc(db, "dividas", modalDividaId), { pago: novoPago });
  await registrarHistorico("💸 Pagamento realizado", data.desc, valorPagar, data.moeda);

  // Atualiza o cache e recarrega o modal
  guardar(modalDividaId, { ...data, pago: novoPago });
  abrirModalPagamento(modalDividaId);
};

// =====================
// MODAL CORRIGIR PAGAMENTO — ABRIR
// =====================
window.abrirModalCorrigir = function (id) {
  const data = recuperar(id);
  if (!data) return;

  corrigirDividaId = id;

  const totalEUR = eur(data.valorOriginal, data.moeda);
  const pagoEUR  = eur(data.pago || 0, data.moeda);

  document.getElementById("corrigir-nome").textContent   = data.desc;
  document.getElementById("corrigir-total").textContent  = `Total: ${data.moeda} ${fmt(data.valorOriginal)} (€ ${fmt(totalEUR)})`;
  document.getElementById("corrigir-atual").textContent  = `Valor pago atual: ${data.moeda} ${fmt(data.pago || 0)} (€ ${fmt(pagoEUR)})`;
  document.getElementById("corrigir-valor").value        = data.pago || 0;

  document.getElementById("modal-corrigir").classList.add("active");
};

// =====================
// MODAL CORRIGIR PAGAMENTO — SALVAR
// =====================
window.salvarCorrecao = async function () {
  if (!corrigirDividaId) return;
  const data = recuperar(corrigirDividaId);
  if (!data) return;

  const novoValor = Number(document.getElementById("corrigir-valor").value);

  if (novoValor < 0) return alert("O valor não pode ser negativo");
  if (novoValor > Number(data.valorOriginal)) {
    return alert(`O valor não pode ser maior que o total: ${data.moeda} ${fmt(data.valorOriginal)}`);
  }

  const confirmar = confirm(
    `Corrigir pagamento de "${data.desc}"?\n\nValor atual: ${data.moeda} ${fmt(data.pago || 0)}\nNovo valor: ${data.moeda} ${fmt(novoValor)}`
  );
  if (!confirmar) return;

  await updateDoc(doc(db, "dividas", corrigirDividaId), { pago: novoValor });
  await registrarHistorico("🔧 Pagamento corrigido", data.desc, novoValor, data.moeda);

  guardar(corrigirDividaId, { ...data, pago: novoValor });
  fecharModal("modal-corrigir");
};

// =====================
// MODAL EDIÇÃO — ABRIR
// =====================
window.abrirModalEdicao = function (colecao, id) {
  const data = recuperar(id);
  if (!data) return;

  editId      = id;
  editColecao = colecao;

  const nomes = { receitas: "Receita", despesas: "Despesa" };
  document.getElementById("edit-subtitle").textContent = `Editando: ${nomes[colecao] || colecao}`;

  document.getElementById("edit-desc").value  = data.desc;
  document.getElementById("edit-val").value   = data.val;
  document.getElementById("edit-moeda").value = data.moeda;

  const catSelect = document.getElementById("edit-cat");
  catSelect.innerHTML = "";

  const opcoes = colecao === "receitas"
    ? ["Trabalho","Freelance","Investimentos","Outros"]
    : ["Alimentação","Transporte","Moradia","Lazer","Saúde","Outros"];

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
// MODAL EDIÇÃO — SALVAR
// =====================
window.salvarEdicao = async function () {
  if (!editId || !editColecao) return;

  const desc  = document.getElementById("edit-desc").value.trim();
  const val   = Number(document.getElementById("edit-val").value);
  const moeda = document.getElementById("edit-moeda").value;
  const cat   = document.getElementById("edit-cat").value;

  if (!desc || val <= 0) return alert("Preencha todos os campos corretamente");

  if (!confirm(`Confirmar alteração de "${desc}"?`)) return;

  await updateDoc(doc(db, editColecao, editId), { desc, val, moeda, categoria: cat });
  await registrarHistorico("✏️ Lançamento editado", desc, val, moeda);

  fecharModal("modal-edicao");
};

// =====================
// DELETAR
// =====================
window.deletarItem = async function (colecao, id, desc) {
  if (!confirm(`Tem certeza que deseja remover "${desc}"?\n\nEssa ação não pode ser desfeita.`)) return;
  await deleteDoc(doc(db, colecao, id));
  await registrarHistorico(
    `🗑️ ${colecao === "receitas" ? "Receita" : colecao === "despesas" ? "Despesa" : "Dívida"} removida`,
    desc, "-", "-"
  );
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
  await registrarHistorico("➕ Receita adicionada", desc, val, moeda);

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
  await registrarHistorico("➖ Despesa adicionada", desc, val, moeda);

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
  await registrarHistorico("💳 Dívida adicionada", desc, valor, moeda);

  document.getElementById("div-desc").value  = "";
  document.getElementById("div-valor").value = "";
};

// =====================
// STREAM RECEITAS
// =====================
function iniciarStreamReceitas() {
  const q = query(collection(db, "receitas"), orderBy("criadoEm", "desc"));
  onSnapshot(q, (snap) => {
    totalReceitas = 0;
    let html = "";

    snap.forEach((i) => {
      const r = i.data();
      const v = eur(r.val, r.moeda);
      totalReceitas += v;
      guardar(i.id, r);

      html += `
        <div class="card">
          <strong>${r.desc}</strong>
          <p>${r.categoria}</p>
          <p>${r.moeda} ${fmt(r.val)}</p>
          <small>€ ${fmt(v)}</small>
          <div class="actions">
            <button class="btn-editar" onclick="abrirModalEdicao('receitas','${i.id}')">✏️ Editar</button>
            <button class="btn-remover" onclick="deletarItem('receitas','${i.id}','${r.desc.replace(/'/g,"\\'")}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("count-receitas").textContent = snap.size || "";
    document.getElementById("lista-receitas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma receita</p>";
    atualizarResumo();
  });
}

// =====================
// STREAM DESPESAS
// =====================
function iniciarStreamDespesas() {
  const q = query(collection(db, "despesas"), orderBy("criadoEm", "desc"));
  onSnapshot(q, (snap) => {
    totalDespesas = 0;
    let html = "";

    snap.forEach((i) => {
      const d = i.data();
      const v = eur(d.val, d.moeda);
      totalDespesas += v;
      guardar(i.id, d);

      html += `
        <div class="card">
          <strong>${d.desc}</strong>
          <p>${d.categoria}</p>
          <p>${d.moeda} ${fmt(d.val)}</p>
          <small>€ ${fmt(v)}</small>
          <div class="actions">
            <button class="btn-editar" onclick="abrirModalEdicao('despesas','${i.id}')">✏️ Editar</button>
            <button class="btn-remover" onclick="deletarItem('despesas','${i.id}','${d.desc.replace(/'/g,"\\'")}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("count-despesas").textContent = snap.size || "";
    document.getElementById("lista-despesas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma despesa</p>";
    atualizarResumo();
  });
}

// =====================
// STREAM DÍVIDAS
// =====================
function iniciarStreamDividas() {
  const q = query(collection(db, "dividas"), orderBy("criadoEm", "desc"));
  onSnapshot(q, (snap) => {
    totalDividas = 0;
    let html = "";

    snap.forEach((i) => {
      const d        = i.data();
      const totalEUR = eur(d.valorOriginal, d.moeda);
      const pagoEUR  = eur(d.pago || 0, d.moeda);
      const restaEUR = Math.max(0, totalEUR - pagoEUR);
      const quitada  = pagoEUR >= totalEUR && totalEUR > 0;

      // Valores em BRL
      const totalBRL = brl(totalEUR);
      const restaBRL = brl(restaEUR);
      const brlInfo  = totalBRL
        ? `<small style="color:#64748b">R$ ${fmt(totalBRL)} total · Resta R$ ${fmt(restaBRL)}</small>`
        : "";

      if (!quitada) totalDividas += restaEUR;
      guardar(i.id, d);

      const descEscapada = d.desc.replace(/'/g, "\\'");

      html += `
        <div class="card ${quitada ? "pago-total" : ""}">
          <strong>${d.desc}${quitada ? ' <span class="badge-pago">✅ Quitada</span>' : ""}</strong>
          <p>${d.moeda} ${fmt(d.valorOriginal)} · Pago: ${d.moeda} ${fmt(d.pago || 0)}</p>
          <small>€ ${fmt(totalEUR)} total · Resta € ${fmt(restaEUR)}</small><br>
          ${brlInfo}

          ${renderProgress(pagoEUR, totalEUR)}

          <div class="actions">
            ${!quitada ? `
              <button class="btn-pagar" onclick="abrirModalPagamento('${i.id}')">💸 Pagar</button>
              <button class="btn-corrigir" onclick="abrirModalCorrigir('${i.id}')">🔧 Corrigir</button>
            ` : ""}
            <button class="btn-remover" onclick="deletarItem('dividas','${i.id}','${descEscapada}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    document.getElementById("count-dividas").textContent = snap.size || "";
    document.getElementById("lista-dividas").innerHTML =
      html || "<p style='color:#94a3b8'>Nenhuma dívida</p>";
    atualizarResumo();
  });
}

// =====================
// INICIALIZAR
// =====================
async function inicializar() {
  await pegarCambio();
  iniciarStreamReceitas();
  iniciarStreamDespesas();
  iniciarStreamDividas();
  iniciarStreamHistorico();
}

inicializar();
