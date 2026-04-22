import { db, auth } from "./firebase.js";
import {
  collection, addDoc, deleteDoc, updateDoc,
  doc, onSnapshot, orderBy, query, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  signInWithRedirect, getRedirectResult,
  GoogleAuthProvider, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// =====================
// CACHE + ESTADO
// =====================
const _cache = {};
const guardar   = (id, d) => { _cache[id] = d; };
const recuperar = (id)    => _cache[id] || null;

let taxa = 0;
let currentUser = null;
let filtroMes   = null;
let moduloAtual = "financeiro";
const unsubs    = [];

// financeiro
let totalReceitas = 0, totalDespesas = 0, totalDividas = 0;
let receitasMes = [], despesasMes = [];
let _todasReceitas = [], _todasDespesas = [];

// clientes / estoque / tarefas (cache local)
let _clientes = [], _produtos = [], _tarefas = [];

// modal state
let modalDividaId = null, editId = null, editColecao = null, corrigirDividaId = null;
let clienteEditId = null, produtoEditId = null, tarefaEditId = null;

let chart;

// =====================
// UTILS
// =====================
const fmt  = v  => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur  = (v, m) => m === "EUR" ? Number(v) : (m === "BRL" && taxa > 0 ? Number(v) / taxa : Number(v));
const brl  = ve => taxa > 0 ? ve * taxa : null;
const hoje = ()  => new Date().toISOString().slice(0, 10);
const mesAtualISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
const mesLabel = ym => { if (!ym) return ""; const [a,m] = ym.split("-"); return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+m-1]+" "+a; };

function col(nome)    { return collection(db, "usuarios", currentUser.uid, nome); }
function docRef(n,id) { return doc(db, "usuarios", currentUser.uid, n, id); }

// =====================
// AUTH
// =====================
window.fazerLogin = async () => {
  try { await signInWithRedirect(auth, new GoogleAuthProvider()); }
  catch(e) { alert("Erro: " + e.message); }
};

window.fazerLogout = async () => {
  if (!confirm("Sair?")) return;
  unsubs.forEach(u => u()); unsubs.length = 0;
  await signOut(auth);
};

getRedirectResult(auth).catch(e => console.warn("Redirect:", e.message));

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    document.getElementById("tela-login").style.display = "none";
    document.getElementById("app").style.display = "flex";
    document.getElementById("user-name").textContent  = user.displayName || user.email;
    document.getElementById("user-avatar").src        = user.photoURL || "";

    const hoje_m = mesAtualISO();
    document.getElementById("filtro-mes").value = hoje_m;
    filtroMes = hoje_m;
    atualizarLabelMes();
    inicializar();
  } else {
    currentUser = null;
    document.getElementById("tela-login").style.display = "flex";
    document.getElementById("app").style.display = "none";
  }
});

// =====================
// SIDEBAR / NAVEGAÇÃO
// =====================
window.trocarModulo = function(nome) {
  // Esconde todos
  document.querySelectorAll(".modulo").forEach(m => m.style.display = "none");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  // Mostra selecionado
  document.getElementById("modulo-" + nome).style.display = "block";
  document.getElementById("nav-" + nome).classList.add("active");

  const nomes = { financeiro:"Financeiro", clientes:"Clientes", estoque:"Estoque", tarefas:"Tarefas" };
  document.getElementById("topbar-title").textContent = nomes[nome] || nome;
  moduloAtual = nome;

  fecharSidebar();
};

window.toggleSidebar = () => {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebar-overlay").classList.toggle("open");
};

window.fecharSidebar = () => {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
};

// =====================
// CÂMBIO
// =====================
async function pegarCambio() {
  try {
    const res  = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
    const data = await res.json();
    taxa = data?.rates?.BRL || 0;
    document.getElementById("cambio").innerText = `💱 €1 = R$ ${fmt(taxa)}`;
  } catch { document.getElementById("cambio").innerText = "Câmbio indisponível"; }
}

// =====================
// FILTRO
// =====================
window.aplicarFiltro = () => { filtroMes = document.getElementById("filtro-mes").value || null; atualizarLabelMes(); renderizarListas(); };
window.limparFiltro  = () => { filtroMes = null; document.getElementById("filtro-mes").value = ""; atualizarLabelMes(); renderizarListas(); };

function atualizarLabelMes() {
  document.getElementById("label-mes-atual").textContent = filtroMes ? mesLabel(filtroMes) : "Geral";
}

function pertenceAoFiltro(item) {
  if (!filtroMes) return true;
  const raw = item.data || item.criadoEm;
  if (!raw) return true;
  const d  = new Date(typeof raw === "string" ? raw : raw);
  const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  return ym === filtroMes;
}

