import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { MVP_CONFIG } from "@/config/mvp";
import { fetchMultipleFredSeries } from "@/lib/fred/client";
import { calculateFeatures } from "@/lib/macro/features";
import { detectRegime, getRiskLabel, getRiskColor } from "@/lib/macro/regime";
import { getFirestoreDb, MACRO_SNAPSHOTS_COLLECTION, isFirebaseConfigured } from "@/lib/firebase/admin";
import { MacroSnapshot } from "@/lib/firebase/types";

// ============================================
// PRODUCTION HARDENING: CACHE
// ============================================

/**
 * In-memory cache för analyze-responsen
 * 
 * VIKTIGT (PRODUCTION):
 * - Cachen är per server-instance (serverless)
 * - Cold starts nollställer cache
 * - Ingen garanti för konsistens mellan instanser
 * - cached=true sätts ENDAST om data faktiskt kom från cache
 */
interface CacheEntry {
  data: AnalyzeResponse;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minuter

// ============================================
// PRODUCTION HARDENING: RATE LIMITING
// ============================================

/**
 * Enkel rate-limiting per IP (memory-baserad)
 * MVP: Endast skydd mot uppenbar spam
 */
interface RateLimitEntry {
  lastRequest: number;
  requestCount: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 5000; // 5 sekunder
const RATE_LIMIT_MAX_REQUESTS = 3; // Max 3 requests per 5 sek

function getClientId(request: NextRequest): string {
  // Försök hämta IP från headers (Vercel)
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwardedFor?.split(",")[0] || realIp || "unknown";
  return ip;
}

function checkRateLimit(clientId: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const entry = rateLimitMap.get(clientId);

  if (!entry) {
    rateLimitMap.set(clientId, { lastRequest: now, requestCount: 1 });
    return { allowed: true };
  }

  // Rensa gamla entries (enkel cleanup)
  if (now - entry.lastRequest > RATE_LIMIT_WINDOW_MS * 10) {
    rateLimitMap.delete(clientId);
    rateLimitMap.set(clientId, { lastRequest: now, requestCount: 1 });
    return { allowed: true };
  }

  // Kontrollera om inom samma window
  if (now - entry.lastRequest < RATE_LIMIT_WINDOW_MS) {
    entry.requestCount++;
    if (entry.requestCount > RATE_LIMIT_MAX_REQUESTS) {
      return { 
        allowed: false, 
        reason: `För många requests. Max ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS / 1000} sekunder.` 
      };
    }
  } else {
    // Nytt window
    entry.lastRequest = now;
    entry.requestCount = 1;
  }

  return { allowed: true };
}

// ============================================
// PRODUCTION HARDENING: REQUEST ID
// ============================================

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// TYPES
// ============================================

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
  // PRODUCTION HARDENING: Cache metadata
  cached?: boolean;
  cacheAgeSeconds?: number | null;
  cacheScope?: "memory-instance";
  // PRODUCTION HARDENING: Firebase status
  firebaseEnabled?: boolean;
  // PRODUCTION HARDENING: Request tracking
  requestId?: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getStartDate(macroYears: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - macroYears);
  return date.toISOString().split("T")[0];
}

function getCacheKey(profile: string, startDate: string): string {
  return `${profile}:${startDate}`;
}

function getFromCache(key: string): { data: AnalyzeResponse; ageSeconds: number } | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  const ageMs = now - entry.timestamp;
  
  if (ageMs > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return {
    data: entry.data,
    ageSeconds: Math.floor(ageMs / 1000),
  };
}

function setCache(key: string, data: AnalyzeResponse): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

// ============================================
// FIRESTORE HELPERS (GRACEFUL DEGRADATION)
// ============================================

/**
 * Hämtar senaste snapshot från Firestore
 * Returnerar null om ingen snapshot finns eller om Firestore inte är konfigurerat
 * PRODUCTION: Aldrig kastar fel, alltid graceful degradation
 */
async function getLatestSnapshot(): Promise<{ risk: string; createdAt: Timestamp } | null> {
  try {
    if (!isFirebaseConfigured()) {
      return null;
    }

    const db = getFirestoreDb();
    if (!db) {
      return null;
    }

    const snapshot = await db
      .collection(MACRO_SNAPSHOTS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      risk: data.regime?.risk || "neutral",
      createdAt: data.createdAt as Timestamp,
    };
  } catch (error) {
    // PRODUCTION: Graceful degradation - logga men krascha inte
    console.error("[Firestore] Kunde inte hämta senaste snapshot:", error);
    return null;
  }
}

/**
 * Kontrollerar om snapshot ska sparas enligt CONTRACT:
 * - Sparas endast om regim ändrats ELLER om ingen snapshot sparats senaste 24h
 */
async function shouldSaveSnapshot(currentRisk: string): Promise<boolean> {
  try {
    const latestSnapshot = await getLatestSnapshot();
    
    if (!latestSnapshot) {
      // Ingen snapshot finns → spara alltid
      return true;
    }

    // CONTRACT: Sparas om regim ändrats
    if (latestSnapshot.risk !== currentRisk) {
      console.log(`[Firestore] Regim ändrad: ${latestSnapshot.risk} → ${currentRisk}, sparar snapshot`);
      return true;
    }

    // CONTRACT: Sparas om ingen snapshot sparats senaste 24h
    const now = new Date();
    const createdAt = latestSnapshot.createdAt.toDate();
    const hoursSinceLastSnapshot = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceLastSnapshot >= 24) {
      console.log(`[Firestore] 24h passerat sedan senaste snapshot (${hoursSinceLastSnapshot.toFixed(1)}h), sparar snapshot`);
      return true;
    }

    console.log(`[Firestore] Regim oförändrad (${currentRisk}) och <24h sedan senaste snapshot, hoppar över sparning`);
    return false;
  } catch (error) {
    // PRODUCTION: Om kontroll misslyckas, spara för säkerhets skull
    console.error("[Firestore] Error checking shouldSaveSnapshot:", error);
    return true;
  }
}

