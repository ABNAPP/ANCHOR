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
    scoredAt: Date | FirebaseFirestore.FieldValue;
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
  // 1) Parse body
  let body: ScoreDocRequest;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "Ogiltig JSON i request body" },
      { status: 400 }
    );
  }

  const { promiseDocId } = body;

  if (!promiseDocId || typeof promiseDocId !== "string") {
    return NextResponse.json(
      { error: "MISSING_PROMISE_DOC_ID", message: "promiseDocId är obligatoriskt" },
      { status: 400 }
    );
  }

  // 2) Firestore init
  const db = getFirestoreDb();
  if (!db) {
    return NextResponse.json(
      { error: "FIRESTORE_NOT_CONFIGURED", message: "Firestore är inte konfigurerat" },
      { status: 503 }
    );
  }

  // 3) Hämta dokument
  const docRef = db.collection(COMPANY_PROMISES_COLLECTION).doc(promiseDocId);
  const snap = await docRef.get();

  if (!snap.exists) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: `promiseDocId ${promiseDocId} hittades inte` },
      { status: 404 }
    );
  }

  const data = snap.data() as FirestorePromiseDoc;
  const promises = data.promises || [];

  // 4) Score varje promise
  const scoredPromises: StoredPromise[] = [];
  let scoredCount = 0;
  let scoreSum = 0;

  promises.forEach((p, idx) => {
    const verification = p.verification ?? buildDefaultVerification();
    const promiseForVerification = mapPromiseForVerification(p);

    const scoreResult = scorePromise(promiseForVerification, verification);

    const scoredPromise = {
      ...p,
      score: {
        score0to100: scoreResult.score0to100,
        status: scoreResult.status,
        reasons: scoreResult.reasons,
        scoredAt: FieldValue.serverTimestamp(),
      },
    };

    scoredPromises.push(scoredPromise);

    if (scoreResult.status !== "UNCLEAR") {
      scoredCount += 1;
      scoreSum += scoreResult.score0to100;
    }
  });

  const companyScore = scoredCount > 0 ? Number((scoreSum / scoredCount).toFixed(2)) : null;

  // 5) Skriv tillbaka
  await docRef.update({
    promises: scoredPromises,
    companyScore,
    scoredAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
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
          scoredAt: p.score.scoredAt instanceof Date 
            ? p.score.scoredAt.toISOString() 
            : new Date().toISOString(),
        } : undefined,
      })),
    },
  });
}

