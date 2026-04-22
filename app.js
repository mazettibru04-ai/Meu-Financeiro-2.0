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
// VARIÁVEIS GLOBAIS
// =====================
let taxa = 0;
let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas  = 0;

// Modal pagamento
let modalDividaId   = null;
let modalDividaData = null;

// Modal edição
let editId      = null;
let editColecao = null;

// Gráfico
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
// CONVERSÃO EUR
// =====================
function eur(v, m) {
  if (m === "EUR") return Number(v);
  if (m === "BRL" && taxa > 0) return Number(v) / taxa;
  return Number(v);
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
      acao,
      desc,
      valor: String(valor),
      moeda,
      criadoEm: Date.now()
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
      const h = i.data();
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
// COLLAPSIBLE SECTIONS
// =====================
window.toggleSection = function (id) {
  const body    = document.getElementById(id);
  const chevron = document.getElementById("chevron-" + id);
  if (!body) return;

  body.classList.toggle("collapsed");
  chevron.classList.toggle("collapsed");
};

// =====================
// MODAL PAGAMENTO — ABRIR
// =====================
window.abrirModalPagamento = function (id, data) {
  modalDividaId   = id;
  modalDividaData = data;

  const totalEUR = eur(data.valorOriginal, data.moeda);
  const pagoEUR  = eur(data.pago || 0, data.moeda);
  const restaEUR = Math.max(0, totalEUR - pagoEUR);
  const pct      = Math.min(100, totalEUR > 0 ? Math.round((pagoEUR / totalEUR) * 100) : 0);

  document.getElementById("modal-nome").textContent        = data.desc;
  document.getElementById("modal-moeda-info").textContent  = `Moeda original: ${data.moeda} ${data.valorOriginal}`;
  document.getElementById("modal-total").textContent       = `€ ${fmt(totalEUR)}`;
  document.getElementById("modal-pago").textContent        = `€ ${fmt(pagoEUR)}`;
  document.getElementById("modal-resta").textContent       = `€ ${fmt(restaEUR)}`;
  document.getElementById("modal-valor-pagar").value       = "";

  const circumference = 2 * Math.PI * 60;
  const offset        = circumference - (pct / 100) * circumference;
  const ringFill      = document.getElementById("ring-fill");
  const ringPct       = document.getElementById("ring-pct");
  const cor           = pct >= 100 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";

  ringFill.style.stroke         = cor;
  ringPct.style.color           = cor;
  ringFill.style.strokeDashoffset = circumference;

  setTimeout(() => { ringFill.style.strokeDashoffset = offset; }, 80);

  ringPct.textContent = `${pct}%`;
  document.getElementById("modal-pagamento").classList.add("active");
};

// =====================
// MODAL PAGAMENTO — CONFIRMAR
// =====================
window.confirmarPagamento = async function () {
  if (!modalDividaId || !modalDividaData) return;

  const valorPagar = Number(document.getElementById("modal-valor-pagar").value);
  if (!valorPagar || valorPagar <= 0) return alert("Informe um valor válido");

  const pagoAtual = Number(modalDividaData.pago) || 0;
  const novoPago  = pagoAtual + valorPagar;
  const total     = Number(modalDividaData.valorOriginal);

  if (novoPago > total) {
    return alert(`Valor excede o total. Máximo a pagar: ${modalDividaData.moeda} ${fmt(total - pagoAtual)}`);
  }

  await updateDoc(doc(db, "dividas", modalDividaId), { pago: novoPago });
  await registrarHistorico("💸 Pagamento realizado", modalDividaData.desc, valorPagar, modalDividaData.moeda);

  // Atualiza modal sem fechar
  abrirModalPagamento(modalDividaId, { ...modalDividaData, pago: novoPago });
};

// =====================
// MODAL EDIÇÃO — ABRIR
// =====================
window.abrirModalEdicao = function (colecao, id, dataJson) {
  const data = JSON.parse(dataJson);
  editId      = id;
  editColecao = colecao;

  // Subtítulo
  const nomes = { receitas: "Receita", despesas: "Despesa" };
  document.getElementById("edit-subtitle").textContent =
    `Editando: ${nomes[colecao] || colecao}`;

  // Preencher campos
  document.getElementById("edit-desc").value  = data.desc;
  document.getElementById("edit-val").value   = data.val;
  document.getElementById("edit-moeda").value = data.moeda;

  // Categorias
  const catSelect = document.getElementById("edit-cat");
  catSelect.innerHTML = "";

  const opcoesReceita  = ["Trabalho","Freelance","Investimentos","Outros"];
  const opcoesDespesa  = ["Alimentação","Transporte","Moradia","Lazer","Saúde","Outros"];
  const opcoes         = colecao === "receitas" ? opcoesReceita : opcoesDespesa;

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

  const confirmar = confirm(`Confirmar alteração de "${desc}"?`);
  if (!confirmar) return;

  await updateDoc(doc(db, editColecao, editId), {
    desc, val, moeda, categoria: cat
  });

  await registrarHistorico("✏️ Lançamento editado", desc, val, moeda);

  fecharModal("modal-edicao");
};

// =====================
// FECHAR MODAL (genérico)
// =====================
window.fecharModal = function (id) {
  document.getElementById(id).classList.remove("active");
  if (id === "modal-pagamento") { modalDividaId = null; modalDividaData = null; }
  if (id === "modal-edicao")    { editId = null; editColecao = null; }
};

// Fechar clicando fora
["modal-pagamento", "modal-edicao"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) fecharModal(id);
  });
});

