/**
 * Persistenza JSON su file (zero dipendenze).
 * - Lettura lazy: il file viene letto al primo accesso e tenuto in memoria.
 * - Scrittura atomica: tmp + fs.rename (come la persist della cache in server.js).
 * - Coda di scritture: serializza le scritture per non corrompere il file
 *   quando arrivano richieste concorrenti.
 *
 * I file vivono in data/ (già bloccato dal server statico e in .gitignore).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  visits: path.join(DATA_DIR, 'visits.json'),
};

/** Default strutturati per ogni archivio (evita undefined su file assenti). */
const DEFAULTS = {
  users: { users: [] },
  sessions: { sessions: {} },
  visits: { visits: [] },
};

/** Coda di scrittura globale: ogni scrittura attende la precedente. */
let writeChain = Promise.resolve();

let memory = null; // { [fileKey]: dati in memoria }

/** Legge (con cache) l'archivio indicato. */
function load(key) {
  if (memory && key in memory) return memory[key];
  mkdirData();
  let data = null;
  try {
    const raw = fs.readFileSync(FILES[key], 'utf8');
    data = JSON.parse(raw);
  } catch {
    /* file assente o corrotto → default */
  }
  if (!data || typeof data !== 'object') data = DEFAULTS[key];
  if (!memory) memory = {};
  memory[key] = data;
  return data;
}

function mkdirData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* già presente */ }
}

/** Scrive l'archivio su disco (atomico, serializzato con la coda). */
function save(key, data) {
  memory = memory || {};
  memory[key] = data;
  writeChain = writeChain.then(() => persistFile(FILES[key], data));
  return writeChain;
}

function persistFile(file, data) {
  return new Promise((resolve, reject) => {
    mkdirData();
    const tmp = `${file}.tmp`;
    fs.writeFile(tmp, JSON.stringify(data), (err) => {
      if (err) return reject(err);
      fs.rename(tmp, file, (e) => (e ? reject(e) : resolve()));
    });
  });
}

/* -------------------------------------------------------------------------- */
/* API esposte                                                                */
/* -------------------------------------------------------------------------- */

function getUsers() {
  return load('users');
}
function saveUsers(usersObj) {
  return save('users', usersObj);
}

function getSessions() {
  return load('sessions');
}
function saveSessions(sessionsObj) {
  return save('sessions', sessionsObj);
}

function getVisits() {
  return load('visits');
}
function saveVisits(visitsObj) {
  return save('visits', visitsObj);
}

module.exports = {
  getUsers,
  saveUsers,
  getSessions,
  saveSessions,
  getVisits,
  saveVisits,
  DATA_DIR,
};