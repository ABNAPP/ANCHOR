# PROMPT: Macro Relationship Engine - MVP

## Översikt

Detta är en **Next.js 14**-applikation för real-time makroekonomisk analys och automatisk regime-detektion. Systemet hämtar data från FRED (Federal Reserve Economic Data) API, analyserar marknadsförhållanden och identifierar aktuellt marknadsregime (Risk On / Risk Off / Tightening / Neutral).

## Teknisk Stack

- **Framework**: Next.js 14 (App Router)
- **Språk**: TypeScript
- **Frontend**: React 18 med client-side rendering
- **Backend**: Next.js API Routes (server-side)
- **Databas**: Firebase Firestore (för snapshot-historik)
- **Externa APIs**: FRED API (Federal Reserve Economic Data)
- **Deployment**: Vercel (konfigurerat via `vercel.json`)

## Kärnfunktionalitet

### 1. Datahämtning från FRED API

Systemet hämtar fem makroekonomiska tidsserier:
- **DGS10**: US 10-Year Treasury Constant Maturity Rate (%)
- **DGS2**: US 2-Year Treasury Constant Maturity Rate (%)
- **CPIAUCSL**: US Consumer Price Index for All Urban Consumers: All Items (index)
- **BAMLH0A0HYM2**: ICE BofA US High Yield Option-Adjusted Spread (%)
- **VIXCLS**: CBOE Volatility Index (VIX)

**Implementation**: `src/lib/fred/client.ts`
- Parallell hämtning av alla serier
- Timeout-hantering (15 sekunder)
- Felhantering och validering
- Parsning av FRED-specifika värden (hanterar "." och null)

### 2. Feature-beräkningar

**Implementation**: `src/lib/macro/features.ts`

Beräknar följande features:
- **Yield Curve Slope (10Y-2Y)**: Skillnaden mellan 10-årig och 2-årig statsobligationsränta
- **20-dagars förändringar**: Procentuell förändring för varje serie över senaste 20 dagarna
- **Senaste värden**: Senaste tillgängliga observation för varje serie
- **Datum-alignment**: Hanterar olika uppdateringsfrekvenser mellan serier

### 3. Regime-detektion

**Implementation**: `src/lib/macro/regime.ts`

Automatisk klassificering av marknadsregime baserat på regler:

1. **RISK OFF** (Röd):
   - VIX stiger (chg20d > 0) OCH yieldkurvan är inverterad (slope < 0)
   - Eller bara VIX stiger om slope-data saknas

2. **TIGHTENING** (Orange):
   - Stigande räntor (DGS10 chg20d > 0) OCH vidgande kreditspreader (HY chg20d > 0)

3. **RISK ON** (Grön):
   - VIX faller (chg20d < 0) OCH normal yieldkurva (slope > 0)

4. **NEUTRAL** (Grå):
   - Blandade eller otillräckliga signaler

Varje regime inkluderar:
- Risknivå (risk_off, tightening, neutral, risk_on)
- Aktiva conditions (array av beskrivningar)
- Förklarande text

### 4. Caching

**Implementation**: `src/app/api/macro/analyze/route.ts`

- **In-memory cache** med 15 minuters TTL
- Cache-nyckel baserad på profil och startdatum
- Automatisk cache-invalidering efter TTL
- Cache-indikator i API-respons (`cached: true/false`)

### 5. Snapshot-historik (Firebase Firestore)

**Implementation**: `src/app/api/macro/analyze/route.ts`, `src/lib/firebase/admin.ts`

- Varje analys-körning sparar ett snapshot till Firestore
- Automatisk retention: behåller senaste 200 snapshots (konfigurerbart)
- Batch-radering av gamla snapshots (max 50 per körning)
- Snapshot-struktur:
  - Tidsstämpel (serverTimestamp)
  - Profil och datum
  - Regime (risk, conditions, explanation)
  - Features (slope10y2y)
  - Senaste värden (dgs10, dgs2, cpi, hy, vix)
  - 20-dagars förändringar

**API-endpoints**:
- `GET /api/macro/history?limit=20` - Lista snapshots
- `GET /api/macro/history/[id]` - Detaljerad snapshot

### 6. Frontend UI

**Implementation**: `src/app/page.tsx`

