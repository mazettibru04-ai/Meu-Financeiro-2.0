import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCLSxAGB178Pm4EtWHLNXhE_xDj-XAuHFQ",
  authDomain: "meu-financeiro.firebaseapp.com",
  projectId: "meu-financeiro",
  storageBucket: "meu-financeiro.appspot.com",
  messagingSenderId: "836819309794",
  appId: "1:836819309794:web:7e0526e138dea6d2cebabb"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
  db,
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc
};
