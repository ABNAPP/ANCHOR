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
 * 5) Returnera { ok:true, data:{ companyScore, scoredCount, totalPromises, breakdown } }
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
  verification?: VerificationResult;
  score?: {
    score0to100: number;
    status: string;
    reasons: string[];
    scoredAt: string; // ISO timestamp string (inte FieldValue - Firestore tillåter inte FieldValue i arrays)
  };
}

interface FirestorePromiseDoc {
  promises?: StoredPromise[];
  companyScore?: number;
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
  console.log("[score] POST /api/company/score-doc - Starting");

  try {
    // 1) Parse body
    let body: ScoreDocRequest;
    try {
      const bodyText = await request.text();
      console.log("[score] Request body:", bodyText);
      body = JSON.parse(bodyText);
    } catch (err) {
      console.error("[score] Failed to parse request body:", err);
      return NextResponse.json(
        {
          ok: false,
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
    console.log("[score] promiseDocId:", promiseDocId);

    if (!promiseDocId || typeof promiseDocId !== "string") {
      console.error("[score] Missing or invalid promiseDocId");
      return NextResponse.json(
        {
          ok: false,
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
    console.log("[score] Initializing Firestore...");
    const db = getFirestoreDb();
    if (!db) {
      console.error("[score] Firestore not configured");
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FIRESTORE_NOT_CONFIGURED",
            message: "Firestore är inte konfigurerat",
            details: "Kontrollera att Firebase-miljövariabler är satta i .env.local",
          },
        },
        { status: 503 }
      );
    }

    // 3) Hämta dokument
    console.log(`[score] Fetching document ${promiseDocId} from collection ${COMPANY_PROMISES_COLLECTION}`);
    const docRef = db.collection(COMPANY_PROMISES_COLLECTION).doc(promiseDocId);
    let snap;
    try {
      snap = await docRef.get();
    } catch (firestoreError) {
      console.error("[score] Firestore get() failed:", firestoreError);
      return NextResponse.json(
        {
          ok: false,
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
      console.error(`[score] Document ${promiseDocId} not found`);
      return NextResponse.json(
        {
          ok: false,
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
    const cik10 = (data as any).cik10 || "";
    console.log(`[score] Found document with ${promises.length} promises, cik10: ${cik10}`);

    if (promises.length === 0) {
      console.warn("[score] Document has no promises");
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

    // 3) Hämta KPI-data om cik10 finns
    let kpiResult = null;
    if (cik10) {
      try {
        console.log(`[score] Fetching KPI data for CIK ${cik10}...`);
        const companyFacts = await fetchCompanyFacts(cik10);
        kpiResult = extractKpisFromCompanyFacts(companyFacts);
        console.log(`[score] KPI data fetched: ${kpiResult.kpis.length} data points`);
      } catch (kpiError) {
        console.error(`[score] Failed to fetch KPI data:`, kpiError);
        // Fortsätt utan KPI-data
      }
    }

    // 4) Verifiera promises med normaliserad KPI-map om KPI-data finns
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
      console.log(`[score] Verifying promises with normalized KPIs...`);
      const promisesForVerification: PromiseForVerification[] = promises.map(p => mapPromiseForVerification(p));
      const verifyResult = verifyPromisesWithNormalizedKpis(promisesForVerification, kpiResult);
      verificationResults = verifyResult.results;
      updatedPromises = verifyResult.updatedPromises;
      debugMeta = verifyResult.debugMeta;
      console.log(`[score] Verification complete: HELD=${debugMeta.resultsCounts.held}, MIXED=${debugMeta.resultsCounts.mixed}, FAILED=${debugMeta.resultsCounts.failed}, UNCLEAR=${debugMeta.resultsCounts.unclear}`);
    } else {
      console.log(`[score] No KPI data available, skipping verification`);
      // Skapa default promises med UNCLEAR status
      updatedPromises = promises.map(p => ({
        ...mapPromiseForVerification(p),
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

    // 5) Score varje promise (använd verifierade promises om de finns)
    console.log("[score] Starting to score promises...");
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
                scoredAt: scoringTimestamp,
              },
              verification: verificationResults?.get(idx) || originalPromise.verification,
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
              verification,
            });
          }
        } catch (promiseError) {
          console.error(`[score] Error scoring promise ${idx}:`, promiseError);
          const defaultVerification = buildDefaultVerification();
          const promiseForVerification = mapPromiseForVerification(promises[idx]);
          const scoreResult = scorePromise(promiseForVerification, defaultVerification);
          
          scoredPromises.push({
            ...promises[idx],
            score: {
              score0to100: scoreResult.score0to100,
              status: scoreResult.status,
              reasons: [...scoreResult.reasons, `Error: ${promiseError instanceof Error ? promiseError.message : String(promiseError)}`],
              scoredAt: scoringTimestamp,
            },
          });
        }
      });
    } catch (scoringError) {
      console.error("[score] Error during scoring loop:", scoringError);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "SCORING_FAILED",
            message: "Kunde inte scorea promises",
            details: scoringError instanceof Error ? scoringError.message : String(scoringError),
          },
        },
        { status: 500 }
      );
    }

    // 6) Beräkna company score baserat på verifierade promises
    const companyScoreResult = calculateCompanyScore(scoredPromises);
    const companyScore = companyScoreResult.companyScore;
    const scoredCount = companyScoreResult.scoredCount;
    
    console.log(`[score] Company score calculation:`);
    console.log(`[score]   companyScore: ${companyScore}`);
    console.log(`[score]   scoredCount: ${scoredCount}`);
    console.log(`[score]   breakdown:`, companyScoreResult.breakdown);

    // 7) Skriv tillbaka
    try {
      console.log("[score] Updating Firestore document...");
      
      // Sanitera promises för att ta bort undefined-värden
      const sanitizedPromises = sanitizePromisesForFirestore(scoredPromises);
      const updateData = sanitizeForFirestore({
        promises: sanitizedPromises,
        companyScore,
        scoringUpdatedAt: FieldValue.serverTimestamp(), // Top-level FieldValue är OK (inte i array)
      });
      
      await docRef.update(updateData);
      console.log("[firestore] sanitized write payload ok");
      console.log("[score] Firestore update successful");
    } catch (updateError) {
      console.error("[score] Firestore update failed:", updateError);
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

    // 8) Returnera resultat med debugMeta
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
        } : undefined,
        verification: p.verification,
      })),
      debugMeta: {
        ...debugMeta,
        // Begränsa arrays till max 30 items
        availableKpiKeysSample: debugMeta.availableKpiKeysSample?.slice(0, 30) || [],
        selectedKpisUsed: debugMeta.selectedKpisUsed?.slice(0, 30) || [],
      },
    };

    console.log("[score] Returning success response");
    return NextResponse.json(responseData);

  } catch (error) {
    // Catch-all för oväntade fel
    console.error("[score] Unexpected error:", error);
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
