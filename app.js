import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let taxa = 0;

let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;

// =====================
// HISTÓRICO
// =====================
async function log(tipo, colecao, antes, depois) {
  await addDoc(collection(db, "historico"), {
    tipo,
    colecao,
    antes,
    depois,
    data: Date.now()
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

    document.getElementById("cambio").innerText =
      `€1 = R$ ${taxa.toFixed(2)}`;

  } catch (err) {
    document.getElementById("cambio").innerText =
      "Erro ao carregar câmbio";
  }
}

pegarCambio();

// =====================
// CONVERSÃO
// =====================
function eur(v, m) {
  if (m === "EUR") return v;
  if (m === "BRL") return v / taxa;
  return v;
}

// =====================
// RESUMO
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = saldo - totalDividas;

  document.getElementById("total-receitas").innerText =
    `Receitas: € ${totalReceitas.toFixed(2)}`;

  document.getElementById("total-despesas").innerText =
    `Despesas: € ${totalDespesas.toFixed(2)}`;

  document.getElementById("total-dividas").innerText =
    `Dívidas: € ${totalDividas.toFixed(2)}`;

  document.getElementById("saldo").innerText =
    `Saldo: € ${saldo.toFixed(2)}`;

  document.getElementById("saldo-real").innerText =
    `Saldo real (com dívidas): € ${saldoReal.toFixed(2)}`;
}

// =====================
// ➕ RECEITA
// =====================
window.addReceita = async function () {
  const desc = document.getElementById("r-desc").value;
  const val = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "receitas"), {
    desc,
    val,
    moeda,
    criadoEm: Date.now()
  });

  await log("CREATE", "receitas", null, { desc, val, moeda });

  document.getElementById("r-desc").value = "";
  document.getElementById("r-val").value = "";
};

// =====================
// ➖ DESPESA
// =====================
window.addDespesa = async function () {
  const desc = document.getElementById("d-desc").value;
  const val = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "despesas"), {
    desc,
    val,
    moeda,
    criadoEm: Date.now()
  });

  await log("CREATE", "despesas", null, { desc, val, moeda });

  document.getElementById("d-desc").value = "";
  document.getElementById("d-val").value = "";
};

// =====================
// ➕ DÍVIDA
// =====================
window.addDivida = async function () {
  const desc = document.getElementById("div-desc").value;
  const valor = Number(document.getElementById("div-valor").value);
  const moeda = document.getElementById("div-moeda").value;

  if (!desc || valor <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "dividas"), {
    desc,
    valorOriginal: valor,
    moeda,
    pago: 0,
    criadoEm: Date.now()
  });

  await log("CREATE", "dividas", null, { desc, valor, moeda });

  document.getElementById("div-desc").value = "";
  document.getElementById("div-valor").value = "";
};

// =====================
// DELETE
// =====================
window.del = async function (col, id, data) {
  if (!confirm("Tem certeza que deseja excluir?")) return;

  await deleteDoc(doc(db, col, id));
  await log("DELETE", col, data, null);
};

// =====================
// EDIT
// =====================
window.edit = async function (col, id, data) {
  const desc = prompt("Descrição:", data.desc);
  const val = prompt("Valor:", data.val);

  if (!desc || !val) return;

  const updated = { ...data, desc, val: Number(val) };

  await updateDoc(doc(db, col, id), {
    desc,
    val: Number(val)
  });

  await log("EDIT", col, data, updated);
};

// =====================
// RECEITAS STREAM
// =====================
onSnapshot(collection(db, "receitas"), (snap) => {
  totalReceitas = 0;
  let html = "";

  snap.forEach((i) => {
    const r = i.data();
    const v = eur(r.val, r.moeda);

    totalReceitas += v;

    html += `
      <div class="card">
        <strong>${r.desc}</strong>
        <p>${r.moeda} ${r.val}</p>
        <small>€ ${v.toFixed(2)}</small>

        <div class="actions">
          <button onclick='edit("receitas","${i.id}",${JSON.stringify(r)})'>Editar</button>
          <button onclick='del("receitas","${i.id}",${JSON.stringify(r)})'>Excluir</button>
        </div>
      </div>
    `;
  });

  document.getElementById("lista-receitas").innerHTML = html;
  atualizarResumo();
});

// =====================
// DESPESAS STREAM
// =====================
onSnapshot(collection(db, "despesas"), (snap) => {
  totalDespesas = 0;
  let html = "";

  snap.forEach((i) => {
    const d = i.data();
    const v = eur(d.val, d.moeda);

    totalDespesas += v;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>${d.moeda} ${d.val}</p>
        <small>€ ${v.toFixed(2)}</small>

        <div class="actions">
          <button onclick='edit("despesas","${i.id}",${JSON.stringify(d)})'>Editar</button>
          <button onclick='del("despesas","${i.id}",${JSON.stringify(d)})'>Excluir</button>
        </div>
      </div>
    `;
  });

  document.getElementById("lista-despesas").innerHTML = html;
  atualizarResumo();
});

// =====================
// DÍVIDAS STREAM
// =====================
onSnapshot(collection(db, "dividas"), (snap) => {
  totalDividas = 0;
  let html = "";

  snap.forEach((i) => {
    const d = i.data();
    const v = eur(d.valorOriginal, d.moeda);

    totalDividas += v;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>Total: ${d.moeda} ${d.valorOriginal}</p>
        <p>Pago: ${d.pago}</p>

        <div class="actions">
          <button onclick='edit("dividas","${i.id}",${JSON.stringify(d)})'>Editar</button>
          <button onclick='del("dividas","${i.id}",${JSON.stringify(d)})'>Excluir</button>
        </div>
      </div>
    `;
  });

  document.getElementById("lista-dividas").innerHTML = html;
  atualizarResumo();
});

// =====================
// HISTÓRICO
// =====================
onSnapshot(collection(db, "historico"), (snap) => {
  let html = "";

  snap.forEach((i) => {
    const h = i.data();

    html += `
      <div class="card">
        <strong>${h.tipo} - ${h.colecao}</strong>
        <p>ANTES: ${JSON.stringify(h.antes)}</p>
        <p>DEPOIS: ${JSON.stringify(h.depois)}</p>
      </div>
    `;
  });

  document.getElementById("lista-historico").innerHTML = html;
});
