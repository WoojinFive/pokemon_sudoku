/**
 * firebase.js — Leaderboard via Firebase Firestore (compat SDK, regular script)
 * Sets window.FirebaseLeaderboard
 */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyD7Az9004lQBUOV1Xy39zXGyzzkjKFMVko",
    authDomain: "pray-app-6d39c.firebaseapp.com",
    projectId: "pray-app-6d39c",
    storageBucket: "pray-app-6d39c.firebasestorage.app",
    messagingSenderId: "86338965287",
    appId: "1:86338965287:web:1d8e50108c16a741076302"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();
  const COL = 'sudoku_leaderboard';

  async function getTopScores() {
    const snap = await db.collection(COL).orderBy('time', 'asc').limit(10).get();
    return snap.docs.map(d => d.data());
  }

  async function addScore(name, timeSeconds) {
    await db.collection(COL).add({
      name: name.trim() || 'Anonymous',
      time: timeSeconds,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async function qualifiesForTop10(timeSeconds) {
    const scores = await getTopScores();
    if (scores.length < 10) return true;
    return timeSeconds < scores[scores.length - 1].time;
  }

  window.FirebaseLeaderboard = { getTopScores, addScore, qualifiesForTop10 };
  console.log('FirebaseLeaderboard ready');
})();
