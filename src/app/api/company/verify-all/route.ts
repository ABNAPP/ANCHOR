/**
 * API Route: POST /api/company/verify-all
 * 
 * Bulk-verifierar alla promises i ett dokument mot KPI-data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirestoreDb, COMPANY_PROMISES_COLLECTION } from "@/lib/firebase/admin";
import { fetchCompanyFacts } from "@/lib/sec/client";
import { extractKpisFromCompanyFacts } from "@/lib/company/kpis";
import { bulkVerifyPromises } from "@/lib/company/bulk-verification";
import { sanitizePromisesForFirestore, sanitizeForFirestore } from "@/lib/firebase/sanitize";
import { FieldValue } from "firebase-admin/firestore";

interface VerifyAllRequest {
  promiseDocId: string;
  cik: string;
  ticker?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  console.log("[verify-all] POST /api/company/verify-all - Starting");

  try {
    // 1. Parse body
    let body: VerifyAllRequest;
    try {
      body = await request.json();
    } catch (err) {
      console.error("[verify-all] Failed to parse request body:", err);
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

    const { promiseDocId, cik, ticker } = body;

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
    console.log(`[verify-all] Fetching document ${promiseDocId}`);
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
    console.log(`[verify-all] Fetching KPI data for CIK ${cik}`);
    let kpiResult;
    try {
      const companyFacts = await fetchCompanyFacts(cik);
      kpiResult = extractKpisFromCompanyFacts(companyFacts);
      console.log(`[verify-all] Extracted ${kpiResult.kpis.length} KPIs`);
    } catch (kpiError) {
      console.error("[verify-all] Failed to fetch KPI data:", kpiError);
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

    // 6. Kör bulk-verifiering (alla promises)
    console.log(`[verify-all] Verifying ${promises.length} promises`);
    const { results, summary } = bulkVerifyPromises(promises, kpiResult);

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

    // 8. Spara tillbaka till Firestore
    try {
      const sanitizedPromises = sanitizePromisesForFirestore(updatedPromises);
      const updateData = sanitizeForFirestore({
        promises: sanitizedPromises,
        bulkVerifiedAt: FieldValue.serverTimestamp(),
      });

      await docRef.update(updateData);
      console.log("[verify-all] Firestore update successful");
    } catch (updateError) {
      console.error("[verify-all] Firestore update failed:", updateError);
      // Fortsätt ändå - vi returnerar summary
    }

    // 9. Returnera summary
    return NextResponse.json({
      success: true,
      summary,
    });

  } catch (error) {
    console.error("[verify-all] Unexpected error:", error);
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

