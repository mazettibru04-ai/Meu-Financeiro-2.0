import { db, auth } from "./firebase.js";
import {
  collection, addDoc, deleteDoc, updateDoc,
  doc, onSnapshot, orderBy, query, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  signInWithRedirect, getRedirectResult, GoogleAuthProvider,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// =====================
// CACHE GLOBAL
// =====================
const _cache = {};
const guardar   = (id, d) => { _cache[id] = d; };
const recuperar = (id)    => _cache[id] || null;

// =====================
// ESTADO
// =====================
let taxa            = 0;
let currentUser     = null;
let filtroMes       = null; // "YYYY-MM" ou null

let totalReceitas   = 0;
let totalDespesas   = 0;
let totalDividas    = 0;

// Dados mensais
let receitasMes = [];
let despesasMes = [];

// Modal state
let modalDividaId    = null;
let editId           = null;
let editColecao      = null;
let corrigirDividaId = null;

// Streams (para cancelar ao trocar usuário)
const unsubs = [];

let chart;

// =====================
// HELPERS DE FORMATO
// =====================
function fmt(v) {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function mesAnoLabel(ym) {
  if (!ym) return "";
  const [ano, mes] = ym.split("-");
  const nomes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${nomes[parseInt(mes) - 1]} ${ano}`;
}

function mesAtualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// =====================
// COLEÇÕES DO USUÁRIO
// =====================
function col(nome) {
  return collection(db, "usuarios", currentUser.uid, nome);
}

function docRef(nome, id) {
  return doc(db, "usuarios", currentUser.uid, nome, id);
}

// =====================
// AUTH — LOGIN
// =====================
window.fazerLogin = async function () {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithRedirect(auth, provider);
  } catch (e) {
    alert("Erro ao iniciar login: " + e.message);
  }
};

window.fazerLogout = async function () {
  if (!confirm("Tem certeza que deseja sair?")) return;
  unsubs.forEach(u => u());
  unsubs.length = 0;
  await signOut(auth);
};

// Captura o resultado do redirect ao voltar do Google
getRedirectResult(auth).catch((e) => {
  console.warn("Redirect result error:", e.message);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("tela-login").style.display = "none";
    document.getElementById("app").style.display        = "block";
    document.getElementById("user-name").textContent    = user.displayName || user.email;
    document.getElementById("user-avatar").src          = user.photoURL || "";

    // Filtro padrão = mês atual
    const hoje = mesAtualISO();
    document.getElementById("filtro-mes").value = hoje;
    filtroMes = hoje;
    atualizarLabelMes();

    inicializar();
  } else {
    currentUser = null;
    document.getElementById("tela-login").style.display = "flex";
    document.getElementById("app").style.display        = "none";
  }
});

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
// FILTRO POR MÊS
// =====================
window.aplicarFiltro = function () {
  filtroMes = document.getElementById("filtro-mes").value || null;
  atualizarLabelMes();
  renderizarListas();
};

window.limparFiltro = function () {
  filtroMes = null;
  document.getElementById("filtro-mes").value = "";
  atualizarLabelMes();
  renderizarListas();
};

function atualizarLabelMes() {
  const label = document.getElementById("label-mes-atual");
  label.textContent = filtroMes ? mesAnoLabel(filtroMes) : "Geral";
}

function pertenceAoFiltro(item) {
  if (!filtroMes) return true;
  const data = item.data || item.criadoEm;
  if (!data) return true;

  // data pode ser string ISO ou timestamp ms
  let d;
  if (typeof data === "string") {
    d = new Date(data);
  } else {
    d = new Date(data);
  }

  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return ym === filtroMes;
}

// =====================
// RESUMO GERAL
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
  atualizarResumoMensal();
}

// =====================
// RESUMO MENSAL
// =====================
function atualizarResumoMensal() {
  const mesRef = filtroMes || mesAtualISO();

  const totalMesR = receitasMes
    .filter(r => pertenceAoMes(r, mesRef))
    .reduce((s, r) => s + eur(r.val, r.moeda), 0);

  const totalMesD = despesasMes
    .filter(d => pertenceAoMes(d, mesRef))
    .reduce((s, d) => s + eur(d.val, d.moeda), 0);

  const saldoMes = totalMesR - totalMesD;

  document.getElementById("mes-receitas").textContent = `€ ${fmt(totalMesR)}`;
  document.getElementById("mes-despesas").textContent = `€ ${fmt(totalMesD)}`;

  const saldoEl = document.getElementById("mes-saldo");
  saldoEl.textContent  = `€ ${fmt(saldoMes)}`;
  saldoEl.className    = "mensal-valor " + (saldoMes >= 0 ? "positivo" : "negativo");
}

function pertenceAoMes(item, ym) {
  const data = item.data || item.criadoEm;
  if (!data) return false;
  const d  = new Date(typeof data === "string" ? data : data);
  const im = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return im === ym;
}

// =====================
// GRÁFICO
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
// HISTÓRICO — FIRESTORE
// =====================
async function registrarHistorico(acao, desc, valor, moeda) {
  try {
    await addDoc(col("historico"), {
      acao, desc, valor: String(valor), moeda, criadoEm: Date.now()
    });
  } catch (e) {
    console.error("Histórico:", e);
  }
}

function iniciarStreamHistorico() {
  const q = query(col("historico"), orderBy("criadoEm", "desc"), limit(30));
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
      <div class="progress-label"><span>Progresso</span><span class="pct ${classe}">${label}</span></div>
      <div class="progress-bar-bg"><div class="progress-bar-fill ${classe}" style="width:${pct}%"></div></div>
    </div>`;
}

// =====================
// COLLAPSIBLE
// =====================
window.toggleSection = function (id) {
  document.getElementById(id)?.classList.toggle("collapsed");
  document.getElementById("chevron-" + id)?.classList.toggle("collapsed");
};

// =====================
// RECORRENTE TOGGLE
// =====================
window.toggleDiaMes = function () {
  const checked = document.getElementById("div-recorrente").checked;
  document.getElementById("dia-mes-wrap").style.display = checked ? "block" : "none";
};

// =====================
// FECHAR MODAL
// =====================
window.fecharModal = function (id) {
  document.getElementById(id)?.classList.remove("active");
  if (id === "modal-pagamento") modalDividaId    = null;
  if (id === "modal-edicao")    { editId = null; editColecao = null; }
  if (id === "modal-corrigir")  corrigirDividaId = null;
};

["modal-pagamento","modal-edicao","modal-corrigir"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", e => {
    if (e.target === e.currentTarget) fecharModal(id);
  });
});

