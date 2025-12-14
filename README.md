# Macro Relationship Engine - MVP

En Next.js 14 applikation för real-time makroekonomisk analys och regime-detektion med data från FRED (Federal Reserve Economic Data).

## 🎯 Funktioner

- **Server-side datahämtning** från FRED API
- **Regime-detektion** (Risk On / Risk Off / Tightening / Neutral)
- **Yield Curve analys** (10Y-2Y slope)
- **20-dagars förändringsberäkning** för alla serier
- **In-memory cache** med 15 minuters TTL
- **Snapshot-historik** med Firebase Firestore
- **Responsivt dark-mode UI**

## 📊 Serier som analyseras

| Serie ID | Namn | Enhet |
|----------|------|-------|
| DGS10 | US 10Y Treasury | % |
| DGS2 | US 2Y Treasury | % |
| CPIAUCSL | US CPI (SA) | index |
| BAMLH0A0HYM2 | US High Yield Spread | % |
| VIXCLS | VIX | index |

## 🚀 Kom igång

### 1. Installera beroenden

```bash
npm install
```

### 2. Konfigurera miljövariabler

Skapa en fil `.env.local` i projektets rotmapp:

```bash
# FRED API (obligatorisk)
FRED_API_KEY=din_fred_api_nyckel_här

# Firebase (valfritt - för historik)
FIREBASE_PROJECT_ID=ditt-projekt-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@ditt-projekt.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nDIN_PRIVATE_KEY_HÄR\n-----END PRIVATE KEY-----\n"
```

