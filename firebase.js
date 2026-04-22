// =============================================
// SUBSTITUA pelos dados do seu projeto Firebase
// Console: https://console.firebase.google.com
// =============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLSxAGB178Pm4EtWHLNXhE_xDj-XAuHFQ",
  authDomain: "meu-fincaneiro.firebaseapp.com",
  projectId: "meu-fincaneiro",
  storageBucket: "meu-fincaneiro.firebasestorage.app",
  messagingSenderId: "836819309794",
  appId: "1:836819309794:web:7e0526e138dea6d2cebabb",
  measurementId: "G-ESG21PJSJ1"
};

const app = initializeApp(firebaseConfig);

export const db   = getFirestore(app);
export const auth = getAuth(app);
