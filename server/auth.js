/**
 * Autenticazione (zero dipendenze).
 * - Password hashate con scrypt (crypto built-in) + salt random per utente.
 * - Sessioni: token random salvate in data/sessions.json, esposte come cookie
 *   HttpOnly (il client non tocca mai il token).
 * - Login fallito → SEMPRE "Email o password errata" (401), mai rivelare
 *   quale campo è sbagliato.
 */
'use strict';

const crypto = require('crypto');
const store = require('./store');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;      // 30 giorni
const COOKIE_NAME = 'benzina_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FAVORITES = 100;

/* -------------------------------------------------------------------------- */
/* Password (scrypt + salt)                                                    */
/* -------------------------------------------------------------------------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [algo, salt, hash] = stored.split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

/* -------------------------------------------------------------------------- */
/* Sessioni su disco (persistono al riavvio del server)                        */
/* -------------------------------------------------------------------------- */

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(userId) {
  const ttl = Date.now() + SESSION_TTL_MS;
  const token = newToken();
  const sess = store.getSessions();
  sess.sessions[token] = { userId, expiresAt: ttl };
  store.saveSessions(sess);
  return token;
}

function destroySession(token) {
  const sess = store.getSessions();
  if (sess.sessions[token]) {
    delete sess.sessions[token];
    store.saveSessions(sess);
  }
}

function userByToken(token) {
  if (!token) return null;
  const sess = store.getSessions();
  const entry = sess.sessions[token];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete sess.sessions[token];
    store.saveSessions(sess);
    return null;
  }
  const users = store.getUsers();
  const user = users.users.find((u) => u.id === entry.userId);
  return user || null;
}

/* -------------------------------------------------------------------------- */
/* Cookie helper                                                               */
/* -------------------------------------------------------------------------- */

function setSessionCookie(res, token) {
  const val = encodeURIComponent(token);
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
  ]);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  ]);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** Utente dalla cookie di sessione corrente, o null. */
function currentUser(req) {
  const token = readCookie(req, COOKIE_NAME);
  return token ? userByToken(token) : null;
}

/** Versione pubblica dell'utente (mai hash/salt). */
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    surname: u.surname,
    email: u.email,
    isAdmin: !!u.isAdmin,
    initials: ((u.name || '')[0] || '') + ((u.surname || '')[0] || ''),
  };
}

function log(msg) {
  console.log(`[Auth] ${msg}`);
}

/* -------------------------------------------------------------------------- */
/* Validazione                                                                 */
/* -------------------------------------------------------------------------- */

function validateRegistration(body) {
  const name = String(body.name || '').trim();
  const surname = String(body.surname || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!name || name.length > 50) return { error: 'Inserisci un nome valido.' };
  if (!surname || surname.length > 50) return { error: 'Inserisci un cognome valido.' };
  if (!EMAIL_RE.test(email) || email.length > 120) return { error: 'Inserisci un indirizzo email valido.' };
  if (password.length < 6) return { error: 'La password deve avere almeno 6 caratteri.' };
  if (password.length > 120) return { error: 'La password è troppo lunga.' };
  return { ok: true, name, surname, email, password };
}

/* -------------------------------------------------------------------------- */
/* Handlers (ritornano { status, body, setCookie?|clearCookie? })              */
/* -------------------------------------------------------------------------- */

function register(body) {
  const v = validateRegistration(body);
  if (!v.ok) return { status: 400, body: { error: 'validation', message: v.error } };

  const users = store.getUsers();
  if (users.users.some((u) => u.email === v.email)) {
    return { status: 400, body: { error: 'email_in_use', message: 'Email già registrata.' } };
  }

  // Il primo utente registrato diventa admin (proprietario).
  const isAdmin = users.users.length === 0;

  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    name: v.name,
    surname: v.surname,
    email: v.email,
    salt: '',
    hash: hashPassword(v.password),
    isAdmin,
    favorites: [],
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
  };

  users.users.push(user);
  store.saveUsers(users);

  const token = createSession(user.id);
  log(`registrato ${user.email}${isAdmin ? ' (admin)' : ''}`);
  return {
    status: 200,
    setCookie: token,
    body: { user: publicUser(user) },
  };
}

function login(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  // Puntualmente lo stesso percorso per email inesistente e password errata:
  // costante nel tempo e messaggio identico → "Email o password errata".
  const users = store.getUsers();
  const user = users.users.find((u) => u.email === email);
  const ok = user ? verifyPassword(password, user.hash) : false;

  if (!user || !ok) {
    // Verifica fittizia per uniformare il timing (evita enumeration via tempo).
    crypto.scryptSync(password, '0000000000000000', 64);
    return {
      status: 401,
      body: { error: 'invalid_credentials', message: 'Email o password errata.' },
    };
  }

  user.lastLoginAt = Date.now();
  store.saveUsers(users);

  const token = createSession(user.id);
  log(`login ${user.email}`);
  return { status: 200, setCookie: token, body: { user: publicUser(user) } };
}

function logout(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) destroySession(token);
  log('logout');
  return { status: 200, clearCookie: true, body: { ok: true } };
}

function me(user) {
  return { status: 200, body: { user: user ? publicUser(user) : null } };
}

/* -------------------------------------------------------------------------- */
/* Preferiti (server-side, legati all'account)                                 */
/* -------------------------------------------------------------------------- */

function getFavorites(user) {
  return { status: 200, body: { ids: (user.favorites || []).slice() } };
}

/** PUT /api/user/favorites — sostituisce/unisce l'elenco (unione). */
function putFavorites(user, body, { merge = true } = {}) {
  const incoming = Array.isArray(body.ids)
    ? body.ids.filter((id) => typeof id === 'string' && id.length <= 32).map((id) => id.trim()).filter(Boolean)
    : [];

  let next;
  if (merge) {
    next = [...new Set([...(user.favorites || []), ...incoming])];
  } else {
    next = incoming;
  }
  next = next.slice(0, MAX_FAVORITES);

  user.favorites = next;
  store.saveUsers(store.getUsers());
  return { status: 200, body: { ids: next.slice() } };
}

/* -------------------------------------------------------------------------- */
/* Esporta                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = {
  register,
  login,
  logout,
  me,
  getFavorites,
  putFavorites,
  currentUser,
  publicUser,
  setSessionCookie,
  clearSessionCookie,
  COOKIE_NAME,
  readCookie,
  MAX_FAVORITES,
};