/**
 * Sparar en snapshot till Firestore
 * CONTRACT: Sparas endast om regim ändrats ELLER om ingen snapshot sparats senaste 24h
 * PRODUCTION: Returnerar null vid fel (aldrig kastar)
 */
async function saveSnapshotToFirestore(response: AnalyzeResponse): Promise<string | null> {
  try {
    if (!isFirebaseConfigured()) {
      return null;
    }

    const db = getFirestoreDb();
    if (!db) {
      return null;
    }

    // CONTRACT: Kontrollera om snapshot ska sparas
    const shouldSave = await shouldSaveSnapshot(response.regime.risk);
    if (!shouldSave) {
      return null;
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

    const docRef = await db.collection(MACRO_SNAPSHOTS_COLLECTION).add(snapshot);
    console.log(`[Firestore] Snapshot saved: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    // PRODUCTION: Graceful degradation - logga men krascha inte
    console.error("[Firestore] Kunde inte spara snapshot:", error);
    return null;
  }
}

/**
 * Rensar gamla snapshots för att hålla databasen inom retention-limit.
 * PRODUCTION: Aldrig kastar fel
 */
async function cleanupOldSnapshots(): Promise<void> {
  try {
    if (!isFirebaseConfigured()) {
      return;
    }

    const db = getFirestoreDb();
    if (!db) {
      return;
    }

    const { retentionLimit, maxDeletesPerRun } = MVP_CONFIG.firestore;

    // Hämta totalt antal dokument
    const countSnapshot = await db
      .collection(MACRO_SNAPSHOTS_COLLECTION)
      .count()
      .get();
    
    const totalCount = countSnapshot.data().count;
    
    // Om vi är inom limit, ingen cleanup behövs
    if (totalCount <= retentionLimit) {
      return;
    }

    const toDelete = Math.min(totalCount - retentionLimit, maxDeletesPerRun);
    
    if (toDelete <= 0) {
      return;
    }

    console.log(`[Firestore] Retention cleanup: ${totalCount} snapshots, behåller ${retentionLimit}, raderar ${toDelete}`);

    // Hämta de äldsta dokumenten (sorterade efter createdAt ascending = äldst först)
    const oldDocsSnapshot = await db
      .collection(MACRO_SNAPSHOTS_COLLECTION)
      .orderBy("createdAt", "asc")
      .limit(toDelete)
      .get();

    if (oldDocsSnapshot.empty) {
      return;
    }

    // Använd batch för effektiv radering
    const batch = db.batch();
    let deleteCount = 0;

    for (const doc of oldDocsSnapshot.docs) {
      batch.delete(doc.ref);
      deleteCount++;
    }

    await batch.commit();
    console.log(`[Firestore] Retention cleanup: deleted ${deleteCount} old snapshots`);

  } catch (error) {
    // PRODUCTION: Cleanup-fel ska inte blockera användaren
    console.error("[Firestore] Retention cleanup failed:", error);
  }
}

/**
 * Sparar snapshot och kör retention cleanup (icke-blockerande)
 * PRODUCTION: Aldrig kastar fel
 */
async function saveAndCleanup(response: AnalyzeResponse): Promise<void> {
  try {
    const docId = await saveSnapshotToFirestore(response);
    
    if (docId) {
      // Kör cleanup endast om snapshot sparades
      await cleanupOldSnapshots();
    }
  } catch (error) {
    // PRODUCTION: Logga men krascha inte
    console.error("[Firestore] Save/cleanup failed:", error);
  }
}

// ============================================
// MAIN API HANDLER
// ============================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();
  console.log(`[analyze] Request ${requestId} started`);

  try {
    // PRODUCTION HARDENING: Rate limiting
    const clientId = getClientId(request);
    const rateLimitCheck = checkRateLimit(clientId);
    
    if (!rateLimitCheck.allowed) {
      // Försök returnera cached data om möjligt
      const startDate = getStartDate(MVP_CONFIG.windows.macroYears);
      const cacheKey = getCacheKey(MVP_CONFIG.profile, startDate);
      const cached = getFromCache(cacheKey);
      
      if (cached) {
        console.log(`[analyze] Rate limit hit for ${clientId}, returning cached data`);
        return NextResponse.json({
          ...cached.data,
          cached: true,
          cacheAgeSeconds: cached.ageSeconds,
          cacheScope: "memory-instance",
          firebaseEnabled: isFirebaseConfigured(),
          requestId,
        });
      }

      // Ingen cache → returnera 429
      return NextResponse.json(
        {
          error: true,
          code: "RATE_LIMIT_EXCEEDED",
          message: rateLimitCheck.reason || "För många requests",
          hint: "Vänta några sekunder och försök igen.",
          requestId,
        },
        { status: 429 }
      );
    }

    // PRODUCTION HARDENING: Input validation (säkra defaults)
    const searchParams = request.nextUrl.searchParams;
    const profile = searchParams.get("profile") || MVP_CONFIG.profile;
    const macroYears = parseInt(searchParams.get("years") || String(MVP_CONFIG.windows.macroYears), 10);
    const validatedYears = isNaN(macroYears) || macroYears < 1 || macroYears > 20 
      ? MVP_CONFIG.windows.macroYears 
      : macroYears;

    // Kontrollera API-nyckel
    const apiKey = process.env.FRED_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        {
          error: true,
          code: "MISSING_API_KEY",
          message: "FRED_API_KEY saknas",
          hint: "Konfigurera FRED_API_KEY i miljövariabler. För lokal utveckling: skapa .env.local med FRED_API_KEY=din_nyckel. För Vercel: lägg till i Project Settings → Environment Variables.",
          requestId,
        },
        { status: 500 }
      );
    }

    // Beräkna datum
    const startDate = getStartDate(validatedYears);
    const cacheKey = getCacheKey(profile, startDate);

    // PRODUCTION HARDENING: Cache lookup med metadata
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[analyze] Cache hit for ${requestId}, age: ${cached.ageSeconds}s`);
      
      // CONTRACT: Även vid cache-hit, kontrollera om snapshot ska sparas
      // (regim kan ha ändrats eller 24h kan ha passerat)
      saveAndCleanup(cached.data).catch((err) => {
        console.error(`[Firestore] Save/cleanup failed for ${requestId}:`, err);
      });

      return NextResponse.json({
        ...cached.data,
        cached: true,
        cacheAgeSeconds: cached.ageSeconds,
        cacheScope: "memory-instance",
        firebaseEnabled: isFirebaseConfigured(),
        requestId,
      });
    }

    // Cache miss → kör analys
    console.log(`[analyze] Cache miss for ${requestId}, fetching from FRED`);

    // Hämta alla serier från FRED
    const seriesIds = MVP_CONFIG.fred.series.map((s) => s.id);
    
    let seriesMap;
    try {
      seriesMap = await fetchMultipleFredSeries(seriesIds, apiKey, startDate);
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : "Okänt fel vid FRED-anrop";
      
      console.error(`[analyze] FRED fetch error for ${requestId}:`, errorMessage);
      
      return NextResponse.json(
        {
          error: true,
          code: "FRED_FETCH_FAILED",
          message: "Kunde inte hämta data från FRED",
          hint: "Kontrollera att din FRED_API_KEY är giltig och att du inte överskridit rate limits.",
          requestId,
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
      profile,
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
      cached: false,
      cacheAgeSeconds: null,
      cacheScope: "memory-instance",
      firebaseEnabled: isFirebaseConfigured(),
      requestId,
    };

    // Spara i cache
    setCache(cacheKey, response);

    // PRODUCTION: Spara snapshot till Firestore OCH kör retention cleanup (icke-blockerande)
    // Detta ska ALDRIG blockera response
    saveAndCleanup(response).catch((err) => {
      console.error(`[Firestore] Save/cleanup failed for ${requestId}:`, err);
    });

    console.log(`[analyze] Request ${requestId} completed successfully`);
    return NextResponse.json(response);
  } catch (error) {
    console.error(`[analyze] Unexpected error for ${requestId}:`, error);
    
    const errorMessage =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    return NextResponse.json(
      {
        error: true,
        code: "INTERNAL_ERROR",
        message: "Analysfel",
        hint: errorMessage,
        requestId,
      },
      { status: 500 }
    );
  }
}