// =====================
// RESUMO FINANCEIRO
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;
  document.getElementById("total-receitas").innerText = `Receitas: € ${fmt(totalReceitas)}`;
  document.getElementById("total-despesas").innerText = `Despesas: € ${fmt(totalDespesas)}`;
  document.getElementById("total-dividas").innerText  = `Dívidas: € ${fmt(totalDividas)}`;
  document.getElementById("saldo").innerText          = `Saldo: € ${fmt(saldo)}`;
  document.getElementById("saldo-real").innerText     = `Saldo real (com dívidas): € ${fmt(saldoReal)}`;
  atualizarGrafico();
  atualizarResumoMensal();
}

function atualizarResumoMensal() {
  const ref = filtroMes || mesAtualISO();
  const mesR = receitasMes.filter(r => pertenceAoMesExato(r, ref)).reduce((s,r) => s + eur(r.val, r.moeda), 0);
  const mesD = despesasMes.filter(d => pertenceAoMesExato(d, ref)).reduce((s,d) => s + eur(d.val, d.moeda), 0);
  const mesS = mesR - mesD;
  document.getElementById("mes-receitas").textContent = `€ ${fmt(mesR)}`;
  document.getElementById("mes-despesas").textContent = `€ ${fmt(mesD)}`;
  const el = document.getElementById("mes-saldo");
  el.textContent = `€ ${fmt(mesS)}`;
  el.className   = "mensal-valor " + (mesS >= 0 ? "positivo" : "negativo");
}

