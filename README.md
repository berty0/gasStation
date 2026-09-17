# BenzinaBergamo

Dashboard interattiva per i prezzi dei carburanti nella **provincia di Bergamo**.

Mappa live con tutti i distributori della provincia, classifica per prezzo e distanza, geolocalizzazione e prezzi sempre aggiornati dai dati ufficiali del Ministero (MIMIT).

---

## Funzionalità

| Funzione | Descrizione |
|----------|-------------|
| **Mappa interattiva** | Visualizza tutti i ~355 distributori BG su mappa Leaflet con marker colorati (verde = conveniente, rosso = caro) e clustering automatico |
| **Geolocalizzazione** | Rileva la tua posizione e ordina i distributori per distanza + prezzo |
| **Classifica intelligente** | Punteggio pesato: 70% prezzo + 30% distanza. Il primo in classifica è il miglior compromesso |
| **Filtri completi** | Carburante (Benzina, Gasolio, GPL, Metano, HVO...), raggio, marche, self/servito, ricerca testo |
| **Preferiti** | Salva i tuoi distributori preferiti con un tocco, accesso rapido dal filtro |
| **Esporta CSV** | Scarica la classifica filtrata come file CSV per Excel o altri strumenti |
| **Prezzi aggiornati** | Dati MIMIT aggiornati ogni giorno alle 08:00, cache automatica 6 ore |
| **Funziona standalone** | Nessun server necessario — apri index.html e i dati vengono caricati direttamente dal MIMIT via proxy CORS |

---

## 🚀 Come usare

### Opzione 1 — Standalone (consigliata)

Nessuna installazione richiesta. Basta aprire `index.html` nel browser:

```
doppio-click su index.html
```

I dati MIMIT vengono caricati automaticamente via proxy CORS.

### Opzione 2 — Con server Node.js (più veloce)

Il server Node scarica i dati direttamente dal MIMIT e li serve come JSON, eliminando il bisogno del proxy CORS.

```bash
# Nessuna dipendenza da installare
node server.js
```

Poi apri `http://localhost:8080` nel browser.

Il server:
- Scarica i CSV dal MIMIT e li filtra per la sola provincia di Bergamo
- Li serve come JSON con header CORS
- Si aggiorna automaticamente ogni 6 ore
- Cerca una porta libera da 8080 in avanti

---

## 📁 Struttura progetto

```
BenzinaBergamo/
├── index.html              ← pagina principale
├── server.js               ← backend Node.js (zero dipendenze)
├── css/
│   └── style.css           ← stili dashboard (Apple-style minimal)
├── js/
│   ├── config.js           ← configurazione, API, stringhe, colori
│   ├── geo.js              ← distanza Haversine, geolocalizzazione, utilità
│   ├── data.js             ← fetch dati, cache, parsing CSV, indici prezzi
│   ├── favorites.js        ← gestione preferiti (localStorage)
│   ├── ranking.js          ← classifica pesata prezzo + distanza
│   ├── map.js              ← mappa Leaflet, marker, cluster, popup
│   ├── ui.js               ← sidebar, filtri, classifica, export CSV
│   └── app.js              ← entry point, orchestrazione, state
└── README.md
```

---

## Carburanti supportati

La dashboard supporta **tutti i carburanti** disponibili nei dati MIMIT, inclusi:

| Carburante | Tipo |
|------------|------|
| **Benzina** | Benzina, Benzina Plus, Benzina speciale |
| **Gasolio** | Gasolio, Gasolio Premium, Gasolio speciale |
| **GPL** | GPL |
| **Metano** | Metano |
| **GNL / L-GNC** | Gas naturale liquefatto, Gas naturale compresso |
| **HVO** | HVO, HVOlution, HVO100, HVO Future, Diesel HVO |
| **Premium** | Blue Super, Blue Diesel, Super Diesel, Supreme Diesel |
| **Speciali** | Hi-Q Diesel, HiQ Perform+, Diesel Shell V Power, Benzina WR 100 |

Seleziona il carburante desiderato dal menu a tendina nei filtri.

---

## 🗺️ Fonte dati

Dati ufficiali del **Ministero delle Imprese e del Made in Italy (MIMIT)** — [open data prezzi carburanti](https://www.mimit.gov.it/it/prezzo-carburanti).

- **Anagrafica impianti**: elenco completo degli impianti attivi in Italia
- **Prezzi**: prezzi di vendita aggiornati quotidianamente
- Filtrati automaticamente per la sola **provincia di Bergamo (BG)**

---

## 🛠️ Tecnologie

- **Frontend**: HTML5, CSS3, Vanilla JavaScript (zero framework)
- **Mappa**: [Leaflet.js](https://leafletjs.com/) + [MarkerCluster](https://github.com/Leaflet/Leaflet.markercluster)
- **Backend** (opzionale): Node.js nativo, zero dipendenze npm
- **Dati**: MIMIT Open Data (CSV pipe-separated)
- **Cache**: localStorage (browser) + JSON su disco (server)

---

## 📝 License

Progetto personale. I dati MIMIT sono open data pubblici.