> **Hämta API-nyckel:** Registrera dig gratis på [FRED API](https://fred.stlouisfed.org/docs/api/api_key.html)

### 3. Starta utvecklingsserver

```bash
npm run dev
```

Öppna [http://localhost:3000](http://localhost:3000) i din webbläsare.

### 4. Kör analys

Klicka på "Kör analys"-knappen för att hämta data från FRED och se aktuellt marknadsregime.

---

## 🔧 Lokalt: Firebase env

För att aktivera historik-funktionen lokalt behöver du konfigurera Firebase:

### Steg 1: Skapa/uppdatera .env.local

Filen `.env.local` finns redan med mallar. Fyll i dina riktiga värden:

```bash
# Firebase (för historik-funktionen)
FIREBASE_PROJECT_ID=ditt-projekt-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@ditt-projekt.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Steg 2: Formatera FIREBASE_PRIVATE_KEY korrekt

Private key från Firebase JSON-filen måste formateras:

1. Öppna din nedladdade `serviceAccountKey.json`
2. Kopiera värdet i `"private_key"`
3. **Viktigt:** Nyckeln ska:
   - Vara omgiven av citattecken (`"..."`)
   - Ha `\n` för alla radbrytningar (INTE riktiga radbrytningar)
   - Börja med `-----BEGIN PRIVATE KEY-----`
   - Sluta med `-----END PRIVATE KEY-----\n`

Exempel på korrekt format:
```bash
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANB...\n...\n-----END PRIVATE KEY-----\n"
```

### Steg 3: Starta om dev-servern

**VIKTIGT:** Efter att du ändrat `.env.local` måste du starta om servern:

```bash
# Stoppa nuvarande server (Ctrl+C)
# Starta igen:
npm run dev
```

Next.js läser endast miljövariabler vid uppstart!

### Felsökning

Om du ser "Firebase inte konfigurerat":
- Kontrollera att alla tre variabler är satta
- Kontrollera att FIREBASE_PRIVATE_KEY har rätt format
- Starta om dev-servern

Om analysen fungerar men historik inte sparas:
- Kontrollera Firestore-regler i Firebase Console
- Kontrollera att databasen är skapad

---

## 🔥 Firebase – Snapshot-historik

Firebase Firestore används **ENDAST** för att spara snapshot-historik av analysresultat. Inga fulla tidsserier eller stora JSON-payloads lagras.

### Vad som sparas

Varje snapshot innehåller:
- Tidsstämpel (serverTimestamp)
- Profil och datum
- Regime (risk, conditions, explanation)
- Features (slope10y2y)
- Senaste värden (dgs10, dgs2, cpi, hy, vix)
- 20-dagars förändringar

### Konfigurera Firebase

#### 1. Skapa Firebase-projekt

1. Gå till [Firebase Console](https://console.firebase.google.com/)
2. Klicka "Add project" och följ guiden
3. Välj ett projektnamn (t.ex. "anchor-macro")

#### 2. Aktivera Firestore

1. I Firebase Console, gå till "Build" → "Firestore Database"
2. Klicka "Create database"
3. Välj "Production mode"
4. Välj en region (t.ex. `europe-west1`)

#### 3. Skapa Service Account

1. Gå till Project Settings (kugghjulet) → "Service accounts"
2. Klicka "Generate new private key"
3. Ladda ner JSON-filen

#### 4. Extrahera miljövariabler

Från den nedladdade JSON-filen, kopiera:

```bash
FIREBASE_PROJECT_ID=<project_id från JSON>
FIREBASE_CLIENT_EMAIL=<client_email från JSON>
FIREBASE_PRIVATE_KEY=<private_key från JSON>
```

**OBS:** Private key innehåller `\n` som måste bevaras. Omge hela värdet med citattecken i `.env.local`.

### Firestore-struktur

```
Collection: macro_snapshots
└── Document (auto-generated ID)
    ├── createdAt: Timestamp
    ├── profile: "MVP"
    ├── asOf: "2024-12-14"
    ├── regime
    │   ├── risk: "risk_on"
    │   ├── conditions: "VIX faller, Normal yieldkurva"
    │   └── explanation: "Risk-on läge..."
    ├── features
    │   └── slope10y2y: 0.62
    ├── latest
    │   ├── dgs10: 4.14
    │   ├── dgs2: 3.52
    │   ├── cpi: 324.37
    │   ├── hy: 2.88
    │   └── vix: 14.85
    └── chg20d
        ├── dgs10: 0.06
        ├── dgs2: -0.04
        ├── cpi: 14.57
        ├── hy: -0.19
        └── vix: -5.15
```

### Robusthet

- Om Firebase inte är konfigurerat fungerar `/api/macro/analyze` ändå
- Snapshot-sparning sker asynkront och blockerar inte användaren
- `/api/macro/history` returnerar tydligt fel (500) om Firebase saknas

---

## 🔒 Säkerhet

- **FRED_API_KEY** läses endast server-side från `process.env`
- **Firebase Admin SDK** körs endast server-side
- Ingen API-nyckel eller Firebase-credentials exponeras till klienten
- Alla API-anrop sker via server-side routes
- `.env.local` är exkluderad från Git via `.gitignore`

---

## 📤 Push till GitHub (manuellt)

### Om du skapar ett nytt repo:

```bash
git init
git add .
git commit -m "Initial MVP macro engine"
git branch -M main
git remote add origin https://github.com/ABNAPP/ANCHOR.git
git push -u origin main
```

### Om remote redan finns:

```bash
git remote set-url origin https://github.com/ABNAPP/ANCHOR.git
git push -u origin main
```

### Uppdatera befintligt repo:

```bash
git add .
git commit -m "Update macro engine"
git push
```

---

## ☁️ Deploy på Vercel

### 1. Importera projektet

1. Gå till [vercel.com](https://vercel.com)
2. Klicka "Add New" → "Project"
3. Importera repot `ABNAPP/ANCHOR` från GitHub

### 2. Konfigurera miljövariabler

I Vercel Dashboard:

1. Gå till **Project Settings** → **Environment Variables**
2. Lägg till följande variabler:

| Name | Value | Environment |
|------|-------|-------------|
| `FRED_API_KEY` | din_fred_api_nyckel | All |
| `FIREBASE_PROJECT_ID` | ditt-projekt-id | All |
| `FIREBASE_CLIENT_EMAIL` | firebase-adminsdk@... | All |
| `FIREBASE_PRIVATE_KEY` | -----BEGIN PRIVATE KEY-----... | All |

3. Klicka "Save"

**Tips för FIREBASE_PRIVATE_KEY:**
- Klistra in hela nyckeln inklusive `-----BEGIN PRIVATE KEY-----` och `-----END PRIVATE KEY-----`
- Vercel hanterar `\n` automatiskt

### 3. Deploy

Vercel kommer automatiskt bygga och deploya vid varje push till `main`.

**Viktig säkerhetsinformation:**
- Alla nycklar sätts ENDAST i Vercel's Environment Variables
- Nycklar ska ALDRIG ligga i kod eller Git-historik
- Alla API-routes körs helt server-side

---

## 🛠️ Felsökning (Troubleshooting)

### "FRED_API_KEY saknas"

**Orsak:** Miljövariabeln är inte konfigurerad.

**Lösning:**
- **Lokalt:** Skapa `.env.local` med `FRED_API_KEY=...`
- **Vercel:** Lägg till i Project Settings → Environment Variables
- **Viktigt:** Starta om dev-servern efter att ha ändrat `.env.local`

### "Firebase inte konfigurerat"

**Orsak:** Firebase-miljövariabler saknas.

**Lösning:**
- Analysen fungerar ändå, men historik sparas inte
- Konfigurera `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` och `FIREBASE_PRIVATE_KEY`
- Se till att private key innehåller korrekta `\n`-sekvenser

### "Rate limit exceeded" / 429-fel

**Orsak:** FRED API har rate limits (ca 120 requests/minut).

**Lösning:**
- Appen har inbyggd 15-minuters cache
- Vänta en stund och försök igen
- Om det händer ofta, kontakta FRED för högre limits

### Tom data / inga observationer

**Orsak:** Vissa FRED-serier uppdateras med fördröjning (t.ex. CPI månadsvis).

**Lösning:**
- Detta är normalt beteende
- Appen hanterar saknade värden med "N/A" eller `null`
- Helg-/helgdagar kan sakna data för dagliga serier

### Timeout vid hämtning

**Orsak:** Nätverksproblem eller FRED API är långsamt.

**Lösning:**
- Timeout är satt till 15 sekunder
- Försök igen efter en stund
- Kontrollera din internetanslutning

### "Invalid API key"

**Orsak:** API-nyckeln är felaktig eller har utgått.

**Lösning:**
- Verifiera nyckeln på [FRED API Dashboard](https://fred.stlouisfed.org/docs/api/api_key.html)
- Skapa en ny nyckel om den gamla inte fungerar
- Se till att kopiera hela nyckeln utan extra mellanslag

---

## 📁 Projektstruktur

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── macro/
│   │   │       ├── analyze/
│   │   │       │   └── route.ts        # Analys API
│   │   │       └── history/
│   │   │           ├── route.ts        # Historik-lista API
│   │   │           └── [id]/
│   │   │               └── route.ts    # Historik-detalj API
│   │   ├── globals.css                 # Global styling
│   │   ├── layout.tsx                  # Root layout
│   │   └── page.tsx                    # Huvud-UI
│   ├── config/
│   │   └── mvp.ts                      # Konfiguration
│   └── lib/
│       ├── firebase/
│       │   ├── admin.ts                # Firebase Admin init
│       │   └── types.ts                # Firestore-typer
│       ├── fred/
│       │   └── client.ts               # FRED API-klient
│       └── macro/
│           ├── align.ts                # Data-alignment
│           ├── features.ts             # Feature-beräkningar
│           └── regime.ts               # Regime-detektion
├── .gitignore
├── next.config.js
├── package.json
├── README.md
├── tsconfig.json
└── vercel.json
```

---

## 🔧 API-referens

### GET `/api/macro/analyze`

Hämtar makrodata, beräknar features och detekterar regime. Sparar snapshot till Firestore (om konfigurerat).

**Response (200 OK):**

```json
{
  "profile": "MVP",
  "asOf": "2024-12-13",
  "cached": false,
  "regime": {
    "risk": "neutral",
    "riskLabel": "NEUTRAL",
    "riskColor": "#6b7280",
    "conditions": ["Normal yieldkurva", "VIX faller (risk-on signal)"],
    "explanation": "Neutral: Blandade signaler från marknaden..."
  },
  "features": {
    "slope10y2y": 0.15,
    "latest": { "DGS10": 4.25, ... },
    "latestDates": { "DGS10": "2024-12-13", ... },
    "chg20d": { "DGS10": 0.12, ... }
  },
  "latestTable": [...]
}
```

### GET `/api/macro/history?limit=20`

Hämtar senaste snapshots från Firestore.

**Query Parameters:**
- `limit` (optional): Antal snapshots att hämta (default: 20, max: 100)

**Response (200 OK):**

```json
{
  "count": 10,
  "limit": 20,
  "snapshots": [
    {
      "id": "abc123",
      "createdAt": "2024-12-14T10:30:00.000Z",
      "asOf": "2024-12-13",
      "profile": "MVP",
      "regime": {
        "risk": "risk_on",
        "conditions": "VIX faller, Normal yieldkurva"
      },
      "features": {
        "slope10y2y": 0.62
      }
    }
  ]
}
```

### GET `/api/macro/history/[id]`

Hämtar en specifik snapshot med alla detaljer.

**Response (200 OK):**

```json
{
  "id": "abc123",
  "createdAt": "2024-12-14T10:30:00.000Z",
  "profile": "MVP",
  "asOf": "2024-12-13",
  "regime": {
    "risk": "risk_on",
    "conditions": "VIX faller, Normal yieldkurva",
    "explanation": "Risk-on läge..."
  },
  "features": { "slope10y2y": 0.62 },
  "latest": { "dgs10": 4.14, "dgs2": 3.52, ... },
  "chg20d": { "dgs10": 0.06, "dgs2": -0.04, ... }
}
```

**Error Response (500):**

```json
{
  "error": "Firebase inte konfigurerat",
  "message": "Konfigurera FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL och FIREBASE_PRIVATE_KEY..."
}
```

---

## 📝 Licens

MIT

---

## 🤝 Bidra

1. Forka repot
2. Skapa en feature branch (`git checkout -b feature/ny-funktion`)
3. Commita ändringar (`git commit -m 'Lägg till ny funktion'`)
4. Pusha till branch (`git push origin feature/ny-funktion`)
5. Öppna en Pull Request