function pertenceAoMesExato(item, ym) {
  const raw = item.data || item.criadoEm;
  if (!raw) return false;
  const d  = new Date(typeof raw === "string" ? raw : raw);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` === ym;
}

function atualizarGrafico() {
  const ctx = document.getElementById("graficoFinanceiro");
  if (!ctx || !window.Chart) return;
  if (chart) chart.destroy();
  const saldo = totalReceitas - totalDespesas;
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels: ["Receitas","Despesas","Saldo"], datasets: [{ data: [totalReceitas, totalDespesas, saldo], backgroundColor: ["#22c55e","#ef4444","#3b82f6"], borderRadius: 10, barThickness: 45 }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#fff" } }, y: { ticks: { color: "#fff" } } } }
  });
}

// =====================
// HISTÓRICO
// =====================
async function registrarHistorico(acao, desc, valor, moeda) {
  try { await addDoc(col("historico"), { acao, desc, valor: String(valor), moeda, criadoEm: Date.now() }); }
  catch(e) { console.error("Histórico:", e); }
}

function iniciarStreamHistorico() {
  const u = onSnapshot(query(col("historico"), orderBy("criadoEm","desc"), limit(30)), snap => {
    if (snap.empty) { document.getElementById("lista-historico").innerHTML = "<p style='color:#94a3b8'>Nenhuma alteração</p>"; return; }
    let html = "";
    snap.forEach(i => {
      const h    = i.data();
      const hora = new Date(h.criadoEm).toLocaleString("pt-BR");
      html += `<div class="historico-item"><div class="historico-icon">${h.acao.split(" ")[0]}</div><div><div class="historico-acao">${h.acao.replace(/^\S+\s/,"")} — ${h.desc}</div><div class="historico-detalhe">${h.moeda !== "-" ? h.moeda+" "+h.valor : ""} · ${hora}</div></div></div>`;
    });
    document.getElementById("lista-historico").innerHTML = html;
  });
  unsubs.push(u);
}

// =====================
// PROGRESS BAR
// =====================
function renderProgress(pago, total) {
  const pct = Math.min(100, total > 0 ? Math.round((pago/total)*100) : 0);
  const cl  = pct >= 100 ? "done" : pct >= 50 ? "mid" : "low";
  return `<div class="progress-wrap"><div class="progress-label"><span>Progresso</span><span class="pct ${cl}">${pct >= 100 ? "✅ Pago!" : pct+"% pago"}</span></div><div class="progress-bar-bg"><div class="progress-bar-fill ${cl}" style="width:${pct}%"></div></div></div>`;
}

// =====================
// COLLAPSIBLE
// =====================
window.toggleSection = id => {
  document.getElementById(id)?.classList.toggle("collapsed");
  document.getElementById("chevron-"+id)?.classList.toggle("collapsed");
};

// =====================
// MODAIS
// =====================
window.fecharModal = id => {
  document.getElementById(id)?.classList.remove("active");
  if (id === "modal-pagamento") modalDividaId = null;
  if (id === "modal-edicao") { editId = null; editColecao = null; }
  if (id === "modal-corrigir") corrigirDividaId = null;
  if (id === "modal-cliente") clienteEditId = null;
  if (id === "modal-produto") produtoEditId = null;
  if (id === "modal-tarefa")  tarefaEditId  = null;
};

["modal-pagamento","modal-edicao","modal-corrigir","modal-cliente","modal-produto","modal-tarefa"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", e => { if (e.target === e.currentTarget) fecharModal(id); });
});

// =====================
// MODAL PAGAMENTO
// =====================
window.abrirModalPagamento = id => {
  const data = recuperar(id);
  if (!data) return;
  modalDividaId = id;
  const te = eur(data.valorOriginal, data.moeda), pe = eur(data.pago||0, data.moeda), re = Math.max(0, te-pe);
  const pct = Math.min(100, te > 0 ? Math.round((pe/te)*100) : 0);
  document.getElementById("modal-nome").textContent       = data.desc;
  document.getElementById("modal-moeda-info").textContent = `${data.moeda} ${fmt(data.valorOriginal)}`;
  document.getElementById("modal-total").textContent      = `€ ${fmt(te)}`;
  document.getElementById("modal-pago").textContent       = `€ ${fmt(pe)}`;
  document.getElementById("modal-resta").textContent      = `€ ${fmt(re)}`;
  document.getElementById("modal-valor-pagar").value      = "";
  const C = 2*Math.PI*52, rf = document.getElementById("ring-fill"), rp = document.getElementById("ring-pct");
  const cor = pct>=100?"#22c55e":pct>=50?"#f59e0b":"#ef4444";
  rf.style.stroke = cor; rp.style.color = cor;
  rf.style.strokeDashoffset = C;
  setTimeout(() => { rf.style.strokeDashoffset = C - (pct/100)*C; }, 80);
  rp.textContent = `${pct}%`;
  document.getElementById("modal-pagamento").classList.add("active");
};

window.confirmarPagamento = async () => {
  if (!modalDividaId) return;
  const data = recuperar(modalDividaId);
  const vp = Number(document.getElementById("modal-valor-pagar").value);
  if (!vp || vp <= 0) return alert("Valor inválido");
  const novo = (Number(data.pago)||0) + vp;
  if (novo > Number(data.valorOriginal)) return alert("Excede o total");
  await updateDoc(docRef("dividas", modalDividaId), { pago: novo });
  await registrarHistorico("💸 Pagamento realizado", data.desc, vp, data.moeda);
  guardar(modalDividaId, { ...data, pago: novo });
  abrirModalPagamento(modalDividaId);
};

// =====================
// MODAL CORRIGIR
// =====================
window.abrirModalCorrigir = id => {
  const data = recuperar(id); if (!data) return;
  corrigirDividaId = id;
  document.getElementById("corrigir-nome").textContent  = data.desc;
  document.getElementById("corrigir-total").textContent = `Total: ${data.moeda} ${fmt(data.valorOriginal)}`;
  document.getElementById("corrigir-atual").textContent = `Pago atual: ${data.moeda} ${fmt(data.pago||0)}`;
  document.getElementById("corrigir-valor").value       = data.pago||0;
  document.getElementById("modal-corrigir").classList.add("active");
};

window.salvarCorrecao = async () => {
  if (!corrigirDividaId) return;
  const data = recuperar(corrigirDividaId);
  const nv = Number(document.getElementById("corrigir-valor").value);
  if (nv < 0 || nv > Number(data.valorOriginal)) return alert("Valor inválido");
  if (!confirm(`Corrigir de ${data.moeda} ${fmt(data.pago||0)} para ${data.moeda} ${fmt(nv)}?`)) return;
  await updateDoc(docRef("dividas", corrigirDividaId), { pago: nv });
  await registrarHistorico("🔧 Pagamento corrigido", data.desc, nv, data.moeda);
  guardar(corrigirDividaId, { ...data, pago: nv });
  fecharModal("modal-corrigir");
};

// =====================
// MODAL EDIÇÃO LANÇAMENTO
// =====================
window.abrirModalEdicao = (colecao, id) => {
  const data = recuperar(id); if (!data) return;
  editId = id; editColecao = colecao;
  document.getElementById("edit-subtitle").textContent = colecao === "receitas" ? "Editando Receita" : "Editando Despesa";
  document.getElementById("edit-desc").value  = data.desc;
  document.getElementById("edit-val").value   = data.val;
  document.getElementById("edit-moeda").value = data.moeda;
  document.getElementById("edit-data").value  = data.data || hoje();
  const cs = document.getElementById("edit-cat"); cs.innerHTML = "";
  const ops = colecao === "receitas" ? ["Trabalho","Freelance","Investimentos","Outros"] : ["Alimentação","Transporte","Moradia","Lazer","Saúde","Outros"];
  ops.forEach(o => { const opt = document.createElement("option"); opt.value = o; opt.text = o; if (o === data.categoria) opt.selected = true; cs.appendChild(opt); });
  cs.style.display = "block";
  document.getElementById("modal-edicao").classList.add("active");
};

window.salvarEdicao = async () => {
  if (!editId || !editColecao) return;
  const desc = document.getElementById("edit-desc").value.trim();
  const val  = Number(document.getElementById("edit-val").value);
  const moeda = document.getElementById("edit-moeda").value;
  const cat  = document.getElementById("edit-cat").value;
  const data = document.getElementById("edit-data").value;
  if (!desc || val <= 0) return alert("Preencha corretamente");
  if (!confirm(`Confirmar edição de "${desc}"?`)) return;
  await updateDoc(docRef(editColecao, editId), { desc, val, moeda, categoria: cat, data });
  await registrarHistorico("✏️ Lançamento editado", desc, val, moeda);
  fecharModal("modal-edicao");
};

// =====================
// DELETAR
// =====================
window.deletarItem = async (colecao, id, desc) => {
  if (!confirm(`Remover "${desc}"?`)) return;
  await deleteDoc(docRef(colecao, id));
  await registrarHistorico(`🗑️ Removido`, desc, "-", "-");
};

// =====================
// TOGGLE RECORRENTE
// =====================
window.toggleDiaMes = () => {
  document.getElementById("dia-mes-wrap").style.display = document.getElementById("div-recorrente").checked ? "block" : "none";
};

// =====================
// EXPORT CSV
// =====================
window.exportarCSV = () => {
  const linhas = ["Tipo,Descrição,Categoria,Valor,Moeda,Valor EUR,Data"];
  [..._todasReceitas.filter(pertenceAoFiltro).map(r => ({...r,_tipo:"Receita"})),
   ..._todasDespesas.filter(pertenceAoFiltro).map(d => ({...d,_tipo:"Despesa"}))]
    .forEach(i => { linhas.push(`${i._tipo},"${i.desc}","${i.categoria||"-"}",${i.val},${i.moeda},${fmt(eur(i.val,i.moeda))},${i.data||"-"}`); });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([linhas.join("\n")], {type:"text/csv"})), download: `financeiro_${filtroMes||"geral"}.csv` });
  a.click();
};

// =====================
// ADD RECEITA / DESPESA / DÍVIDA
// =====================
window.addReceita = async () => {
  const desc=document.getElementById("r-desc").value.trim(), cat=document.getElementById("r-cat").value, val=Number(document.getElementById("r-val").value), moeda=document.getElementById("r-moeda").value, data=document.getElementById("r-data").value||hoje();
  if (!desc||val<=0) return alert("Preencha corretamente");
  await addDoc(col("receitas"), {desc,categoria:cat,val,moeda,data,criadoEm:Date.now()});
  await registrarHistorico("➕ Receita adicionada", desc, val, moeda);
  document.getElementById("r-desc").value = ""; document.getElementById("r-val").value = "";
};

window.addDespesa = async () => {
  const desc=document.getElementById("d-desc").value.trim(), cat=document.getElementById("d-cat").value, val=Number(document.getElementById("d-val").value), moeda=document.getElementById("d-moeda").value, data=document.getElementById("d-data").value||hoje();
  if (!desc||val<=0) return alert("Preencha corretamente");
  await addDoc(col("despesas"), {desc,categoria:cat,val,moeda,data,criadoEm:Date.now()});
  await registrarHistorico("➖ Despesa adicionada", desc, val, moeda);
  document.getElementById("d-desc").value = ""; document.getElementById("d-val").value = "";
};

window.addDivida = async () => {
  const desc=document.getElementById("div-desc").value.trim(), valor=Number(document.getElementById("div-valor").value), moeda=document.getElementById("div-moeda").value, rec=document.getElementById("div-recorrente").checked, dia=rec?Number(document.getElementById("div-dia-mes").value)||null:null;
  if (!desc||valor<=0) return alert("Preencha corretamente");
  await addDoc(col("dividas"), {desc,valorOriginal:valor,moeda,pago:0,recorrente:rec,diaMes:dia,criadoEm:Date.now()});
  await registrarHistorico("💳 Dívida adicionada", desc, valor, moeda);
  document.getElementById("div-desc").value=""; document.getElementById("div-valor").value=""; document.getElementById("div-recorrente").checked=false; document.getElementById("dia-mes-wrap").style.display="none";
};

window.renovarDivida = async id => {
  const data=recuperar(id); if(!data) return;
  if(!confirm(`Renovar "${data.desc}"?`)) return;
  await updateDoc(docRef("dividas",id), {pago:0});
  await registrarHistorico("🔄 Dívida renovada", data.desc, data.valorOriginal, data.moeda);
  guardar(id, {...data,pago:0});
};

// =====================
// STREAMS FINANCEIRO
// =====================
function renderizarListas() {
  renderReceitas(_todasReceitas); renderDespesas(_todasDespesas);
  const rf = _todasReceitas.filter(pertenceAoFiltro), df = _todasDespesas.filter(pertenceAoFiltro);
  totalReceitas = rf.reduce((s,r) => s+eur(r.val,r.moeda), 0);
  totalDespesas = df.reduce((s,d) => s+eur(d.val,d.moeda), 0);
  atualizarResumo();
}

function renderReceitas(lista) {
  const f = lista.filter(pertenceAoFiltro); let html="";
  f.forEach(({_id,...r}) => {
    const v=eur(r.val,r.moeda), dtf=r.data?new Date(r.data+"T00:00:00").toLocaleDateString("pt-BR"):"-";
    html+=`<div class="card"><div class="card-top"><strong>${r.desc}</strong><span class="data-badge">${dtf}</span></div><p>${r.categoria}</p><p>${r.moeda} ${fmt(r.val)}</p><small>€ ${fmt(v)}</small><div class="actions"><button class="btn-editar" onclick="abrirModalEdicao('receitas','${_id}')">✏️ Editar</button><button class="btn-remover" onclick="deletarItem('receitas','${_id}','${r.desc.replace(/'/g,"\\'")}')">🗑️ Remover</button></div></div>`;
  });
  document.getElementById("count-receitas").textContent = f.length||"";
  document.getElementById("lista-receitas").innerHTML = html||"<p style='color:#94a3b8'>Nenhuma receita</p>";
}

