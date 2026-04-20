import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let taxa = 0;

let totalReceitas = 0;
let totalDespesas = 0;
let totalDividas = 0;

// =====================
// 💱 CÂMBIO
// =====================
async function pegarCambio() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
    const data = await res.json();

    taxa = data?.rates?.BRL || 0;

    document.getElementById("cambio").innerText =
      taxa ? `€1 = R$ ${taxa.toFixed(2)}` : "Câmbio indisponível";

  } catch (err) {
    console.error(err);
    document.getElementById("cambio").innerText = "Erro ao carregar câmbio";
  }
}

pegarCambio();

// =====================
// CONVERSÃO
// =====================
function converterParaEUR(valor, moeda) {
  if (moeda === "EUR") return valor;
  if (moeda === "BRL") return valor / taxa;
  return valor;
}

// =====================
// RESUMO
// =====================
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;
  const saldoReal = totalReceitas - totalDespesas - totalDividas;

  document.getElementById("total-receitas").textContent =
    `Receitas: € ${totalReceitas.toFixed(2)}`;

  document.getElementById("total-despesas").textContent =
    `Despesas: € ${totalDespesas.toFixed(2)}`;

  document.getElementById("total-dividas").textContent =
    `Dívidas: € ${totalDividas.toFixed(2)}`;

  document.getElementById("saldo").textContent =
    `Saldo: € ${saldo.toFixed(2)}`;

  document.getElementById("saldo-real").textContent =
    `Saldo real (com dívidas): € ${saldoReal.toFixed(2)}`;
}

// =====================
// RECEITA
// =====================
window.addReceita = async function () {
  const desc = document.getElementById("r-desc").value.trim();
  const val = Number(document.getElementById("r-val").value);
  const moeda = document.getElementById("r-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "receitas"), {
    desc,
    val,
    moeda,
    criadoEm: Date.now()
  });

  document.getElementById("r-desc").value = "";
  document.getElementById("r-val").value = "";
};

// =====================
// DESPESA
// =====================
window.addDespesa = async function () {
  const desc = document.getElementById("d-desc").value.trim();
  const val = Number(document.getElementById("d-val").value);
  const moeda = document.getElementById("d-moeda").value;

  if (!desc || val <= 0) return alert("Preencha corretamente");

  await addDoc(collection(db, "despesas"), {
    desc,
    val,
    moeda,
    criadoEm: Date.now()
  });

  document.getElementById("d-desc").value = "";
  document.getElementById("d-val").value = "";
};

// =====================
// RECEITAS STREAM
// =====================
onSnapshot(collection(db, "receitas"), (snapshot) => {
  totalReceitas = 0;

  const container = document.getElementById("lista-receitas");
  let html = "";

  snapshot.forEach((item) => {
    const r = item.data();
    const val = Number(r.val || 0);
    const moeda = r.moeda || "EUR";

    const convertido = converterParaEUR(val, moeda);

    totalReceitas += convertido;

    html += `
      <div class="card">
        <strong>${r.desc}</strong>
        <p>${moeda} ${val.toFixed(2)}</p>
        <small>≈ € ${convertido.toFixed(2)}</small>
      </div>
    `;
  });

  container.innerHTML = html;
  atualizarResumo();
});

// =====================
// DESPESAS STREAM
// =====================
onSnapshot(collection(db, "despesas"), (snapshot) => {
  totalDespesas = 0;

  const container = document.getElementById("lista-despesas");
  let html = "";

  snapshot.forEach((item) => {
    const d = item.data();
    const val = Number(d.val || 0);
    const moeda = d.moeda || "EUR";

    const convertido = converterParaEUR(val, moeda);

    totalDespesas += convertido;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>${moeda} ${val.toFixed(2)}</p>
        <small>≈ € ${convertido.toFixed(2)}</small>
      </div>
    `;
  });

  container.innerHTML = html;
  atualizarResumo();
});

// =====================
// DÍVIDAS
// =====================
window.addDivida = async function () {
  const desc = document.getElementById("div-desc").value.trim();
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

  document.getElementById("div-desc").value = "";
  document.getElementById("div-valor").value = "";
};

// =====================
// LISTA DÍVIDAS
// =====================
onSnapshot(collection(db, "dividas"), (snapshot) => {
  totalDividas = 0;

  const container = document.getElementById("lista-dividas");
  let html = "";

  snapshot.forEach((item) => {
    const d = item.data();
    const moeda = d.moeda || "EUR";

    const total = converterParaEUR(Number(d.valorOriginal || 0), moeda);
    const pago = converterParaEUR(Number(d.pago || 0), moeda);

    const restante = total - pago;
    const progresso = total ? (pago / total) * 100 : 0;

    totalDividas += total;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>

        <p>Total: ${moeda} ${Number(d.valorOriginal).toFixed(2)}</p>
        <p>Pago: ${moeda} ${Number(d.pago || 0).toFixed(2)}</p>

        <p>≈ Falta: € ${restante.toFixed(2)}</p>

        <input id="pagar-${item.id}" type="number" placeholder="Valor pago">
        <button onclick="pagarDivida('${item.id}', ${d.pago || 0})">
          Pagar
        </button>

        <small>${progresso.toFixed(1)}% pago</small>
      </div>
    `;
  });

  container.innerHTML = html;
  atualizarResumo();
});

// =====================
// PAGAR DÍVIDA
// =====================
window.pagarDivida = async function (id, atual) {
  const input = document.getElementById(`pagar-${id}`);
  const valor = Number(input.value);

  if (!valor || valor <= 0) return alert("Valor inválido");

  await updateDoc(doc(db, "dividas", id), {
    pago: atual + valor
  });

  input.value = "";
};
