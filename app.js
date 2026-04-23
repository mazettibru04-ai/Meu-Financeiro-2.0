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
// 🔐 USUÁRIO
// =====================
function getPath(nome) {
if (!window.userId) return null;
return collection(db, "usuarios", window.userId, nome);
}

// =====================
// CACHE
// =====================
const _cache = {};
function guardar(id, data) { _cache[id] = data; }
function recuperar(id) { return _cache[id] || null; }

// =====================
// VARIÁVEIS
// =====================
let taxa = 0;
let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;
let chart;

// =====================
// FORMAT
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
document.getElementById("saldo-real").innerText = `Saldo real: € ${fmt(saldoReal)}`;

atualizarGrafico();
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
backgroundColor: ["#22c55e", "#ef4444", "#3b82f6"]
}]
},
options: {
plugins: { legend: { display: false } }
}
});
}

// =====================
// HISTÓRICO
// =====================
async function registrarHistorico(acao, desc, valor, moeda) {
const ref = getPath("historico");
if (!ref) return;

await addDoc(ref, {
acao,
desc,
valor: String(valor),
moeda,
criadoEm: Date.now()
});
}

// =====================
// ADD RECEITA
// =====================
window.addReceita = async function () {
const ref = getPath("receitas");
if (!ref) return alert("Faça login");

const desc = document.getElementById("r-desc").value.trim();
const cat = document.getElementById("r-cat").value;
const val = Number(document.getElementById("r-val").value);
const moeda = document.getElementById("r-moeda").value;

if (!desc || val <= 0) return alert("Preencha corretamente");

await addDoc(ref, {
desc,
categoria: cat,
val,
moeda,
criadoEm: Date.now()
});

await registrarHistorico("➕ Receita", desc, val, moeda);

document.getElementById("r-desc").value = "";
document.getElementById("r-val").value = "";
};

// =====================
// ADD DESPESA
// =====================
window.addDespesa = async function () {
const ref = getPath("despesas");
if (!ref) return alert("Faça login");

const desc = document.getElementById("d-desc").value.trim();
const cat = document.getElementById("d-cat").value;
const val = Number(document.getElementById("d-val").value);
const moeda = document.getElementById("d-moeda").value;

if (!desc || val <= 0) return alert("Preencha corretamente");

await addDoc(ref, {
desc,
categoria: cat,
val,
moeda,
criadoEm: Date.now()
});

await registrarHistorico("➖ Despesa", desc, val, moeda);

document.getElementById("d-desc").value = "";
document.getElementById("d-val").value = "";
};

// =====================
// ADD DÍVIDA
// =====================
window.addDivida = async function () {
const ref = getPath("dividas");
if (!ref) return alert("Faça login");

const desc = document.getElementById("div-desc").value.trim();
const valor = Number(document.getElementById("div-valor").value);
const moeda = document.getElementById("div-moeda").value;

if (!desc || valor <= 0) return alert("Preencha corretamente");

await addDoc(ref, {
desc,
valorOriginal: valor,
moeda,
pago: 0,
criadoEm: Date.now()
});

await registrarHistorico("💳 Dívida", desc, valor, moeda);

document.getElementById("div-desc").value = "";
document.getElementById("div-valor").value = "";
};

// =====================
// STREAM GENÉRICO
// =====================
function stream(nome, callback) {
const ref = getPath(nome);
if (!ref) return;

const q = query(ref, orderBy("criadoEm", "desc"));
onSnapshot(q, callback);
}

// =====================
// STREAMS
// =====================
function iniciarStreams() {

// RECEITAS
stream("receitas", (snap) => {
totalReceitas = 0;
let html = "";

```
snap.forEach((i) => {
  const r = i.data();
  const v = eur(r.val, r.moeda);
  totalReceitas += v;

  html += `<div class="card">${r.desc} - € ${fmt(v)}</div>`;
});

document.getElementById("lista-receitas").innerHTML =
  html || "<p style='color:#94a3b8'>Nenhuma receita</p>";

atualizarResumo();
```

});

// DESPESAS
stream("despesas", (snap) => {
totalDespesas = 0;
let html = "";

```
snap.forEach((i) => {
  const d = i.data();
  const v = eur(d.val, d.moeda);
  totalDespesas += v;

  html += `<div class="card">${d.desc} - € ${fmt(v)}</div>`;
});

document.getElementById("lista-despesas").innerHTML =
  html || "<p style='color:#94a3b8'>Nenhuma despesa</p>";

atualizarResumo();
```

});

// DÍVIDAS
stream("dividas", (snap) => {
totalDividas = 0;
let html = "";

```
snap.forEach((i) => {
  const d = i.data();
  const total = eur(d.valorOriginal, d.moeda);
  const pago = eur(d.pago || 0, d.moeda);
  const resta = total - pago;

  totalDividas += resta;

  html += `<div class="card">${d.desc} - € ${fmt(resta)}</div>`;
});

document.getElementById("lista-dividas").innerHTML =
  html || "<p style='color:#94a3b8'>Nenhuma dívida</p>";

atualizarResumo();
```

});

// HISTÓRICO
stream("historico", (snap) => {
let html = "";

```
snap.forEach((i) => {
  const h = i.data();
  html += `<p>${h.acao} - ${h.desc}</p>`;
});

document.getElementById("lista-historico").innerHTML =
  html || "<p style='color:#94a3b8'>Nenhuma alteração</p>";
```

});

}

// =====================
// INICIAR
// =====================
setInterval(() => {
if (window.userId && !window._started) {
window._started = true;
pegarCambio();
iniciarStreams();
}
}, 500);
