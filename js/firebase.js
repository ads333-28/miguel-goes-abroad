// Connects the site to the group's Firebase database.
// These values identify the project; they are not passwords.
// Who can read and write is controlled by the Firestore security rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCpFIRk9UECOea769F-IY866Ovf4Efqew8",
  authDomain: "miguel-goes-abroad.firebaseapp.com",
  projectId: "miguel-goes-abroad",
  storageBucket: "miguel-goes-abroad.firebasestorage.app",
  messagingSenderId: "836948375040",
  appId: "1:836948375040:web:68e2e4f48ae0f50ba68ae5"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
