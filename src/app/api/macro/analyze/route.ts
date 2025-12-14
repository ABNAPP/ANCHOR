import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { MVP_CONFIG } from "@/config/mvp";
import { fetchMultipleFredSeries } from "@/lib/fred/client";
import { calculateFeatures } from "@/lib/macro/features";
import { detectRegime, getRiskLabel, getRiskColor } from "@/lib/macro/regime";
import { getFirestoreDb, MACRO_SNAPSHOTS_COLLECTION } from "@/lib/firebase/admin";
import { MacroSnapshot } from "@/lib/firebase/types";

// In-memory cache för analyze-responsen
interface CacheEntry {
  data: AnalyzeResponse;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minuter

export interface LatestTableRow {
  id: string;
  name: string;
  unit: string;
  latest: number | null;
  latestDate: string | null;
  chg20d: number | null;
}

export interface AnalyzeResponse {
  profile: string;
  asOf: string;
  regime: {
    risk: string;
    riskLabel: string;
    riskColor: string;
    conditions: string[];
    explanation: string;
  };
  features: {
    slope10y2y: number | null;
    latest: Record<string, number | null>;
    latestDates: Record<string, string | null>;
    chg20d: Record<string, number | null>;
  };
  latestTable: LatestTableRow[];
}

function getStartDate(macroYears: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - macroYears);
  return date.toISOString().split("T")[0];
}

function getCacheKey(profile: string, startDate: string): string {
  return `${profile}:${startDate}`;
}

function getFromCache(key: string): AnalyzeResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setCache(key: string, data: AnalyzeResponse): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Sparar en snapshot till Firestore
 * Returnerar true om lyckat, false om misslyckat
 */
async function saveSnapshotToFirestore(response: AnalyzeResponse): Promise<boolean> {
  try {
    const db = getFirestoreDb();
    if (!db) {
      console.warn("Firestore inte konfigurerat - hoppar över snapshot-sparning");
      return false;
    }

    const snapshot: MacroSnapshot = {
      createdAt: FieldValue.serverTimestamp(),
      profile: response.profile,
      asOf: response.asOf,
      regime: {
        risk: response.regime.risk,
        conditions: response.regime.conditions.join(", "),
        explanation: response.regime.explanation,
      },
      features: {
        slope10y2y: response.features.slope10y2y,
      },
      latest: {
        dgs10: response.features.latest["DGS10"] ?? null,
        dgs2: response.features.latest["DGS2"] ?? null,
        cpi: response.features.latest["CPIAUCSL"] ?? null,
        hy: response.features.latest["BAMLH0A0HYM2"] ?? null,
        vix: response.features.latest["VIXCLS"] ?? null,
      },
      chg20d: {
        dgs10: response.features.chg20d["DGS10"] ?? null,
        dgs2: response.features.chg20d["DGS2"] ?? null,
        cpi: response.features.chg20d["CPIAUCSL"] ?? null,
        hy: response.features.chg20d["BAMLH0A0HYM2"] ?? null,
        vix: response.features.chg20d["VIXCLS"] ?? null,
      },
    };

    await db.collection(MACRO_SNAPSHOTS_COLLECTION).add(snapshot);
    console.log("Snapshot sparad till Firestore");
    return true;
  } catch (error) {
    console.error("Kunde inte spara snapshot till Firestore:", error);
    return false;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    // Kontrollera API-nyckel
    const apiKey = process.env.FRED_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "FRED_API_KEY saknas",
          message:
            "Konfigurera FRED_API_KEY i miljövariabler. För lokal utveckling: skapa .env.local med FRED_API_KEY=din_nyckel. För Vercel: lägg till i Project Settings → Environment Variables.",
        },
        { status: 500 }
      );
    }

    // Beräkna datum
    const startDate = getStartDate(MVP_CONFIG.windows.macroYears);
    const cacheKey = getCacheKey(MVP_CONFIG.profile, startDate);

    // Försök hämta från cache
    const cachedData = getFromCache(cacheKey);
    if (cachedData) {
      return NextResponse.json({
        ...cachedData,
        cached: true,
      });
    }

    // Hämta alla serier från FRED
    const seriesIds = MVP_CONFIG.fred.series.map((s) => s.id);
    
    let seriesMap;
    try {
      seriesMap = await fetchMultipleFredSeries(seriesIds, apiKey, startDate);
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : "Okänt fel vid FRED-anrop";
      
      return NextResponse.json(
        {
          error: "Kunde inte hämta data från FRED",
          message: errorMessage,
          hint: "Kontrollera att din FRED_API_KEY är giltig och att du inte överskridit rate limits.",
        },
        { status: 502 }
      );
    }

    // Beräkna features
    const features = calculateFeatures(seriesMap);

    // Detektera regime
    const regimeResult = detectRegime(features);

    // Bygg latestTable
    const latestTable: LatestTableRow[] = MVP_CONFIG.fred.series.map((config) => ({
      id: config.id,
      name: config.name,
      unit: config.unit,
      latest: features.latest[config.id] ?? null,
      latestDate: features.latestDates[config.id] ?? null,
      chg20d: features.chg20d[config.id] ?? null,
    }));

    // Bygg respons
    const response: AnalyzeResponse = {
      profile: MVP_CONFIG.profile,
      asOf: features.asOf,
      regime: {
        risk: regimeResult.risk,
        riskLabel: getRiskLabel(regimeResult.risk),
        riskColor: getRiskColor(regimeResult.risk),
        conditions: regimeResult.conditions,
        explanation: regimeResult.explanation,
      },
      features: {
        slope10y2y: features.slope10y2y,
        latest: features.latest,
        latestDates: features.latestDates,
        chg20d: features.chg20d,
      },
      latestTable,
    };

    // Spara i cache
    setCache(cacheKey, response);

    // Spara snapshot till Firestore (icke-blockerande)
    // Om det misslyckas loggas felet men användaren får ändå sitt svar
    saveSnapshotToFirestore(response).catch((err) => {
      console.error("Firestore save failed:", err);
    });

    return NextResponse.json({
      ...response,
      cached: false,
    });
  } catch (error) {
    console.error("Analyze error:", error);
    
    const errorMessage =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    return NextResponse.json(
      {
        error: "Analysfel",
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
