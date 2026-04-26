import { db } from "../firebase.js";
import { collection, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ensureUserId } from "./security.js";

export function getUserCollection(name) {
  const userId = ensureUserId();
  if (!userId) {
    console.warn("getUserCollection: userId não definido");
    return null;
  }
  return collection(db, "usuarios", userId, name);
}

export function getUserDoc(collectionName, id) {
  const userId = ensureUserId();
  if (!userId) {
    console.warn("getUserDoc: userId não definido");
    return null;
  }
  return doc(db, "usuarios", userId, collectionName, id);
}
