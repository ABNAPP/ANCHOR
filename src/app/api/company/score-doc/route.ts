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
 * 3) Uppdatera dokumentet med promise.score och companyScore (snitt av icke-UNCLEAR)
 * 4) Returnera { ok:true, data:{ companyScore, scoredCount, totalPromises } }
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb, COMPANY_PROMISES_COLLECTION } from "@/lib/firebase/admin";
import { scorePromise } from "@/lib/company/scoring";
import { PromiseForVerification, VerificationResult } from "@/lib/company/verify";

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
    console.log(`[score] Found document with ${promises.length} promises`);

    if (promises.length === 0) {
      console.warn("[score] Document has no promises");
      return NextResponse.json(
        {
          ok: true,
          data: {
            companyScore: null,
            scoredCount: 0,
            totalPromises: 0,
            promises: [],
          },
        }
      );
    }

    // 4) Score varje promise
    console.log("[score] Starting to score promises...");
    const scoredPromises: StoredPromise[] = [];
    let scoredCount = 0;
    let scoreSum = 0;
    
    // Skapa en timestamp som används för alla promises i denna batch
    const scoringTimestamp = new Date().toISOString();

    try {
      promises.forEach((p, idx) => {
        try {
          const verification = p.verification ?? buildDefaultVerification();
          const promiseForVerification = mapPromiseForVerification(p);

          const scoreResult = scorePromise(promiseForVerification, verification);

          const scoredPromise = {
            ...p,
            score: {
              score0to100: scoreResult.score0to100,
              status: scoreResult.status,
              reasons: scoreResult.reasons,
              scoredAt: scoringTimestamp, // Använd ISO string istället för FieldValue (Firestore tillåter inte FieldValue i arrays)
            },
          };

          scoredPromises.push(scoredPromise);

          if (scoreResult.status !== "UNCLEAR") {
            scoredCount += 1;
            scoreSum += scoreResult.score0to100;
          }
        } catch (promiseError) {
          console.error(`[score] Error scoring promise ${idx}:`, promiseError);
          // Fortsätt med default score för denna promise
          const defaultVerification = buildDefaultVerification();
          const promiseForVerification = mapPromiseForVerification(p);
          const scoreResult = scorePromise(promiseForVerification, defaultVerification);
          
          scoredPromises.push({
            ...p,
            score: {
              score0to100: scoreResult.score0to100,
              status: scoreResult.status,
              reasons: [...scoreResult.reasons, `Error during scoring: ${promiseError instanceof Error ? promiseError.message : String(promiseError)}`],
              scoredAt: scoringTimestamp, // Använd ISO string istället för FieldValue
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

    const companyScore = scoredCount > 0 ? Number((scoreSum / scoredCount).toFixed(2)) : null;
    console.log(`[score] Scoring complete: companyScore=${companyScore}, scoredCount=${scoredCount}, totalPromises=${promises.length}`);

    // 5) Skriv tillbaka
    try {
      console.log("[score] Updating Firestore document...");
      await docRef.update({
        promises: scoredPromises,
        companyScore,
        scoringUpdatedAt: FieldValue.serverTimestamp(), // Top-level FieldValue är OK (inte i array)
      });
      console.log("[score] Firestore update successful");
    } catch (updateError) {
      console.error("[score] Firestore update failed:", updateError);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "FIRESTORE_UPDATE_FAILED",
            message: "Kunde inte uppdatera dokument i Firestore",
            details: updateError instanceof Error ? updateError.message : String(updateError),
          },
        },
        { status: 500 }
      );
    }

    // 6) Returnera resultat
    const responseData = {
      ok: true,
      data: {
        companyScore,
        scoredCount,
        totalPromises: promises.length,
        promises: scoredPromises.map((p) => ({
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
        })),
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
        ok: false,
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
