import { db, collection, addDoc, onSnapshot } from "./firebase.js";

let taxa = 0;
let totalReceitas = 0;
let totalDespesas = 0;

// 💱 PEGAR CÂMBIO AUTOMÁTICO
async function pegarCambio() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
    const data = await res.json();

    taxa = data.rates.BRL;

    document.getElementById("cambio").innerText =
      "€1 = R$ " + taxa.toFixed(2);
  } catch (e) {
    console.error(e);
    document.getElementById("cambio").innerText = "Erro ao carregar câmbio";
  }
}

pegarCambio();

// 🔄 ATUALIZAR RESUMO
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;

  document.getElementById("total-receitas").innerText =
    "Receitas: € " + totalReceitas.toFixed(2);

  document.getElementById("total-despesas").innerText =
    "Despesas: € " + totalDespesas.toFixed(2);

  document.getElementById("saldo").innerText =
    "Saldo: € " + saldo.toFixed(2);
}

// ➕ SALVAR RECEITA
window.addReceita = async function () {
  try {
    const desc = document.getElementById("r-desc").value;
    const val = parseFloat(document.getElementById("r-val").value);

    if (!desc || !val) {
      alert("Preencha tudo");
      return;
    }

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
  }
};

// ➖ SALVAR DESPESA
window.addDespesa = async function () {
  try {
    const desc = document.getElementById("d-desc").value;
    const val = parseFloat(document.getElementById("d-val").value);

    if (!desc || !val) {
      alert("Preencha tudo");
      return;
    }

    await addDoc(collection(db, "despesas"), {
      desc,
      val,
      criadoEm: Date.now()
    });

    document.getElementById("d-desc").value = "";
    document.getElementById("d-val").value = "";

  } catch (e) {
    console.error(e);
    alert("Erro ao salvar despesa");
  }
};

// 📊 LISTAR RECEITAS
onSnapshot(collection(db, "receitas"), (snapshot) => {
  let html = "";
  totalReceitas = 0;

  snapshot.forEach((doc) => {
    const r = doc.data();
    totalReceitas += r.val;

    html += `
      <div class="card">
        <strong>${r.desc}</strong>
        <p>€ ${r.val}</p>
        <small>R$ ${taxa ? (r.val * taxa).toFixed(2) : "..."}</small>
      </div>
    `;
  });

  document.getElementById("lista-receitas").innerHTML = html;
  atualizarResumo();
});

// 📉 LISTAR DESPESAS
onSnapshot(collection(db, "despesas"), (snapshot) => {
  let html = "";
  totalDespesas = 0;

  snapshot.forEach((doc) => {
    const d = doc.data();
    totalDespesas += d.val;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>€ ${d.val}</p>
        <small>R$ ${taxa ? (d.val * taxa).toFixed(2) : "..."}</small>
      </div>
    `;
  });

  document.getElementById("lista-despesas").innerHTML = html;
  atualizarResumo();
});

// 💳 ADICIONAR DÍVIDA
window.addDivida = async function () {
  try {
    const desc = document.getElementById("div-desc").value;
    const valor = parseFloat(document.getElementById("div-valor").value);

    if (!desc || !valor) {
      alert("Preencha tudo");
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

  } catch (e) {
    console.error(e);
    alert("Erro ao salvar dívida");
  }
};

// 📋 LISTAR DÍVIDAS
onSnapshot(collection(db, "dividas"), (snapshot) => {
  let html = "";

  snapshot.forEach((doc) => {
    const d = doc.data();

    const restante = d.valorOriginal - d.pago;
    const progresso = (d.pago / d.valorOriginal) * 100;

    html += `
      <div class="card">
        <strong>${d.desc}</strong>
        <p>Total: R$ ${d.valorOriginal}</p>
        <p>Pago: R$ ${d.pago}</p>
        <p>Falta: R$ ${restante}</p>
        <p>€ ${(restante / taxa).toFixed(2)}</p>
        <p>Progresso: ${progresso.toFixed(1)}%</p>

        <input id="pagar-${doc.id}" type="number" placeholder="Valor pago">
        <button onclick="pagarDivida('${doc.id}', ${d.pago})">Pagar</button>
      </div>
    `;
  });

  document.getElementById("lista-dividas").innerHTML = html;
});

// 💸 PAGAR DÍVIDA
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

window.pagarDivida = async function (id, pagoAtual) {
  try {
    const valor = parseFloat(document.getElementById(`pagar-${id}`).value);

    if (!valor) {
      alert("Digite um valor");
      return;
    }

    const ref = doc(db, "dividas", id);

    await updateDoc(ref, {
      pago: pagoAtual + valor
    });

  } catch (e) {
    console.error(e);
    alert("Erro ao pagar");
  }
};
