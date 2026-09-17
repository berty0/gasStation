/**
 * Report di visualizzazione (zero dipendenze).
 * - Ogni visita viene registrata in data/visits.json (cap 5000, prismatura
 *   dei più vecchi).
 * - GET /api/report aggregato SOLO per admin: totali, ospiti, per-utente e
 *   visite recenti.
 */
'use strict';

const store = require('./store');

const MAX_VISITS = 5000;
const RECENT_LIMIT = 60;

function recordVisit(user, req) {
  const visits = store.getVisits();
  visits.visits.push({
    ts: Date.now(),
    userId: user ? user.id : null,
    name: user ? `${user.name} ${user.surname}` : null,
    page: '/',
    ua: String((req.headers['user-agent'] || '').slice(0, 200)),
  });

  // Cap: tieni solo le più recenti.
  if (visits.visits.length > MAX_VISITS) {
    visits.visits = visits.visits.slice(visits.visits.length - MAX_VISITS);
  }
  store.saveVisits(visits);
}

/**
 * Aggregato per la pagina Report:
 * {
 *   total, guests,
 *   users: [{ userId, name, email, count, lastSeen }],
 *   recent: [{ ts, name, page }]
 * }
 */
function getReport() {
  const visits = store.getVisits().visits;
  const users = store.getUsers().users;

  const total = visits.length;
  const registered = visits.filter((v) => v.userId);
  const guestCount = total - registered.length;

  // Conteggio per utente (basato serve su visits, nome corrente da users).
  const byUser = new Map();
  for (const v of registered) {
    const rec = byUser.get(v.userId) || { userId: v.userId, count: 0, lastSeen: 0 };
    rec.count++;
    if (v.ts > rec.lastSeen) rec.lastSeen = v.ts;
    byUser.set(v.userId, rec);
  }

  const userRows = Array.from(byUser.values()).map((rec) => {
    const prof = users.find((u) => u.id === rec.userId);
    return {
      userId: rec.userId,
      name: prof ? `${prof.name} ${prof.surname}` : rec.name || '—',
      email: prof ? prof.email : '—',
      count: rec.count,
      lastSeen: rec.lastSeen,
    };
  }).sort((a, b) => b.count - a.count);

  const recent = visits.slice(-RECENT_LIMIT).reverse().map((v) => ({
    ts: v.ts,
    name: v.name || 'Ospite',
    page: v.page || '/',
  }));

  return {
    total,
    registered: registered.length,
    guests: guestCount,
    users: userRows,
    recent,
  };
}

module.exports = { recordVisit, getReport };