import { db } from "./firebase.js";
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc
} from "firebase/firestore";

let taxa = 0;
let totalReceitas = 0;
let totalDespesas = 0;

// 💱 CÂMBIO
async function pegarCambio() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
    const data = await res.json();

    taxa = data?.rates?.BRL ?? 0;

    document.getElementById("cambio").innerText =
      taxa ? `€1 = R$ ${taxa.toFixed(2)}` : "Câmbio indisponível";

  } catch (e) {
    console.error(e);
    document.getElementById("cambio").innerText = "Erro ao carregar câmbio";
  }
}

pegarCambio();

// 🔄 RESUMO
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;

  document.getElementById("total-receitas").innerText =
    `Receitas: € ${totalReceitas.toFixed(2)}`;

  document.getElementById("total-despesas").innerText =
    `Despesas: € ${totalDespesas.toFixed(2)}`;

  document.getElementById("saldo").innerText =
    `Saldo: € ${saldo.toFixed(2)}`;
}

// ➕ RECEITA
window.addReceita = async function (event) {
  const btn = event.target;

  try {
    const desc = document.getElementById("r-desc").value.trim();
    const val = Number(document.getElementById("r-val").value);

    if (!desc || isNaN(val) || val <= 0) {
      alert("Preencha corretamente");
      return;
    }

    btn.disabled = true;

    await addDoc(collection(db, "receitas"), {
      desc,
      val,
      criadoEm: Date.now()
    });

    document.getElementById("r-desc").value = "";
    document.getElementById("r-val").value = "";

  } catch (e) {
    console.error(e);
    alert("Erro ao salvar receita");
  } finally {
    btn.disabled = false;
  }
};

// ➖ DESPESA
window.addDespesa = async function (event) {
  const btn = event.target;

  try {
    const desc = document.getElementById("d-desc").value.trim();
    const val = Number(document.getElementById("d-val").value);

    if (!desc || isNaN(val) || val <= 0) {
      alert("Preencha corretamente");
      return;
    }

    btn.disabled = true;

    await addDoc(collection(db, "despesas"), {
      desc,
      val,
      criadoEm: Date.now()
    });

    document.getElementById("d-desc").value = "";
    document.getElementById("d-val").value = "";

  } finally {
    btn.disabled = false;
  }
};

// 📊 RECEITAS
onSnapshot(collection(db, "receitas"), (snapshot) => {
  let html = "";
  totalReceitas = 0;

  snapshot.forEach((docItem) => {
    const r = docItem.data();
    const val = Number(r.val) || 0;

    totalReceitas += val;

    html += `
      <div class="card">
        <strong>${r.desc || "Sem descrição"}</strong>
        <p>€ ${val.toFixed(2)}</p>
        <small>R$ ${taxa ? (val * taxa).toFixed(2) : "..."}</small>
      </div>
    `;
  });

  document.getElementById("lista-receitas").innerHTML = html;
  atualizarResumo();
});

// 📉 DESPESAS
onSnapshot(collection(db, "despesas"), (snapshot) => {
  let html = "";
  totalDespesas = 0;

  snapshot.forEach((docItem) => {
    const d = docItem.data();
    const val = Number(d.val) || 0;

    totalDespesas += val;

    html += `
      <div class="card">
        <strong>${d.desc || "Sem descrição"}</strong>
        <p>€ ${val.toFixed(2)}</p>
        <small>R$ ${taxa ? (val * taxa).toFixed(2) : "..."}</small>
      </div>
    `;
  });

  document.getElementById("lista-despesas").innerHTML = html;
  atualizarResumo();
});

// 💳 DÍVIDA
window.addDivida = async function () {
  const desc = document.getElementById("div-desc").value.trim();
  const valor = Number(document.getElementById("div-valor").value);

  if (!desc || isNaN(valor) || valor <= 0) {
    alert("Preencha corretamente");
    return;
  }

  await addDoc(collection(db, "dividas"), {
    desc,
    valorOriginal: valor,
    pago: 0,
    criadoEm: Date.now()
  });

  document.getElementById("div-desc").value = "";
  document.getElementById("div-valor").value = "";
};

// 📋 DÍVIDAS
onSnapshot(collection(db, "dividas"), (snapshot) => {
  let html = "";

  snapshot.forEach((docItem) => {
    const d = docItem.data();

    const pago = Number(d.pago) || 0;
    const total = Number(d.valorOriginal) || 0;
    const restante = total - pago;
    const progresso = total > 0 ? (pago / total) * 100 : 0;

    html += `
      <div class="card">
        <strong>${d.desc || "Sem descrição"}</strong>
        <p>Total: R$ ${total.toFixed(2)}</p>
        <p>Pago: R$ ${pago.toFixed(2)}</p>
        <p>Falta: R$ ${restante.toFixed(2)}</p>
        <p>€ ${taxa ? (restante / taxa).toFixed(2) : "..."}</p>
        <p>Progresso: ${progresso.toFixed(1)}%</p>

        <input id="pagar-${docItem.id}" type="number" placeholder="Valor pago">
        <button onclick="pagarDivida('${docItem.id}', ${pago})">
          Pagar
        </button>
      </div>
    `;
  });

  document.getElementById("lista-dividas").innerHTML = html;
});

// 💸 PAGAR DÍVIDA
window.pagarDivida = async function (id, pagoAtual) {
  const input = document.getElementById(`pagar-${id}`);
  const valor = Number(input.value);

  if (isNaN(valor) || valor <= 0) {
    alert("Digite um valor válido");
    return;
  }

  const ref = doc(db, "dividas", id);

  await updateDoc(ref, {
    pago: (Number(pagoAtual) || 0) + valor
  });

  input.value = "";
};