// =====================
// MODAL PAGAMENTO
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
  document.getElementById("modal-moeda-info").textContent = `${data.moeda} ${fmt(data.valorOriginal)}`;
  document.getElementById("modal-total").textContent      = `€ ${fmt(totalEUR)}`;
  document.getElementById("modal-pago").textContent       = `€ ${fmt(pagoEUR)}`;
  document.getElementById("modal-resta").textContent      = `€ ${fmt(restaEUR)}`;
  document.getElementById("modal-valor-pagar").value      = "";

  const circumference = 2 * Math.PI * 56; // r=56
  const ringFill = document.getElementById("ring-fill");
  const ringPct  = document.getElementById("ring-pct");
  const cor      = pct >= 100 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  ringFill.style.stroke             = cor;
  ringPct.style.color               = cor;
  ringFill.style.strokeDashoffset   = circumference;
  setTimeout(() => {
    ringFill.style.strokeDashoffset = circumference - (pct / 100) * circumference;
  }, 80);
  ringPct.textContent = `${pct}%`;

  document.getElementById("modal-pagamento").classList.add("active");
};

window.confirmarPagamento = async function () {
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

  await updateDoc(docRef("dividas", modalDividaId), { pago: novoPago });
  await registrarHistorico("💸 Pagamento realizado", data.desc, valorPagar, data.moeda);

  guardar(modalDividaId, { ...data, pago: novoPago });
  abrirModalPagamento(modalDividaId);
};

// =====================
// MODAL CORRIGIR
// =====================
window.abrirModalCorrigir = function (id) {
  const data = recuperar(id);
  if (!data) return;
  corrigirDividaId = id;

  document.getElementById("corrigir-nome").textContent  = data.desc;
  document.getElementById("corrigir-total").textContent = `Total: ${data.moeda} ${fmt(data.valorOriginal)}`;
  document.getElementById("corrigir-atual").textContent = `Pago atual: ${data.moeda} ${fmt(data.pago || 0)}`;
  document.getElementById("corrigir-valor").value       = data.pago || 0;

  document.getElementById("modal-corrigir").classList.add("active");
};