// =====================
// DELETAR (com confirmação)
// =====================
window.deletarItem = async function (colecao, id, desc) {
  const confirmar = confirm(`Tem certeza que deseja remover "${desc}"?\n\nEssa ação não pode ser desfeita.`);
  if (!confirmar) return;

  await deleteDoc(doc(db, colecao, id));
  await registrarHistorico(
    `🗑️ ${colecao.charAt(0).toUpperCase() + colecao.slice(1, -1)} removido`,
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

      const dataJson = JSON.stringify(r).replace(/"/g, "&quot;");

      html += `
        <div class="card">
          <strong>${r.desc}</strong>
          <p>${r.categoria}</p>
          <p>${r.moeda} ${r.val}</p>
          <small>€ ${fmt(v)}</small>
          <div class="actions">
            <button class="btn-editar" onclick='abrirModalEdicao("receitas","${i.id}","${dataJson}")'>✏️ Editar</button>
            <button class="btn-remover" onclick="deletarItem('receitas','${i.id}','${r.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    const count = snap.size;
    document.getElementById("count-receitas").textContent = count > 0 ? count : "";
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

      const dataJson = JSON.stringify(d).replace(/"/g, "&quot;");

      html += `
        <div class="card">
          <strong>${d.desc}</strong>
          <p>${d.categoria}</p>
          <p>${d.moeda} ${d.val}</p>
          <small>€ ${fmt(v)}</small>
          <div class="actions">
            <button class="btn-editar" onclick='abrirModalEdicao("despesas","${i.id}","${dataJson}")'>✏️ Editar</button>
            <button class="btn-remover" onclick="deletarItem('despesas','${i.id}','${d.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    const count = snap.size;
    document.getElementById("count-despesas").textContent = count > 0 ? count : "";
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
      const restante = Math.max(0, totalEUR - pagoEUR);
      const quitada  = pagoEUR >= totalEUR && totalEUR > 0;

      if (!quitada) totalDividas += restante;

      html += `
        <div class="card ${quitada ? "pago-total" : ""}">
          <strong>${d.desc}${quitada ? ' <span class="badge-pago">✅ Quitada</span>' : ""}</strong>
          <p>${d.moeda} ${d.valorOriginal}</p>
          <small>€ ${fmt(totalEUR)} total · Resta € ${fmt(restante)}</small>

          ${renderProgress(pagoEUR, totalEUR)}

          <div class="actions">
            ${!quitada
              ? `<button class="btn-pagar" onclick='abrirModalPagamento("${i.id}",${JSON.stringify(d)})'>💸 Pagar</button>`
              : ""}
            <button class="btn-remover" onclick="deletarItem('dividas','${i.id}','${d.desc}')">🗑️ Remover</button>
          </div>
        </div>
      `;
    });

    const count = snap.size;
    document.getElementById("count-dividas").textContent = count > 0 ? count : "";
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
