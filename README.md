# Macro Relationship Engine - MVP

En Next.js 14 applikation för real-time makroekonomisk analys och regime-detektion med data från FRED (Federal Reserve Economic Data).

## 🎯 Funktioner

- **Server-side datahämtning** från FRED API
- **Regime-detektion** (Risk On / Risk Off / Tightening / Neutral)
- **Yield Curve analys** (10Y-2Y slope)
- **20-dagars förändringsberäkning** för alla serier
- **In-memory cache** med 15 minuters TTL
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
FRED_API_KEY=din_fred_api_nyckel_här
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

## 🔒 Säkerhet

- **FRED_API_KEY** läses endast server-side från `process.env`
- Ingen API-nyckel exponeras till klienten
- Alla API-anrop sker via `/api/macro/analyze` route
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
2. Lägg till:
   - **Name:** `FRED_API_KEY`
   - **Value:** `din_fred_api_nyckel`
   - **Environment:** Production, Preview, Development (alla)
3. Klicka "Save"

### 3. Deploy

Vercel kommer automatiskt bygga och deploya vid varje push till `main`.

**Viktig säkerhetsinformation:**
- API-nyckeln sätts ENDAST i Vercel's Environment Variables
- Nyckeln ska ALDRIG ligga i kod eller Git-historik
- `/api/macro/analyze` körs helt server-side

---

## 🛠️ Felsökning (Troubleshooting)

### "FRED_API_KEY saknas"

**Orsak:** Miljövariabeln är inte konfigurerad.

**Lösning:**
- **Lokalt:** Skapa `.env.local` med `FRED_API_KEY=...`
- **Vercel:** Lägg till i Project Settings → Environment Variables
- **Viktigt:** Starta om dev-servern efter att ha ändrat `.env.local`

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
│   │   │       └── analyze/
│   │   │           └── route.ts    # API endpoint
│   │   ├── globals.css             # Global styling
│   │   ├── layout.tsx              # Root layout
│   │   └── page.tsx                # Huvud-UI
│   ├── config/
│   │   └── mvp.ts                  # Konfiguration
│   └── lib/
│       ├── fred/
│       │   └── client.ts           # FRED API-klient
│       └── macro/
│           ├── align.ts            # Data-alignment
│           ├── features.ts         # Feature-beräkningar
│           └── regime.ts           # Regime-detektion
├── .env.local.example              # Exempel på miljövariabler
├── .gitignore
├── next.config.js
├── package.json
├── README.md
└── tsconfig.json
```

---

## 🔧 API-referens

### GET `/api/macro/analyze`

Hämtar makrodata, beräknar features och detekterar regime.

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
    "latest": {
      "DGS10": 4.25,
      "DGS2": 4.10,
      "CPIAUCSL": 315.5,
      "BAMLH0A0HYM2": 3.2,
      "VIXCLS": 14.5
    },
    "chg20d": {
      "DGS10": 0.12,
      "DGS2": 0.08,
      "CPIAUCSL": 0.5,
      "BAMLH0A0HYM2": -0.1,
      "VIXCLS": -1.2
    }
  },
  "latestTable": [
    {
      "id": "DGS10",
      "name": "US 10Y Treasury",
      "unit": "%",
      "latest": 4.25,
      "chg20d": 0.12
    }
    // ... fler serier
  ]
}
```

**Error Response (500/502):**

```json
{
  "error": "Feltyp",
  "message": "Detaljerat felmeddelande",
  "hint": "Tips för att lösa problemet"
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

