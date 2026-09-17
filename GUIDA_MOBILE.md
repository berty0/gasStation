# 📱 Mettere BenzinaBergamo sul telefono (guida deploy + installazione)

**BenzinaBergamo è già una PWA** (manifest + service worker): questo significa che, una
volta pubblicata su un indirizzo **HTTPS**, il telefono può installarla come un'app
nativa (icona, schermo intero, offline). Senza HTTPS l'installazione non funziona.

Questa guida ti porta da "gira su localhost" a "app sul mio telefono" in ~15 minuti.

---

## 0. Requisiti

- Indirizzo pubblico con **HTTPS** (tutti i servizi sotto lo danno gratis).
- Il server Node (`server.js`) legge già la variabile `PORT` dell'host (`PORT_BASE =
  process.env.PORT || 8080`), quindi **non serve modificare nulla** sul codice.

---

## 1. Pubblicare l'app (scegli una strada)

### 🚆 Opzione consigliata — Railway (gratis, semplice, HTTPS automatico)

Railway deploya direttamente dal progetto Node senza Dockerfile obbligatorio
(il Dockerfile incluso funziona comunque benissimo).

1. Vai su <https://railway.app> e crea un conto (GitHub o email).
2. **New Project → Deploy from GitHub repo** (consigliato: poi ogni push aggiorna l'app)
   oppure dalla riga di comando col CLI:
   ```bash
   npm i -g @railway/cli
   railway login
   railway init   # nella cartella del progetto
   railway up
   ```
3. Railway riconosce Node, esegue `npm start` (`node server.js`) e ti dà un URL
   `https://xxx.up.railway.app` — già HTTPS.
4. Apri l'URL sul telefono e segui il punto 2.

> ⚠️ **Fondamentale:** appena l'app è online, **registrati subito tu**. Il **primo
> utente registrato diventa amministratore** (vedi report: chi ti scrive "Solo
> l'amministratore..." è chi ha il report). Fatto, va bene se si registrano altri:
> restano utenti normali.

### 🐦 Alternative

| Servizio | Pro | Contro |
|---|---|---|
| **Render** <https://render.com> | Free tier, deploy da GitHub | Nel tier gratuito l'app **dorme** ~15 min di inattività → prima apertura lenta |
| **Fly.io** <https://fly.io> | Non dorme mai, veloce | Richiede carta di credito per il conto |
| **Cloudflare Tunnel** (`cloudflared`) | Zero conto per un test; `cloudflared tunnel --url http://localhost:8080` dà un URL `https://*.trycloudflare.com` | URL **cambia a ogni riavvio**; il PC deve restare acceso |

> I piani gratuiti dei provider cambiano spesso: verifica sempre i prezzi correnti.

---

## 2. Installare l'app sul telefono

Assicurati di aver aperto l'URL HTTPS in **portrait** (l'app è pensata per questo).

### 🤖 Android (Chrome)
1. Apri l'URL della tua app nel browser **Chrome**.
2. Tocca il menu **⋮** (in alto a destra).
3. **"Aggiungi a schermata Home"** oppure **"Installa app"** (compare quando il PWA
   è valido — di solito compare anche un banner automatico).
4. Conferma → l'icona **BenzinaBG** appare sul launcher.

### 🍎 iPhone / iPad (Safari)
1. Apri l'URL in **Safari** (non Chrome su iOS: solo Safari installa PWA).
2. Tocca il pulsante **Condividi** (rettangolo con freccia verso l'alto).
3. Scorri e tocca **"Aggiungi a Home"**.
4. Conferma → l'icona **BenzinaBG** appare sulla home.

### Dopo l'installazione
- L'app si apre **senza barra indirizzi**, a schermo intero.
- **Offline**: la prima volta percorsa le pagine e i file statici restano in cache
  (`sw.js`); i prezzi usano network-first, quindi sono sempre freschi quando c'è rete.
- Preferiti, login e report funzionano identici al desktop (cookie di sessione).

---

## 3. Avvertenze e manutenzione

- **Aggiornamenti del codice**: `sw.js` usa cache-first con versione (`VERSION =
  'v2'`). Quando modifichi file statici, **incrementa `VERSION`** in `sw.js`
  (es. `'v3'`) così i telefoni scaricano la versione nuova alla riconnessione.
- **Host che dorme** (es. Render free): la prima apertura del giorno impiega
  ~30 s a svegliare il server. Railway non dorme.
- **Dati**: il `data/` non viene caricato in cloud — il server scarica da MIMIT da
  solo alla prima richiesta (poi cache 6 ore + disco).
- **Backup account**: sessioni/utenti/visite stanno in `data/` **sul server cloud**,
  non sul telefono. Se ricrei l'app, gli account ripartono da zero.

---

## 4. File già preparati in questo progetto

| File | Cosa fa |
|---|---|
| `Dockerfile` | Container Node slim per Railway/Render/Fly (opzionale su Railway) |
| `.dockerignore` | Esclude `data/`, `node_modules/`, artefatti di test dal container |
| `manifest.json` | Aggiunto `id` per installazione affidabile su Chrome |
| `.gitignore` | Aggiornato con gli artefatti di test |

---

## 5. Ricapitolando in 5 passi

1. Crea un conto Railway (o alternative al punto 1).
2. Deploy del progetto (GitHub repo o `railway up`).
3. **Registrati subito** sul nuovo URL → diventi admin.
4. Apri l'URL sul telefono → Aggiungi a schermata Home / Installa app.
5. Goditi l'app installata, con offline e icona dedicata. 🎉