/**
 * API Route: POST /api/company/verify-selected
 * 
 * Bulk-verifierar valda promises i ett dokument mot KPI-data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirestoreDb, COMPANY_PROMISES_COLLECTION } from "@/lib/firebase/admin";
import { fetchCompanyFacts } from "@/lib/sec/client";
import { extractKpisFromCompanyFacts } from "@/lib/company/kpis";
import { bulkVerifyPromises } from "@/lib/company/bulk-verification";
import { sanitizePromisesForFirestore, sanitizeForFirestore } from "@/lib/firebase/sanitize";
import { FieldValue } from "firebase-admin/firestore";
import { computeCompanyScoreFromPromises } from "@/lib/company/company-score";

interface VerifySelectedRequest {
  promiseDocId: string;
  promiseIds: (string | number)[];
  cik: string;
  ticker?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  console.log("[verify-selected] POST /api/company/verify-selected - Starting");

  try {
    // 1. Parse body
    let body: VerifySelectedRequest;
    try {
      body = await request.json();
    } catch (err) {
      console.error("[verify-selected] Failed to parse request body:", err);
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

    const { promiseDocId, promiseIds, cik, ticker } = body;

    // 2. Validera input
    if (!promiseDocId || typeof promiseDocId !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_PROMISE_DOC_ID",
            message: "promiseDocId är obligatoriskt",
          },
        },
        { status: 400 }
      );
    }

    if (!promiseIds || !Array.isArray(promiseIds) || promiseIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_PROMISE_IDS",
            message: "promiseIds måste vara en array med minst 1 id",
          },
        },
        { status: 400 }
      );
    }

    if (!cik || typeof cik !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_CIK",
            message: "cik är obligatoriskt",
          },
        },
        { status: 400 }
      );
    }

    // 3. Firestore init
    const db = getFirestoreDb();
    if (!db) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FIRESTORE_NOT_CONFIGURED",
            message: "Firestore är inte konfigurerat",
          },
        },
        { status: 500 }
      );
    }

    // 4. Hämta dokument från Firestore
    console.log(`[verify-selected] Fetching document ${promiseDocId}`);
    const docRef = db.collection(COMPANY_PROMISES_COLLECTION).doc(promiseDocId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `promiseDocId ${promiseDocId} hittades inte`,
          },
        },
        { status: 404 }
      );
    }

    const data = snap.data();
    const promises = data?.promises || [];

    if (promises.length === 0) {
      return NextResponse.json(
        {
          success: true,
          summary: {
            total: 0,
            processed: 0,
            skipped: 0,
            updated: 0,
            unclear: 0,
            held: 0,
            failed: 0,
            mixed: 0,
            errors: [],
          },
        }
      );
    }

    // 5. Hämta KPI-data
    console.log(`[verify-selected] Fetching KPI data for CIK ${cik}`);
    let kpiResult;
    try {
      const companyFacts = await fetchCompanyFacts(cik);
      kpiResult = extractKpisFromCompanyFacts(companyFacts);
      console.log(`[verify-selected] Extracted ${kpiResult.kpis.length} KPIs`);
    } catch (kpiError) {
      console.error("[verify-selected] Failed to fetch KPI data:", kpiError);
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "KPI_FETCH_FAILED",
            message: "Kunde inte hämta KPI-data",
            details: kpiError instanceof Error ? kpiError.message : String(kpiError),
          },
        },
        { status: 500 }
      );
    }

    // 6. Kör bulk-verifiering (valda promises)
    // Konvertera promiseIds till indices (om de är strings, konvertera till number)
    const indices = promiseIds.map(id => typeof id === "string" ? parseInt(id, 10) : id).filter(idx => !isNaN(idx));
    console.log(`[verify-selected] Verifying ${indices.length} selected promises`);
    const { results, summary } = bulkVerifyPromises(promises, kpiResult, indices);

    // 7. Uppdatera promises med verifieringsdata
    const updatedPromises = promises.map((promise: any, idx: number) => {
      const result = results.find(r => r.promiseIndex === idx);
      if (result && result.verification) {
        return {
          ...promise,
          verification: result.verification,
        };
      }
      return promise;
    });

    // 8. Beräkna company score baserat på verifierade promises
    const companyScoreResult = computeCompanyScoreFromPromises(updatedPromises);
    console.log(`[verify-selected] Company score: ${companyScoreResult.companyScore}, basis:`, companyScoreResult.basis);

    // 9. Spara tillbaka till Firestore
    try {
      const sanitizedPromises = sanitizePromisesForFirestore(updatedPromises);
      const updateData = sanitizeForFirestore({
        promises: sanitizedPromises,
        companyScore: companyScoreResult.companyScore,
        companyScoreUpdatedAt: new Date().toISOString(),
        companyScoreBasis: companyScoreResult.basis,
        bulkVerifiedAt: FieldValue.serverTimestamp(),
      });

      await docRef.update(updateData);
      console.log("[verify-selected] Firestore update successful");
    } catch (updateError) {
      console.error("[verify-selected] Firestore update failed:", updateError);
      // Fortsätt ändå - vi returnerar summary
    }

    // 10. Returnera summary
    return NextResponse.json({
      success: true,
      summary,
      companyScore: companyScoreResult.companyScore,
      companyScoreBasis: companyScoreResult.basis,
    });

  } catch (error) {
    console.error("[verify-selected] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Ett oväntat fel uppstod",
          details: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 }
    );
  }
}

