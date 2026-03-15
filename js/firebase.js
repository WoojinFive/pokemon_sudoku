/**
 * firebase.js — Leaderboard via Firebase Firestore
 * Loaded as a module; exposes window.FirebaseLeaderboard
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7Az9004lQBUOV1Xy39zXGyzzkjKFMVko",
  authDomain: "pray-app-6d39c.firebaseapp.com",
  projectId: "pray-app-6d39c",
  storageBucket: "pray-app-6d39c.firebasestorage.app",
  messagingSenderId: "86338965287",
  appId: "1:86338965287:web:1d8e50108c16a741076302"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const COL = 'sudoku_leaderboard';

async function getTopScores() {
  const q = query(collection(db, COL), orderBy('time', 'asc'), limit(10));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

async function addScore(name, timeSeconds) {
  await addDoc(collection(db, COL), {
    name: name.trim() || 'Anonymous',
    time: timeSeconds,
    createdAt: serverTimestamp()
  });
}

async function qualifiesForTop10(timeSeconds) {
  const scores = await getTopScores();
  if (scores.length < 10) return true;
  return timeSeconds < scores[scores.length - 1].time;
}

window.FirebaseLeaderboard = { getTopScores, addScore, qualifiesForTop10 };
