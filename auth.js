// auth.js
import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// =====================
// REGISTRAR
// =====================
window.registrar = async () => {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;

  if (!email || !senha) return alert("Preencha email e senha");

  try {
    await createUserWithEmailAndPassword(auth, email, senha);
    alert("Conta criada! Você já está logado.");
  } catch (e) {
    alert("Erro ao criar conta: " + e.message);
  }
};

// =====================
// LOGIN
// =====================
window.login = async () => {
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;

  if (!email || !senha) return alert("Preencha email e senha");

  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (e) {
    alert("Erro ao entrar: " + e.message);
  }
};

// =====================
// LOGOUT
// =====================
window.logout = async () => {
  if (!confirm("Tem certeza que deseja sair?")) return;
  window.userId = null;
  await signOut(auth);
};

// =====================
// CONTROLE DE SESSÃO
// Quando o usuário faz login/logout, esta função é chamada automaticamente.
// Ela define window.userId e chama window.iniciarApp() do app.js.
// =====================
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Guarda o userId globalmente — app.js usa via getCol() e getDoc()
    window.userId = user.uid;

    // Mostra o app, esconde o login
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("app").style.display      = "block";

    // Inicia o sistema (streams, câmbio, etc)
    // Pequeno delay garante que app.js já foi carregado pelo browser
    if (typeof window.iniciarApp === "function") {
      window.iniciarApp();
    } else {
      // Fallback: espera o módulo carregar (raramente necessário)
      setTimeout(() => {
        if (typeof window.iniciarApp === "function") window.iniciarApp();
      }, 300);
    }

  } else {
    window.userId = null;

    // Mostra login, esconde o app
    document.getElementById("loginBox").style.display = "block";
    document.getElementById("app").style.display      = "none";
  }
});