function renderDespesas(lista) {
  const f = lista.filter(pertenceAoFiltro); let html="";
  f.forEach(({_id,...d}) => {
    const v=eur(d.val,d.moeda), dtf=d.data?new Date(d.data+"T00:00:00").toLocaleDateString("pt-BR"):"-";
    html+=`<div class="card"><div class="card-top"><strong>${d.desc}</strong><span class="data-badge">${dtf}</span></div><p>${d.categoria}</p><p>${d.moeda} ${fmt(d.val)}</p><small>€ ${fmt(v)}</small><div class="actions"><button class="btn-editar" onclick="abrirModalEdicao('despesas','${_id}')">✏️ Editar</button><button class="btn-remover" onclick="deletarItem('despesas','${_id}','${d.desc.replace(/'/g,"\\'")}')">🗑️ Remover</button></div></div>`;
  });
  document.getElementById("count-despesas").textContent = f.length||"";
  document.getElementById("lista-despesas").innerHTML = html||"<p style='color:#94a3b8'>Nenhuma despesa</p>";
}

function iniciarStreamReceitas() {
  const u = onSnapshot(query(col("receitas"),orderBy("criadoEm","desc")), snap => {
    _todasReceitas=[]; receitasMes=[];
    snap.forEach(i => { const r={_id:i.id,...i.data()}; guardar(i.id,i.data()); _todasReceitas.push(r); receitasMes.push(i.data()); });
    renderizarListas();
  }); unsubs.push(u);
}

