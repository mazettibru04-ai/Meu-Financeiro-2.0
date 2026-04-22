// auth.js
import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// REGISTRAR
window.registrar = async () => {
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  try {
    await createUserWithEmailAndPassword(auth, email, senha);
    alert("Conta criada!");
  } catch (e) {
    alert(e.message);
  }
};

// LOGIN
window.login = async () => {
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;

  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (e) {
    alert(e.message);
  }
};

// LOGOUT
window.logout = async () => {
  await signOut(auth);
};

// CONTROLE DE SESSÃO
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.userId = user.uid;

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("app").style.display = "block";
  } else {
    document.getElementById("loginBox").style.display = "block";
    document.getElementById("app").style.display = "none";
  }
});
