# ANCHOR – Architecture v1.0

## Översikt

Projektet består av två logiskt separata motorer:

1. **Macro Relationship Engine** – Makroekonomisk analys och regime-detektion
2. **Company Engine (SEC EDGAR)** – Verifiering av företagsuttalanden mot faktiska KPI-data

Dessa motorer är separerade i kod och logik. De delar endast gemensam infrastruktur (Firebase, Next.js API routes).

---

## Macro Relationship Engine

### Syfte
Makroekonomisk analys och regime-detektion baserat på FRED (Federal Reserve Economic Data).

### Input
- FRED API-data (DGS10, DGS2, VIX, HY Spread, CPI)
- Time-series för yield curve, spreads, volatility

### Output
- **Regime**: Risk ON / Risk OFF / Tightening / Neutral
- **Features**: Yield curve slope, 20-day changes, latest values
- **Snapshots**: Historik sparas i Firestore

### Status
MVP färdig. Fungerar som en fristående analysmotor.

---

## Company Engine (SEC EDGAR)

### Syfte
Extrahera och verifiera företagsuttalanden (promises/claims) mot faktiska KPI-data från SEC XBRL-rapportering.

### Flöde

```
SEC EDGAR → Filings → Promises Extraction → KPI/XBRL → Verification → Company Score
```

#### 1. SEC EDGAR
- Hämta company filings (10-K, 10-Q) via SEC EDGAR API
- Extrahera relevanta sektioner (MD&A, Risk Factors)

#### 2. Promises Extraction
- Regelbaserad extraktion av framåtblickande uttalanden
- Klassificering efter typ (Revenue, CapEx, Debt, Margin, etc.)
- Confidence-scoring

#### 3. KPI/XBRL
- Hämta numeriska KPI:er från SEC Company Facts API (XBRL)
- Stödda metrics: Revenue, Net Income, EPS, Cash, Debt, CapEx, FCF
- Period-stöd: Årliga (FY) och kvartals (Q1-Q4) värden

#### 4. Verification
- **Bulk-verifiering**: Verifierar alla eller valda promises mot KPI-data
- **Mapping**: Promise-typ → KPI-taggar
- **Status**: Held / Failed / Mixed / Unclear
- Skip-logik: Redan verifierade promises hoppas över

#### 5. Company Score
- Beräknas ENDAST på verifierade promises (status != "Unclear")
- Formel: (Held × 1 + Mixed × 0 + Failed × -1) / antal verifierade × 100
- Om inga promises är verifierade → Company Score = N/A

---

## Varför Company Score kan vara N/A

Detta är **korrekt beteende**, inte ett fel.

### Scenarier när Score = N/A:

1. **Ingen verifiering körts än**
   - Promises är extraherade men inte verifierade
   - Company Score beräknas endast efter verifiering

2. **Alla promises blev "Unclear"**
   - Ingen matchning mot KPI-data
   - T.ex. saknad KPI-data, fel promise-typ, eller ingen matchning

3. **Mellanläge**
   - När promises är extraherade men verifiering inte körts
   - Detta är ett mellanläge i workflow: Extract → Verify → Score

### Åtgärd:
- Kör "Verifiera alla (KPI)" för att verifiera promises
- Om alla blir Unclear, kontrollera att KPI-data finns för bolaget

---

## Designprinciper

### 1. Separation of Concerns
- Macro och Company är logiskt separata motorer
- Ingen direkt koppling mellan dem
- Delar gemensam infrastruktur men inte logik

### 2. Regelbaserad MVP
- **Ingen AI i MVP**: Alla beslut är regelbaserade
- Keyword-matching, typtabeller, enkla trösklar
- Förutsägbarhet över komplexitet

### 3. Verifierings-Mapping
- Promise-typ → KPI-taggar (statisk tabell)
- Fallback: Keyword-matchning på promise-text
- Om ingen match → "Unclear" (säker fallback)

### 4. Bulk-verifiering
- Central verifieringslogik i `/lib/company/bulk-verification.ts`
- Använder mapping för att hitta relevanta KPI:er
- Fel i en promise stoppar inte resten

### 5. Scoring
- Beräknas endast på verifierade promises
- "Unclear" promises ignoreras i score-beräkningen
- Transparent och förutsägbar formel

### 6. Fallback-strategi
- "Unclear" används som säker fallback när:
  - KPI-data saknas
  - Promise-typ saknas/matchar inte
  - Verifiering misslyckas
- Bättre "Unclear" än felaktigt "Held" eller "Failed"

---

## Teknisk Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Firebase Firestore (för historik och promises)
- **APIs**: 
  - FRED API (Macro)
  - SEC EDGAR API (Company)
  - SEC Company Facts API (XBRL/KPI)
- **Language**: TypeScript
- **Deployment**: Vercel

---

## Nästa Steg (Ej MVP)

Framtida förbättringar kan inkludera:
- AI-baserad promise extraction
- Machine learning för scoring
- Integration mellan Macro och Company Engine
- Avancerad NLP för type-inferens

Men MVP fokuserar på regelbaserad, förutsägbar logik.