function iniciarStreamDespesas() {
  const u = onSnapshot(query(col("despesas"),orderBy("criadoEm","desc")), snap => {
    _todasDespesas=[]; despesasMes=[];
    snap.forEach(i => { const d={_id:i.id,...i.data()}; guardar(i.id,i.data()); _todasDespesas.push(d); despesasMes.push(i.data()); });
    renderizarListas();
  }); unsubs.push(u);
}

function iniciarStreamDividas() {
  const u = onSnapshot(query(col("dividas"),orderBy("criadoEm","desc")), snap => {
    totalDividas=0; let html="";
    snap.forEach(i => {
      const d=i.data(), te=eur(d.valorOriginal,d.moeda), pe=eur(d.pago||0,d.moeda), re=Math.max(0,te-pe), q=pe>=te&&te>0;
      const tb=brl(te), rb=brl(re);
      if(!q) totalDividas+=re; guardar(i.id,d);
      const de=d.desc.replace(/'/g,"\\'");
      html+=`<div class="card ${q?"pago-total":""}"><div class="card-top"><strong>${d.desc}${q?' <span class="badge-pago">✅ Quitada</span>':""}</strong>${d.recorrente?`<span class="badge-recorrente">🔄 Mensal${d.diaMes?" · dia "+d.diaMes:""}</span>`:""}</div><p>${d.moeda} ${fmt(d.valorOriginal)} · Pago: ${d.moeda} ${fmt(d.pago||0)}</p><small>€ ${fmt(te)} total · Resta € ${fmt(re)}</small>${tb?`<br><small style="color:#475569">R$ ${fmt(tb)} total · Resta R$ ${fmt(rb||0)}</small>`:""} ${renderProgress(pe,te)}<div class="actions">${!q?`<button class="btn-pagar" onclick="abrirModalPagamento('${i.id}')">💸 Pagar</button><button class="btn-corrigir" onclick="abrirModalCorrigir('${i.id}')">🔧 Corrigir</button>`:d.recorrente?`<button class="btn-renovar" onclick="renovarDivida('${i.id}')">🔄 Renovar</button>`:""}<button class="btn-remover" onclick="deletarItem('dividas','${i.id}','${de}')">🗑️ Remover</button></div></div>`;
    });
    document.getElementById("count-dividas").textContent = snap.size||"";
    document.getElementById("lista-dividas").innerHTML = html||"<p style='color:#94a3b8'>Nenhuma dívida</p>";
    atualizarResumo();
  }); unsubs.push(u);
}

// =====================
// MÓDULO CLIENTES
// =====================
window.abrirModalCliente = (id=null) => {
  clienteEditId = id;
  document.getElementById("cliente-modal-titulo").textContent = id ? "✏️ Editar Cliente" : "➕ Novo Cliente";
  if (id) {
    const d = recuperar(id);
    document.getElementById("c-nome").value     = d.nome||"";
    document.getElementById("c-empresa").value  = d.empresa||"";
    document.getElementById("c-email").value    = d.email||"";
    document.getElementById("c-telefone").value = d.telefone||"";
    document.getElementById("c-status").value   = d.status||"Ativo";
    document.getElementById("c-notas").value    = d.notas||"";
  } else {
    ["c-nome","c-empresa","c-email","c-telefone","c-notas"].forEach(f => document.getElementById(f).value="");
    document.getElementById("c-status").value = "Ativo";
  }
  document.getElementById("modal-cliente").classList.add("active");
};

window.salvarCliente = async () => {
  const nome     = document.getElementById("c-nome").value.trim();
  const empresa  = document.getElementById("c-empresa").value.trim();
  const email    = document.getElementById("c-email").value.trim();
  const telefone = document.getElementById("c-telefone").value.trim();
  const status   = document.getElementById("c-status").value;
  const notas    = document.getElementById("c-notas").value.trim();
  if (!nome) return alert("Informe o nome");
  const payload = { nome, empresa, email, telefone, status, notas, criadoEm: Date.now() };
  if (clienteEditId) {
    await updateDoc(docRef("clientes", clienteEditId), payload);
  } else {
    await addDoc(col("clientes"), payload);
  }
  fecharModal("modal-cliente");
};

window.deletarCliente = async (id, nome) => {
  if (!confirm(`Remover cliente "${nome}"?`)) return;
  await deleteDoc(docRef("clientes", id));
};

window.filtrarClientes = () => renderClientes(_clientes);

function renderClientes(lista) {
  const busca   = (document.getElementById("filtro-cliente")?.value||"").toLowerCase();
  const status  = document.getElementById("filtro-status-cliente")?.value||"";
  const filtrado = lista.filter(c => {
    const matchBusca  = !busca  || c.nome?.toLowerCase().includes(busca) || c.empresa?.toLowerCase().includes(busca) || c.email?.toLowerCase().includes(busca);
    const matchStatus = !status || c.status === status;
    return matchBusca && matchStatus;
  });

  const total = lista.length, ativos = lista.filter(c=>c.status==="Ativo").length, prospects = lista.filter(c=>c.status==="Prospect").length, inativos = lista.filter(c=>c.status==="Inativo").length;
  document.getElementById("stat-clientes-total").textContent     = total;
  document.getElementById("stat-clientes-ativos").textContent    = ativos;
  document.getElementById("stat-clientes-prospects").textContent = prospects;
  document.getElementById("stat-clientes-inativos").textContent  = inativos;

  if (!filtrado.length) { document.getElementById("lista-clientes").innerHTML = "<p style='color:#94a3b8;margin-top:12px'>Nenhum cliente encontrado</p>"; return; }

  let html = "";
  filtrado.forEach(({_id,...c}) => {
    const iniciais = (c.nome||"?").split(" ").slice(0,2).map(p=>p[0]).join("").toUpperCase();
    const de = (c.nome||"").replace(/'/g,"\\'");
    html += `
      <div class="cliente-card">
        <div class="cliente-avatar">${iniciais}</div>
        <div class="cliente-info">
          <div class="cliente-nome">${c.nome}</div>
          <div class="cliente-sub">${c.empresa?c.empresa+" · ":""}${c.email||""}</div>
          ${c.telefone?`<div class="cliente-sub">📞 ${c.telefone}</div>`:""}
          ${c.notas?`<div class="cliente-sub" style="color:#64748b">📝 ${c.notas}</div>`:""}
        </div>
        <span class="status-badge ${c.status}">${c.status}</span>
        <div class="actions" style="flex-direction:column;min-width:80px">
          <button class="btn-editar" onclick="abrirModalCliente('${_id}')">✏️</button>
          <button class="btn-remover" onclick="deletarCliente('${_id}','${de}')">🗑️</button>
        </div>
      </div>`;
  });
  document.getElementById("lista-clientes").innerHTML = html;
}

function iniciarStreamClientes() {
  const u = onSnapshot(query(col("clientes"),orderBy("criadoEm","desc")), snap => {
    _clientes = [];
    snap.forEach(i => { guardar(i.id, i.data()); _clientes.push({_id:i.id,...i.data()}); });
    renderClientes(_clientes);
  }); unsubs.push(u);
}

// =====================
// MÓDULO ESTOQUE
// =====================
window.abrirModalProduto = (id=null) => {
  produtoEditId = id;
  document.getElementById("produto-modal-titulo").textContent = id ? "✏️ Editar Produto" : "➕ Novo Produto";
  if (id) {
    const d = recuperar(id);
    document.getElementById("p-nome").value      = d.nome||"";
    document.getElementById("p-cat").value       = d.categoria||"Outros";
    document.getElementById("p-quantidade").value = d.quantidade||0;
    document.getElementById("p-preco").value     = d.preco||0;
    document.getElementById("p-min").value       = d.minimo||0;
  } else {
    ["p-nome","p-quantidade","p-preco","p-min"].forEach(f => document.getElementById(f).value="");
    document.getElementById("p-cat").value = "Outros";
  }
  document.getElementById("modal-produto").classList.add("active");
};

window.salvarProduto = async () => {
  const nome      = document.getElementById("p-nome").value.trim();
  const categoria = document.getElementById("p-cat").value;
  const quantidade = Number(document.getElementById("p-quantidade").value);
  const preco     = Number(document.getElementById("p-preco").value);
  const minimo    = Number(document.getElementById("p-min").value)||0;
  if (!nome) return alert("Informe o nome do produto");
  const payload = { nome, categoria, quantidade, preco, minimo, criadoEm: Date.now() };
  if (produtoEditId) {
    await updateDoc(docRef("estoque", produtoEditId), payload);
  } else {
    await addDoc(col("estoque"), payload);
  }
  fecharModal("modal-produto");
};

window.deletarProduto = async (id, nome) => {
  if (!confirm(`Remover "${nome}"?`)) return;
  await deleteDoc(docRef("estoque", id));
};

window.filtrarProdutos = () => renderEstoque(_produtos);

function renderEstoque(lista) {
  const busca = (document.getElementById("filtro-produto")?.value||"").toLowerCase();
  const cat   = document.getElementById("filtro-cat-produto")?.value||"";
  const filtrado = lista.filter(p => (!busca || p.nome?.toLowerCase().includes(busca)) && (!cat || p.categoria === cat));

  const valorTotal = lista.reduce((s,p) => s + (p.preco||0)*(p.quantidade||0), 0);
  const baixo = lista.filter(p => p.minimo > 0 && (p.quantidade||0) <= p.minimo).length;
  document.getElementById("stat-produtos-total").textContent   = lista.length;
  document.getElementById("stat-estoque-valor").textContent    = `€ ${fmt(valorTotal)}`;
  document.getElementById("stat-estoque-baixo").textContent    = baixo;

  if (!filtrado.length) { document.getElementById("lista-estoque").innerHTML = "<p style='color:#94a3b8;margin-top:12px'>Nenhum produto encontrado</p>"; return; }

  let html = "";
  filtrado.forEach(({_id,...p}) => {
    const estoqueOk = !p.minimo || (p.quantidade||0) > p.minimo;
    const de = (p.nome||"").replace(/'/g,"\\'");
    html += `
      <div class="produto-card ${estoqueOk?"":"estoque-baixo"}">
        <div class="produto-header">
          <span class="produto-nome">${p.nome}</span>
          <span class="produto-cat">${p.categoria}</span>
        </div>
        <div class="produto-stats">
          <div class="prod-stat"><div class="prod-stat-val" style="color:${estoqueOk?"#22c55e":"#ef4444"}">${p.quantidade||0}</div><div class="prod-stat-label">Em estoque</div></div>
          <div class="prod-stat"><div class="prod-stat-val" style="color:#38bdf8">€ ${fmt(p.preco||0)}</div><div class="prod-stat-label">Preço unit.</div></div>
          <div class="prod-stat"><div class="prod-stat-val">€ ${fmt((p.preco||0)*(p.quantidade||0))}</div><div class="prod-stat-label">Valor total</div></div>
        </div>
        ${!estoqueOk?`<div class="alerta-estoque">⚠️ Estoque abaixo do mínimo (${p.minimo})</div>`:""}
        <div class="actions" style="margin-top:10px">
          <button class="btn-editar" onclick="abrirModalProduto('${_id}')">✏️ Editar</button>
          <button class="btn-remover" onclick="deletarProduto('${_id}','${de}')">🗑️ Remover</button>
        </div>
      </div>`;
  });
  document.getElementById("lista-estoque").innerHTML = html;
}

function iniciarStreamEstoque() {
  const u = onSnapshot(query(col("estoque"),orderBy("criadoEm","desc")), snap => {
    _produtos = [];
    snap.forEach(i => { guardar(i.id, i.data()); _produtos.push({_id:i.id,...i.data()}); });
    renderEstoque(_produtos);
  }); unsubs.push(u);
}

// =====================
// MÓDULO TAREFAS
// =====================
window.abrirModalTarefa = (id=null) => {
  tarefaEditId = id;
  document.getElementById("tarefa-modal-titulo").textContent = id ? "✏️ Editar Tarefa" : "➕ Nova Tarefa";
  if (id) {
    const d = recuperar(id);
    document.getElementById("t-titulo").value    = d.titulo||"";
    document.getElementById("t-desc").value      = d.desc||"";
    document.getElementById("t-prioridade").value = d.prioridade||"Normal";
    document.getElementById("t-status").value    = d.status||"Pendente";
    document.getElementById("t-prazo").value     = d.prazo||"";
  } else {
    ["t-titulo","t-desc","t-prazo"].forEach(f => document.getElementById(f).value="");
    document.getElementById("t-prioridade").value = "Normal";
    document.getElementById("t-status").value     = "Pendente";
  }
  document.getElementById("modal-tarefa").classList.add("active");
};

window.salvarTarefa = async () => {
  const titulo    = document.getElementById("t-titulo").value.trim();
  const desc      = document.getElementById("t-desc").value.trim();
  const prioridade = document.getElementById("t-prioridade").value;
  const status    = document.getElementById("t-status").value;
  const prazo     = document.getElementById("t-prazo").value;
  if (!titulo) return alert("Informe o título");
  const payload = { titulo, desc, prioridade, status, prazo, criadoEm: Date.now() };
  if (tarefaEditId) {
    await updateDoc(docRef("tarefas", tarefaEditId), payload);
  } else {
    await addDoc(col("tarefas"), payload);
  }
  fecharModal("modal-tarefa");
};

window.mudarStatusTarefa = async (id, novoStatus) => {
  const d = recuperar(id); if (!d) return;
  await updateDoc(docRef("tarefas", id), { status: novoStatus });
  guardar(id, { ...d, status: novoStatus });
};

window.deletarTarefa = async (id, titulo) => {
  if (!confirm(`Remover "${titulo}"?`)) return;
  await deleteDoc(docRef("tarefas", id));
};

function renderTarefas(lista) {
  const pendentes   = lista.filter(t => t.status === "Pendente");
  const andamento   = lista.filter(t => t.status === "Em andamento");
  const concluidas  = lista.filter(t => t.status === "Concluída");

  document.getElementById("stat-tarefas-pendentes").textContent  = pendentes.length;
  document.getElementById("stat-tarefas-andamento").textContent  = andamento.length;
  document.getElementById("stat-tarefas-concluidas").textContent = concluidas.length;

  // Badge na sidebar
  const urgentes = lista.filter(t => t.status !== "Concluída" && t.prioridade === "Urgente").length;
  const badge    = document.getElementById("badge-tarefas");
  badge.textContent    = urgentes||"";
  badge.style.display  = urgentes ? "inline-block" : "none";

  const renderGrupo = (grupo, container) => {
    if (!grupo.length) { document.getElementById(container).innerHTML = `<div style="font-size:12px;color:#475569;text-align:center;padding:12px">Vazio</div>`; return; }
    let html = "";
    grupo.forEach(({_id,...t}) => {
      const hoje_d   = new Date(); hoje_d.setHours(0,0,0,0);
      const prazoDate = t.prazo ? new Date(t.prazo+"T00:00:00") : null;
      const vencida   = prazoDate && prazoDate < hoje_d && t.status !== "Concluída";
      const prazoFmt  = prazoDate ? prazoDate.toLocaleDateString("pt-BR") : null;
      const de        = (t.titulo||"").replace(/'/g,"\\'");

      const statusOpts = ["Pendente","Em andamento","Concluída"].filter(s => s !== t.status);
      const btnStatus  = statusOpts.map(s => `<button class="${s==="Concluída"?"btn-renovar":s==="Em andamento"?"btn-pagar":"btn-corrigir"}" onclick="mudarStatusTarefa('${_id}','${s}')">→ ${s==="Em andamento"?"Iniciar":s==="Concluída"?"Concluir":"Reabrir"}</button>`).join("");

      html += `
        <div class="tarefa-card">
          <span class="prioridade-badge ${t.prioridade}">${t.prioridade}</span>
          <div class="tarefa-titulo">${t.titulo}</div>
          ${t.desc?`<div class="tarefa-desc">${t.desc}</div>`:""}
          ${prazoFmt?`<div class="tarefa-prazo ${vencida?"vencida":""}">📅 ${prazoFmt}${vencida?" · ⚠️ Vencida":""}</div>`:""}
          <div class="tarefa-actions">
            ${btnStatus}
            <button class="btn-editar" onclick="abrirModalTarefa('${_id}')">✏️</button>
            <button class="btn-remover" onclick="deletarTarefa('${_id}','${de}')">🗑️</button>
          </div>
        </div>`;
    });
    document.getElementById(container).innerHTML = html;
  };

  renderGrupo(pendentes,  "kanban-pendente");
  renderGrupo(andamento,  "kanban-andamento");
  renderGrupo(concluidas, "kanban-concluida");
}

function iniciarStreamTarefas() {
  const u = onSnapshot(query(col("tarefas"),orderBy("criadoEm","desc")), snap => {
    _tarefas = [];
    snap.forEach(i => { guardar(i.id, i.data()); _tarefas.push({_id:i.id,...i.data()}); });
    renderTarefas(_tarefas);
  }); unsubs.push(u);
}

// =====================
// INICIALIZAR
// =====================
async function inicializar() {
  await pegarCambio();
  const h = hoje();
  ["r-data","d-data"].forEach(id => { const el=document.getElementById(id); if(el) el.value=h; });

  iniciarStreamReceitas();
  iniciarStreamDespesas();
  iniciarStreamDividas();
  iniciarStreamHistorico();
  iniciarStreamClientes();
  iniciarStreamEstoque();
  iniciarStreamTarefas();
}