window.salvarCorrecao = async function () {
  if (!corrigirDividaId) return;
  const data = recuperar(corrigirDividaId);
  if (!data) return;

  const novoValor = Number(document.getElementById("corrigir-valor").value);
  if (novoValor < 0) return alert("Valor não pode ser negativo");
  if (novoValor > Number(data.valorOriginal))
    return alert(`Máximo: ${data.moeda} ${fmt(data.valorOriginal)}`);

  if (!confirm(`Corrigir pagamento de "${data.desc}"?\nAntes: ${data.moeda} ${fmt(data.pago || 0)}\nDepois: ${data.moeda} ${fmt(novoValor)}`)) return;

  await updateDoc(docRef("dividas", corrigirDividaId), { pago: novoValor });
  await registrarHistorico("🔧 Pagamento corrigido", data.desc, novoValor, data.moeda);

  guardar(corrigirDividaId, { ...data, pago: novoValor });
  fecharModal("modal-corrigir");
};

// =====================
// MODAL EDIÇÃO
// =====================
window.abrirModalEdicao = function (colecao, id) {
  const data = recuperar(id);
  if (!data) return;
  editId = id; editColecao = colecao;

  document.getElementById("edit-subtitle").textContent =
    `Editando: ${colecao === "receitas" ? "Receita" : "Despesa"}`;
  document.getElementById("edit-desc").value  = data.desc;
  document.getElementById("edit-val").value   = data.val;
  document.getElementById("edit-moeda").value = data.moeda;
  document.getElementById("edit-data").value  = data.data || hojeISO();

  const catSelect = document.getElementById("edit-cat");
  catSelect.innerHTML = "";
  const opcoes = colecao === "receitas"
    ? ["Trabalho","Freelance","Investimentos","Outros"]
    : ["Alimentação","Transporte","Moradia","Lazer","Saúde","Outros"];

  opcoes.forEach(o => {
    const opt = document.createElement("option");
    opt.value = o; opt.text = o;
    if (o === data.categoria) opt.selected = true;
    catSelect.appendChild(opt);
  });
  catSelect.style.display = "block";

  document.getElementById("modal-edicao").classList.add("active");
};

window.salvarEdicao = async function () {
  if (!editId || !editColecao) return;

  const desc  = document.getElementById("edit-desc").value.trim();
  const val   = Number(document.getElementById("edit-val").value);
  const moeda = document.getElementById("edit-moeda").value;
  const cat   = document.getElementById("edit-cat").value;
  const data  = document.getElementById("edit-data").value;

  if (!desc || val <= 0) return alert("Preencha todos os campos");
  if (!confirm(`Confirmar alteração de "${desc}"?`)) return;

  await updateDoc(docRef(editColecao, editId), { desc, val, moeda, categoria: cat, data });
  await registrarHistorico("✏️ Lançamento editado", desc, val, moeda);
  fecharModal("modal-edicao");
};

// =====================
// DELETAR
// =====================
window.deletarItem = async function (colecao, id, desc) {
  if (!confirm(`Remover "${desc}"?\n\nEssa ação não pode ser desfeita.`)) return;
  await deleteDoc(docRef(colecao, id));
  await registrarHistorico(
    `🗑️ ${colecao === "receitas" ? "Receita" : colecao === "despesas" ? "Despesa" : "Dívida"} removida`,
    desc, "-", "-"
  );
};

// =====================
// RENOVAR DÍVIDA RECORRENTE
// =====================
window.renovarDivida = async function (id) {
  const data = recuperar(id);
  if (!data) return;
  if (!confirm(`Renovar "${data.desc}" para o próximo ciclo?\nIsso vai zerar o valor pago.`)) return;

  await updateDoc(docRef("dividas", id), { pago: 0 });
  await registrarHistorico("🔄 Dívida renovada", data.desc, data.valorOriginal, data.moeda);
  guardar(id, { ...data, pago: 0 });
};