- **Dark mode** med CSS-variabler
- **Responsiv design** med modern UI
- **Real-time analys**: Klicka "Kör analys" för att hämta data
- **Regime-visualisering**: Färgkodad box med risknivå
- **Data-tabell**: Senaste värden och 20-dagars förändringar
- **Historik-sektion**: Lista över tidigare snapshots med detaljvy
- **Felhantering**: Tydliga felmeddelanden med hints

## Projektstruktur

```
src/
├── app/
│   ├── api/
│   │   └── macro/
│   │       ├── analyze/
│   │       │   └── route.ts        # Huvudanalys-API med cache och Firestore
│   │       └── history/
│   │           ├── route.ts        # Lista snapshots
│   │           └── [id]/
│   │               └── route.ts    # Detaljerad snapshot
│   ├── globals.css                 # Global styling med dark mode
│   ├── layout.tsx                  # Root layout
│   └── page.tsx                    # Huvud-UI (client component)
├── config/
│   └── mvp.ts                      # Konfiguration (serier, windows, firestore)
└── lib/
    ├── firebase/
    │   ├── admin.ts                # Firebase Admin SDK init
    │   └── types.ts                # Firestore TypeScript-typer
    ├── fred/
    │   └── client.ts               # FRED API-klient
    └── macro/
        ├── align.ts                # Data-alignment (hanterar olika datum)
        ├── features.ts             # Feature-beräkningar
        └── regime.ts               # Regime-detektion
```

## Konfiguration

### Miljövariabler

**Obligatoriska**:
- `FRED_API_KEY`: API-nyckel från FRED (gratis registrering)

**Valfria** (för historik-funktion):
- `FIREBASE_PROJECT_ID`: Firebase-projekt-ID
- `FIREBASE_CLIENT_EMAIL`: Service account email
- `FIREBASE_PRIVATE_KEY`: Service account private key (med `\n` för radbrytningar)

### Konfigurationsfil

`src/config/mvp.ts` innehåller:
- Profilnamn ("MVP")
- Tidsfönster (macroYears: 5)
- FRED-serier (ID, namn, enhet)
- Firestore-retention (retentionLimit: 200, maxDeletesPerRun: 50)

## API-referens

### GET `/api/macro/analyze`

Hämtar makrodata, beräknar features och detekterar regime.

**Response**:
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
    "explanation": "Neutral: Blandade signaler..."
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

**Query Parameters**:
- `limit` (optional): Antal snapshots (default: 20, max: 100)

### GET `/api/macro/history/[id]`

Hämtar detaljerad snapshot.

## Säkerhet

- Alla API-nycklar läses endast server-side från `process.env`
- Firebase Admin SDK körs endast server-side
- Ingen API-nyckel exponeras till klienten
- Alla API-anrop sker via server-side routes
- `.env.local` är exkluderad från Git

## Prestanda

- **Parallell datahämtning**: Alla FRED-serier hämtas samtidigt
- **In-memory cache**: 15 minuters TTL minskar API-anrop
- **Asynkron Firestore**: Snapshot-sparning blockerar inte användaren
- **Batch-radering**: Effektiv cleanup av gamla snapshots
- **Timeout-hantering**: 15 sekunders timeout för FRED-anrop

## Felhantering

- **FRED API-fel**: Tydliga felmeddelanden med hints
- **Firebase-fel**: Graceful degradation (appen fungerar utan Firebase)
- **Timeout**: Automatisk timeout vid långsamma API-anrop
- **Saknade värden**: Hanteras med `null` och visas som "—" i UI

## Deployment

### Vercel

1. Importera projekt från GitHub
2. Konfigurera miljövariabler i Project Settings
3. Automatisk deploy vid push till `main`

### Lokal utveckling

```bash
npm install
# Skapa .env.local med FRED_API_KEY
npm run dev
```

## Utvecklingsanteckningar

- **TypeScript**: Strikt typning genomgående
- **Error boundaries**: Tydlig felhantering på alla nivåer
- **Logging**: Console-loggar för debugging (Firestore, cache, etc.)
- **Modulär design**: Separata moduler för FRED, features, regime, Firebase
- **Konfigurerbar**: Lätt att ändra serier, windows, retention via `mvp.ts`

## Framtida utökningar

- Ytterligare makroekonomiska serier
- Mer avancerad regime-detektion (ML-baserad)
- Grafisk visualisering av tidsserier
- Export-funktionalitet (CSV, JSON)
- Email/notifikationer vid regime-skiften
- Multi-profil support (olika analysprofiler)
