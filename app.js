import { db, collection, addDoc, onSnapshot } from "./firebase.js";

let taxa = 0;

// 💱 PEGAR CÂMBIO AUTOMÁTICO
async function pegarCambio() {
  const res = await fetch("https://api.exchangerate-api.com/v4/latest/EUR");
  const data = await res.json();

  taxa = data.rates.BRL;

  document.getElementById("cambio").innerText =
    "€1 = R$ " + taxa.toFixed(2);
}

pegarCambio();

// ➕ SALVAR RECEITA
window.addReceita = async function () {
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
        <small>R$ ${(r.val * taxa).toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-receitas").innerHTML = html;
  atualizarResumo();
});

  document.getElementById("lista-receitas").innerHTML = html;
});
window.addDespesa = async function () {
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
};
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
        <small>R$ ${(d.val * taxa).toFixed(2)}</small>
      </div>
    `;
  });

  document.getElementById("lista-despesas").innerHTML = html;
  atualizarResumo();
});
let totalReceitas = 0;
let totalDespesas = 0;

// 🔄 Atualizar resumo
function atualizarResumo() {
  const saldo = totalReceitas - totalDespesas;

  document.getElementById("total-receitas").innerText =
    "Receitas: € " + totalReceitas.toFixed(2);

  document.getElementById("total-despesas").innerText =
    "Despesas: € " + totalDespesas.toFixed(2);

  document.getElementById("saldo").innerText =
    "Saldo: € " + saldo.toFixed(2);
}