// =====================
// EXPORTAR CSV
// =====================
window.exportarCSV = function () {
  const linhas = ["Tipo,Descrição,Categoria,Valor,Moeda,Valor EUR,Data"];

  // Pegar dados do cache (receitas e despesas visíveis)
  const todasR = Object.entries(_cache)
    .filter(([_, v]) => v.categoria && ["Trabalho","Freelance","Investimentos","Outros"].includes(v.categoria));
  const todasD = Object.entries(_cache)
    .filter(([_, v]) => v.categoria && ["Alimentação","Transporte","Moradia","Lazer","Saúde"].includes(v.categoria));

  [...todasR.map(([,v]) => ({...v, _tipo: "Receita"})),
   ...todasD.map(([,v]) => ({...v, _tipo: "Despesa"}))]
    .filter(pertenceAoFiltro)
    .forEach(item => {
      const vEur = fmt(eur(item.val, item.moeda));
      const data = item.data || (item.criadoEm ? new Date(item.criadoEm).toLocaleDateString("pt-BR") : "-");
      linhas.push(`${item._tipo},"${item.desc}","${item.categoria || "-"}",${item.val},${item.moeda},${vEur},${data}`);
    });

  const blob = new Blob([linhas.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), {
    href: url,
    download: `financeiro_${filtroMes || "geral"}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
};

// =====================
// ADD RECEITA
// =====================
window.addReceita = async function () {
  const desc  = document.getElementById("r-desc").value.trim();
  const cat   = document.getElementById("r-cat").value;
  const val   = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;
  const data  = document.getElementById("r-data").value || hojeISO();

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(col("receitas"), { desc, categoria: cat, val, moeda, data, criadoEm: Date.now() });
  await registrarHistorico("➕ Receita adicionada", desc, val, moeda);

  document.getElementById("r-desc").value = "";
  document.getElementById("r-val").value  = "";
  document.getElementById("r-data").value = hojeISO();
};

// =====================
// ADD DESPESA
// =====================
window.addDespesa = async function () {
  const desc  = document.getElementById("d-desc").value.trim();
  const cat   = document.getElementById("d-cat").value;
  const val   = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;
  const data  = document.getElementById("d-data").value || hojeISO();

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(col("despesas"), { desc, categoria: cat, val, moeda, data, criadoEm: Date.now() });
  await registrarHistorico("➖ Despesa adicionada", desc, val, moeda);

  document.getElementById("d-desc").value = "";
  document.getElementById("d-val").value  = "";
  document.getElementById("d-data").value = hojeISO();
};

// =====================
// ADD DÍVIDA
// =====================
window.addDivida = async function () {
  const desc       = document.getElementById("div-desc").value.trim();
  const valor      = Number(document.getElementById("div-valor").value);
  const moeda      = document.getElementById("div-moeda").value;
  const recorrente = document.getElementById("div-recorrente").checked;
  const diaMes     = recorrente ? Number(document.getElementById("div-dia-mes").value) || null : null;

  if (!desc || valor <= 0) return alert("Preencha corretamente");

  await addDoc(col("dividas"), {
    desc, valorOriginal: valor, moeda, pago: 0,
    recorrente, diaMes, criadoEm: Date.now()
  });
  await registrarHistorico("💳 Dívida adicionada", desc, valor, moeda);

  document.getElementById("div-desc").value    = "";
  document.getElementById("div-valor").value   = "";
  document.getElementById("div-recorrente").checked = false;
  document.getElementById("dia-mes-wrap").style.display = "none";
};

// =====================
// STREAMS — dados brutos (sem filtro para cálculo geral)
// =====================
let _todasReceitas = [];
let _todasDespesas = [];

function renderizarListas() {
  renderReceitas(_todasReceitas);
  renderDespesas(_todasDespesas);
  // Atualizar totais filtrados
  const rfilt = _todasReceitas.filter(pertenceAoFiltro);
  const dfilt = _todasDespesas.filter(pertenceAoFiltro);
  totalReceitas = rfilt.reduce((s, r) => s + eur(r.val, r.moeda), 0);
  totalDespesas = dfilt.reduce((s, d) => s + eur(d.val, d.moeda), 0);
  atualizarResumo();
}

function renderReceitas(lista) {
  const filtrada = lista.filter(pertenceAoFiltro);
  let html = "";

  filtrada.forEach(({ _id, ...r }) => {
    const v = eur(r.val, r.moeda);
    const dataFmt = r.data ? new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR") : "-";
    html += `
      <div class="card">
        <div class="card-top">
          <strong>${r.desc}</strong>
          <span class="data-badge">${dataFmt}</span>
        </div>
        <p>${r.categoria}</p>
        <p>${r.moeda} ${fmt(r.val)}</p>
        <small>€ ${fmt(v)}</small>
        <div class="actions">
          <button class="btn-editar" onclick="abrirModalEdicao('receitas','${_id}')">✏️ Editar</button>
          <button class="btn-remover" onclick="deletarItem('receitas','${_id}','${r.desc.replace(/'/g,"\\'")}')">🗑️ Remover</button>
        </div>
      </div>`;
  });

  document.getElementById("count-receitas").textContent = filtrada.length || "";
  document.getElementById("lista-receitas").innerHTML =
    html || "<p style='color:#94a3b8'>Nenhuma receita no período</p>";
}

function renderDespesas(lista) {
  const filtrada = lista.filter(pertenceAoFiltro);
  let html = "";

  filtrada.forEach(({ _id, ...d }) => {
    const v = eur(d.val, d.moeda);
    const dataFmt = d.data ? new Date(d.data + "T00:00:00").toLocaleDateString("pt-BR") : "-";
    html += `
      <div class="card">
        <div class="card-top">
          <strong>${d.desc}</strong>
          <span class="data-badge">${dataFmt}</span>
        </div>
        <p>${d.categoria}</p>
        <p>${d.moeda} ${fmt(d.val)}</p>
        <small>€ ${fmt(v)}</small>
        <div class="actions">
          <button class="btn-editar" onclick="abrirModalEdicao('despesas','${_id}')">✏️ Editar</button>
          <button class="btn-remover" onclick="deletarItem('despesas','${_id}','${d.desc.replace(/'/g,"\\'")}')">🗑️ Remover</button>
        </div>
      </div>`;
  });

  document.getElementById("count-despesas").textContent = filtrada.length || "";
  document.getElementById("lista-despesas").innerHTML =
    html || "<p style='color:#94a3b8'>Nenhuma despesa no período</p>";
}

function iniciarStreamReceitas() {
  const q = query(col("receitas"), orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    _todasReceitas = [];
    receitasMes    = [];
    snap.forEach(i => {
      const r = { _id: i.id, ...i.data() };
      guardar(i.id, i.data());
      _todasReceitas.push(r);
      receitasMes.push(i.data());
    });
    renderizarListas();
  });
  unsubs.push(u);
}

function iniciarStreamDespesas() {
  const q = query(col("despesas"), orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    _todasDespesas = [];
    despesasMes    = [];
    snap.forEach(i => {
      const d = { _id: i.id, ...i.data() };
      guardar(i.id, i.data());
      _todasDespesas.push(d);
      despesasMes.push(i.data());
    });
    renderizarListas();
  });
  unsubs.push(u);
}

function iniciarStreamDividas() {
  const q = query(col("dividas"), orderBy("criadoEm", "desc"));
  const u = onSnapshot(q, (snap) => {
    totalDividas = 0;
    let html = "";

    snap.forEach((i) => {
      const d        = i.data();
      const totalEUR = eur(d.valorOriginal, d.moeda);
      const pagoEUR  = eur(d.pago || 0, d.moeda);
      const restaEUR = Math.max(0, totalEUR - pagoEUR);
      const quitada  = pagoEUR >= totalEUR && totalEUR > 0;
      const totalBRL = brl(totalEUR);
      const restaBRL = brl(restaEUR);

      if (!quitada) totalDividas += restaEUR;
      guardar(i.id, d);

      const descEsc = d.desc.replace(/'/g, "\\'");

      // Info de vencimento recorrente
      let vencInfo = "";
      if (d.recorrente) {
        vencInfo = `<span class="badge-recorrente">🔄 Mensal${d.diaMes ? " · dia " + d.diaMes : ""}</span>`;
      }

      html += `
        <div class="card ${quitada ? "pago-total" : ""}">
          <div class="card-top">
            <strong>${d.desc}${quitada ? ' <span class="badge-pago">✅ Quitada</span>' : ""}</strong>
            ${vencInfo}
          </div>
          <p>${d.moeda} ${fmt(d.valorOriginal)} · Pago: ${d.moeda} ${fmt(d.pago || 0)}</p>
          <small>€ ${fmt(totalEUR)} total · Resta € ${fmt(restaEUR)}</small>
          ${totalBRL ? `<br><small style="color:#475569">R$ ${fmt(totalBRL)} total · Resta R$ ${fmt(restaBRL || 0)}</small>` : ""}

          ${renderProgress(pagoEUR, totalEUR)}

          <div class="actions">
            ${!quitada ? `
              <button class="btn-pagar"   onclick="abrirModalPagamento('${i.id}')">💸 Pagar</button>
              <button class="btn-corrigir" onclick="abrirModalCorrigir('${i.id}')">🔧 Corrigir</button>
            ` : d.recorrente ? `
              <button class="btn-renovar" onclick="renovarDivida('${i.id}')">🔄 Renovar</button>
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
// =====================
async function inicializar() {
  await pegarCambio();

  // Preencher data padrão nos formulários
  const hoje = hojeISO();
  ["r-data","d-data"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = hoje;
  });

  iniciarStreamReceitas();
  iniciarStreamDespesas();
  iniciarStreamDividas();
  iniciarStreamHistorico();
}
