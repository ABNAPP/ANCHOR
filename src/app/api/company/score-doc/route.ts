/**
 * API Route: POST /api/company/score-doc
 *
 * Beräknar scoring för alla promises i ett sparat dokument.
 *
 * Body:
 * {
 *   promiseDocId: string
 * }
 *
 * Steg:
 * 1) Läs dokumentet från Firestore (company_promises)
 * 2) För varje promise:
 *    - om verification finns, använd den
 *    - annars: skapa UNRESOLVED verification med neutral data
 *    - kör scorePromise()
 * 3) Beräkna company score baserat på verifierade promises
 * 4) Uppdatera dokumentet med promise.score och companyScore
 * 5) Returnera { success:true, companyScore, scoredCount, breakdown, promises, debugMeta }
 *
 * Felhantering:
 * - Alla fel returnerar { success:false, error:{ code, message, details } } med HTTP 400/500
 * - scoredCount = 0 är INTE ett fel, returnera success:true med companyScore:null
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb, COMPANY_PROMISES_COLLECTION } from "@/lib/firebase/admin";
import { sanitizePromisesForFirestore, sanitizeForFirestore } from "@/lib/firebase/sanitize";
import { scorePromise } from "@/lib/company/scoring";
import { PromiseForVerification, VerificationResult, verifyPromisesWithNormalizedKpis, PromiseWithScore } from "@/lib/company/verify";
import { calculateCompanyScore } from "@/lib/company/score";
import { extractKpisFromCompanyFacts } from "@/lib/company/kpis";
import { fetchCompanyFacts } from "@/lib/sec/client";

// Helper för att normalisera promise (exporterad från verify.ts via normalizePromise)
function normalizePromise(promise: Partial<PromiseWithScore> & { type?: string; confidence?: string | number }): PromiseWithScore {
  return {
    text: promise.text ?? "",
    type: (promise.type ?? "OTHER") as any,
    timeHorizon: promise.timeHorizon ?? "UNSPECIFIED",
    measurable: promise.measurable ?? false,
    confidence: typeof promise.confidence === "number" ? String(promise.confidence) : (promise.confidence ?? "low"),
    verification: promise.verification ?? null,
    score: promise.score ?? null,
  };
}

interface ScoreDocRequest {
  promiseDocId?: string;
}

interface StoredPromise {
  text: string;
  type: string;
  timeHorizon?: string;
  measurable?: boolean;
  confidence?: string | number;
  confidenceScore?: number;
  verification: VerificationResult | null; // Alltid satt (antingen objekt eller null, aldrig undefined)
  score: {
    score0to100: number;
    status: string;
    reasons: string[];
    scoredAt: string; // ISO timestamp string (inte FieldValue - Firestore tillåter inte FieldValue i arrays)
  } | null; // Alltid satt (antingen objekt eller null, aldrig undefined)
}

interface FirestorePromiseDoc {
  promises?: StoredPromise[];
  companyScore?: number;
  cik10?: string;
}

function buildDefaultVerification(): VerificationResult {
  return {
    status: "UNRESOLVED",
    confidence: "low",
    kpiUsed: null,
    comparison: {
      before: null,
      after: null,
      deltaAbs: null,
      deltaPct: null,
    },
    notes: "Ingen verifiering tillgänglig",
    reasoning: [],
  };
}

function mapPromiseForVerification(p: StoredPromise): PromiseForVerification {
  return {
    text: p.text ?? "",
    type: (p.type as any) ?? "OTHER",
    timeHorizon: p.timeHorizon ?? "UNSPECIFIED",
    measurable: p.measurable ?? false,
    confidence: (p.confidence as any) ?? "low",
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  console.log("[score-doc] POST /api/company/score-doc - Starting");

  try {
    // 1) Parse body
    let body: ScoreDocRequest;
    try {
      const bodyText = await request.text();
      console.log("[score-doc] Request body:", bodyText);
      body = JSON.parse(bodyText);
    } catch (err) {
      console.error("[score-doc] error", err);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Ogiltig JSON i request body",
            details: err instanceof Error ? err.message : String(err),
          },
        },
        { status: 400 }
      );
    }

    const { promiseDocId } = body;
    console.log("[score-doc] promiseDocId:", promiseDocId);

    if (!promiseDocId || typeof promiseDocId !== "string") {
      console.error("[score-doc] error: Missing or invalid promiseDocId");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_PROMISE_DOC_ID",
            message: "promiseDocId är obligatoriskt och måste vara en sträng",
            details: `Received: ${typeof promiseDocId} - ${JSON.stringify(promiseDocId)}`,
          },
        },
        { status: 400 }
      );
    }

    // 2) Firestore init
    console.log("[score-doc] Initializing Firestore...");
    const db = getFirestoreDb();
    if (!db) {
      console.error("[score-doc] error: Firestore not configured");
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FIRESTORE_NOT_CONFIGURED",
            message: "Firestore är inte konfigurerat",
            details: "Kontrollera att Firebase-miljövariabler är satta i .env.local",
          },
        },
        { status: 500 }
      );
    }

    // 3) Hämta dokument
    console.log(`[score-doc] Fetching document ${promiseDocId} from collection ${COMPANY_PROMISES_COLLECTION}`);
    const docRef = db.collection(COMPANY_PROMISES_COLLECTION).doc(promiseDocId);
    let snap;
    try {
      snap = await docRef.get();
    } catch (firestoreError) {
      console.error("[score-doc] error", firestoreError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FIRESTORE_ERROR",
            message: "Kunde inte hämta dokument från Firestore",
            details: firestoreError instanceof Error ? firestoreError.message : String(firestoreError),
          },
        },
        { status: 500 }
      );
    }

    if (!snap.exists) {
      console.error(`[score-doc] error: Document ${promiseDocId} not found`);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `promiseDocId ${promiseDocId} hittades inte i Firestore`,
            details: `Collection: ${COMPANY_PROMISES_COLLECTION}`,
          },
        },
        { status: 404 }
      );
    }

    const data = snap.data() as FirestorePromiseDoc;
    const promises = data.promises || [];
    const cik10 = data.cik10 || "";
    console.log(`[score-doc] Found document with ${promises.length} promises, cik10: ${cik10}`);

    if (promises.length === 0) {
      console.log("[score-doc] Document has no promises - returning success with empty data");
      return NextResponse.json(
        {
          success: true,
          companyScore: null,
          scoredCount: 0,
          breakdown: { held: 0, mixed: 0, failed: 0, unclear: 0 },
          promises: [],
          debugMeta: {
            totalPromises: 0,
            promiseTypeCounts: {},
            inferredTypeCounts: {},
            availableKpiKeysSample: [],
            selectedKpisUsed: [],
            resultsCounts: { held: 0, mixed: 0, failed: 0, unclear: 0 },
          },
        }
      );
    }

    // 4) Hämta KPI-data om cik10 finns
    let kpiResult = null;
    if (cik10) {
      try {
        console.log(`[score-doc] Fetching KPI data for CIK ${cik10}...`);
        const companyFacts = await fetchCompanyFacts(cik10);
        kpiResult = extractKpisFromCompanyFacts(companyFacts);
        console.log(`[score-doc] KPI data fetched: ${kpiResult.kpis.length} data points`);
      } catch (kpiError) {
        console.error(`[score-doc] Failed to fetch KPI data (continuing without it):`, kpiError);
        // Fortsätt utan KPI-data - detta är INTE ett kritiskt fel
      }
    }

    // 5) Verifiera promises med normaliserad KPI-map om KPI-data finns
    let verificationResults: Map<number, VerificationResult> | null = null;
    let updatedPromises: PromiseWithScore[] = [];
    let debugMeta: any = {
      totalPromises: promises.length,
      promiseTypeCounts: {},
      inferredTypeCounts: {},
      availableKpiKeysSample: [],
      selectedKpisUsed: [],
      resultsCounts: { held: 0, mixed: 0, failed: 0, unclear: 0 },
    };

    if (kpiResult) {
      try {
        console.log(`[score-doc] Verifying promises with normalized KPIs...`);
        const promisesForVerification: PromiseForVerification[] = promises.map(p => mapPromiseForVerification(p));
        const verifyResult = verifyPromisesWithNormalizedKpis(promisesForVerification, kpiResult);
        verificationResults = verifyResult.results;
        updatedPromises = verifyResult.updatedPromises;
        debugMeta = verifyResult.debugMeta;
        console.log(`[score-doc] Verification complete: HELD=${debugMeta.resultsCounts.held}, MIXED=${debugMeta.resultsCounts.mixed}, FAILED=${debugMeta.resultsCounts.failed}, UNCLEAR=${debugMeta.resultsCounts.unclear}`);
      } catch (verifyError) {
        console.error("[score-doc] error during verification:", verifyError);
        // Fortsätt med default promises - detta är INTE ett kritiskt fel
        updatedPromises = promises.map(p => normalizePromise({
          ...mapPromiseForVerification(p),
          verification: null,
          score: {
            score0to100: 0,
            status: "UNCLEAR" as const,
            reasons: ["Verifiering misslyckades"],
            scoredAt: new Date().toISOString(),
          },
        }));
        
        promises.forEach(p => {
          const type = p.type || "UNKNOWN";
          debugMeta.promiseTypeCounts[type] = (debugMeta.promiseTypeCounts[type] || 0) + 1;
        });
        debugMeta.resultsCounts.unclear = promises.length;
      }
    } else {
      console.log(`[score-doc] No KPI data available, skipping verification`);
      // Skapa default promises med UNCLEAR status
      updatedPromises = promises.map(p => normalizePromise({
        ...mapPromiseForVerification(p),
        verification: null,
        score: {
          score0to100: 0,
          status: "UNCLEAR" as const,
          reasons: ["Ingen KPI-data tillgänglig"],
          scoredAt: new Date().toISOString(),
        },
      }));
      
      // Räkna promise types för debugMeta
      promises.forEach(p => {
        const type = p.type || "UNKNOWN";
        debugMeta.promiseTypeCounts[type] = (debugMeta.promiseTypeCounts[type] || 0) + 1;
      });
      debugMeta.resultsCounts.unclear = promises.length;
    }

    // 6) Score varje promise (använd verifierade promises om de finns)
    console.log("[score-doc] Starting to score promises...");
    const scoredPromises: StoredPromise[] = [];
    const scoringTimestamp = new Date().toISOString();

    try {
      updatedPromises.forEach((updatedPromise, idx) => {
        try {
          const originalPromise = promises[idx];
          const verification = verificationResults?.get(idx) || originalPromise.verification || buildDefaultVerification();
          const promiseForVerification = mapPromiseForVerification(originalPromise);

          // Om updatedPromise redan har score från verifiering, använd den
          if (updatedPromise.score) {
            scoredPromises.push({
              ...originalPromise,
              score: {
                ...updatedPromise.score,
                scoredAt: updatedPromise.score.scoredAt || scoringTimestamp,
              },
              verification: verificationResults?.get(idx) || originalPromise.verification || null,
            });
          } else {
            // Annars kör scoring
            const scoreResult = scorePromise(promiseForVerification, verification);
            scoredPromises.push({
              ...originalPromise,
              score: {
                score0to100: scoreResult.score0to100,
                status: scoreResult.status,
                reasons: scoreResult.reasons,
                scoredAt: scoringTimestamp,
              },
              verification: verification || null,
            });
          }
        } catch (promiseError) {
          console.error(`[score-doc] Error scoring promise ${idx}:`, promiseError);
          const defaultVerification = buildDefaultVerification();
          const promiseForVerification = mapPromiseForVerification(promises[idx]);
          const scoreResult = scorePromise(promiseForVerification, defaultVerification);
          
          const normalized = normalizePromise({
            ...promises[idx],
            type: promises[idx].type as any,
            confidence: typeof promises[idx].confidence === "number" ? String(promises[idx].confidence) : promises[idx].confidence,
            verification: defaultVerification,
            score: {
              score0to100: scoreResult.score0to100,
              status: scoreResult.status,
              reasons: [...scoreResult.reasons, `Error: ${promiseError instanceof Error ? promiseError.message : String(promiseError)}`],
              scoredAt: scoringTimestamp,
            },
          });
          // Konvertera till StoredPromise format
          scoredPromises.push({
            ...normalized,
            verification: normalized.verification,
            score: normalized.score ? {
              score0to100: normalized.score.score0to100,
              status: normalized.score.status,
              reasons: normalized.score.reasons,
              scoredAt: normalized.score.scoredAt || scoringTimestamp,
            } : null,
          });
        }
      });
    } catch (scoringError) {
      console.error("[score-doc] error", scoringError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "SCORING_FAILED",
            message: "Kunde inte scorea promises",
            details: scoringError instanceof Error ? scoringError.message : String(scoringError),
          },
        },
        { status: 500 }
      );
    }

    // 7) Beräkna company score baserat på verifierade promises
    // Konvertera StoredPromise[] till format som calculateCompanyScore förväntar sig
    const promisesForScoring = scoredPromises.map(p => ({
      score: p.score ? {
        status: p.score.status,
      } : undefined,
    }));
    const companyScoreResult = calculateCompanyScore(promisesForScoring);
    const companyScore = companyScoreResult.companyScore;
    const scoredCount = companyScoreResult.scoredCount;
    
    console.log(`[score-doc] Company score calculation:`);
    console.log(`[score-doc]   companyScore: ${companyScore}`);
    console.log(`[score-doc]   scoredCount: ${scoredCount}`);
    console.log(`[score-doc]   breakdown:`, companyScoreResult.breakdown);

    // OBS: scoredCount = 0 är INTE ett fel - returnera success:true med companyScore:null

    // 8) Skriv tillbaka
    try {
      console.log("[score-doc] Updating Firestore document...");
      
      // Sanitera promises för att ta bort undefined-värden
      const sanitizedPromises = sanitizePromisesForFirestore(scoredPromises);
      const updateData = sanitizeForFirestore({
        promises: sanitizedPromises,
        companyScore,
        scoringUpdatedAt: FieldValue.serverTimestamp(), // Top-level FieldValue är OK (inte i array)
      });
      
      await docRef.update(updateData);
      console.log("[firestore] sanitized write payload ok");
      console.log("[score-doc] Firestore update successful");
    } catch (updateError) {
      console.error("[score-doc] error", updateError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FIRESTORE_UPDATE_FAILED",
            message: "Kunde inte uppdatera dokument i Firestore",
            details: updateError instanceof Error ? updateError.message : String(updateError),
          },
        },
        { status: 500 }
      );
    }

    // 9) Returnera resultat med debugMeta
    const responseData = {
      success: true,
      companyScore,
      scoredCount,
      breakdown: companyScoreResult.breakdown,
      promises: scoredPromises.slice(0, 50).map((p) => ({
        text: p.text,
        type: p.type,
        timeHorizon: p.timeHorizon,
        measurable: p.measurable,
        confidence: p.confidence,
        confidenceScore: p.confidenceScore,
        score: p.score ? {
          score0to100: p.score.score0to100,
          status: p.score.status,
          reasons: p.score.reasons,
          scoredAt: p.score.scoredAt, // Redan ISO string
        } : null,
        verification: p.verification,
      })),
      debugMeta: {
        ...debugMeta,
        // Begränsa arrays till max 30 items
        availableKpiKeysSample: debugMeta.availableKpiKeysSample?.slice(0, 30) || [],
        selectedKpisUsed: debugMeta.selectedKpisUsed?.slice(0, 30) || [],
      },
    };

    console.log("[score-doc] Returning success response");
    return NextResponse.json(responseData);

  } catch (error) {
    // Catch-all för oväntade fel
    console.error("[score-doc] error", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Ett oväntat fel uppstod vid scoring",
          details: errorMessage + (errorStack ? `\nStack: ${errorStack.split('\n').slice(0, 5).join('\n')}` : ''),
        },
      },
      { status: 500 }
    );
  }
}
