/**
 * API Route: POST /api/company/verify-promise
 * 
 * Verifierar en promise mot KPI-data från SEC XBRL.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { fetchCompanyFacts } from "@/lib/sec/client";
import { extractKpisFromCompanyFacts } from "@/lib/company/kpis";
import { verifyPromiseWithKpis, PromiseForVerification } from "@/lib/company/verify";
import { PromiseType } from "@/lib/company/promises";
import { 
  getFirestoreDb, 
  COMPANY_PROMISE_VERIFICATIONS_COLLECTION 
} from "@/lib/firebase/admin";
import { PromiseVerification } from "@/lib/firebase/types";

// ============================================
// TYPES
// ============================================

interface VerifyRequestBody {
  cik10: string;
  companyName: string;
  ticker?: string;
  filingAccession: string;
  filingDate: string;
  promiseDocId?: string;
  promiseIndex: number;
  promise: {
    text: string;
    type: string;
    timeHorizon: string;
    measurable: boolean;
    confidence: string;
  };
}

interface ErrorResponse {
  ok: false;
  error: {
    message: string;
    code: string;
    details?: string;
  };
}

// ============================================
// ERROR HELPERS
// ============================================

function categorizeError(error: unknown): { httpStatus: number; errorCode: string; userMessage: string; details: string } {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // SEC returnerade 404 - bolaget har inte XBRL-rapportering
  if (errorMessage.includes("404")) {
    return {
      httpStatus: 404,
      errorCode: "COMPANY_NOT_FOUND",
      userMessage: "Inga XBRL facts hittades för detta bolag. Bolaget kanske inte har XBRL-rapportering.",
      details: `SEC returnerade 404 för companyfacts endpoint. ${errorMessage}`,
    };
  }
  
  // Nätverksfel / SEC ej nåbar
  if (
    errorMessage.includes("fetch failed") ||
    errorMessage.includes("ECONNREFUSED") ||
    errorMessage.includes("ENOTFOUND") ||
    errorMessage.includes("ETIMEDOUT") ||
    errorMessage.includes("network") ||
    errorMessage.includes("Network")
  ) {
    return {
      httpStatus: 502,
      errorCode: "SEC_UNREACHABLE",
      userMessage: "Kunde inte nå SEC EDGAR. Kontrollera din internetanslutning eller VPN.",
      details: `SEC API är inte tillgänglig. ${errorMessage}`,
    };
  }
  
  // Timeout
  if (
    errorMessage.includes("timeout") ||
    errorMessage.includes("Timeout") ||
    errorMessage.includes("AbortError")
  ) {
    return {
      httpStatus: 504,
      errorCode: "REQUEST_TIMEOUT",
      userMessage: "SEC EDGAR svarade inte i tid. Försök igen senare.",
      details: "Request timeout efter 15 sekunder",
    };
  }
  
  // SEC returnerade annat fel
  if (errorMessage.includes("SEC API error")) {
    const statusMatch = errorMessage.match(/(\d{3})/);
    if (statusMatch) {
      const secStatus = parseInt(statusMatch[1]);
      if (secStatus === 403) {
        return {
          httpStatus: 403,
          errorCode: "SEC_FORBIDDEN",
          userMessage: "SEC blockerade anropet. Kontrollera att SEC_USER_AGENT är korrekt konfigurerad.",
          details: errorMessage,
        };
      }
      if (secStatus === 429) {
        return {
          httpStatus: 429,
          errorCode: "RATE_LIMITED",
          userMessage: "För många anrop till SEC. Vänta en minut och försök igen.",
          details: errorMessage,
        };
      }
      return {
        httpStatus: 502,
        errorCode: "SEC_ERROR",
        userMessage: `SEC returnerade fel (${secStatus}). Försök igen senare.`,
        details: errorMessage,
      };
    }
  }
  
  // JSON parse-fel
  if (
    errorMessage.includes("JSON") ||
    errorMessage.includes("Unexpected token")
  ) {
    return {
      httpStatus: 502,
      errorCode: "INVALID_RESPONSE",
      userMessage: "SEC returnerade ogiltigt svar. Försök igen senare.",
      details: errorMessage,
    };
  }
  
  // Default
  return {
    httpStatus: 500,
    errorCode: "FACTS_FETCH_FAILED",
    userMessage: "Kunde inte hämta XBRL-data. Försök igen.",
    details: errorMessage,
  };
}

// ============================================
// API HANDLER
// ============================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  let parsedBody: VerifyRequestBody;
  
  // Steg 0: Parsa JSON body
  try {
    parsedBody = await request.json();
  } catch (parseError) {
    console.error("[Verify] Failed to parse request body:", parseError);
    return NextResponse.json(
      {
        ok: false,
        error: {
          message: "Ogiltig JSON i request body.",
          code: "INVALID_JSON",
          details: parseError instanceof Error ? parseError.message : "Parse error",
        },
      } as ErrorResponse,
      { status: 400 }
    );
  }

  const { 
    cik10, 
    companyName, 
    ticker,
    filingAccession,
    filingDate,
    promiseDocId,
    promiseIndex, 
    promise 
  } = parsedBody;

  // Validera obligatoriska fält
  if (!cik10) {
    return NextResponse.json(
      { 
        ok: false,
        error: { message: "cik10 är obligatoriskt.", code: "MISSING_CIK" }
      } as ErrorResponse,
      { status: 400 }
    );
  }

  if (promiseIndex === undefined || promiseIndex === null) {
    return NextResponse.json(
      { 
        ok: false,
        error: { message: "promiseIndex är obligatoriskt.", code: "MISSING_PROMISE_INDEX" }
      } as ErrorResponse,
      { status: 400 }
    );
  }

  if (!promise || !promise.text || !promise.type) {
    return NextResponse.json(
      { 
        ok: false,
        error: { message: "promise med text och type är obligatoriskt.", code: "MISSING_PROMISE" }
      } as ErrorResponse,
      { status: 400 }
    );
  }

  console.log(`[Verify] Starting verification for CIK ${cik10}, promise index ${promiseIndex}`);
  console.log(`[Verify] Promise type: ${promise.type}, text: ${promise.text.slice(0, 100)}...`);

  // 1. Hämta company facts (XBRL data)
  let companyFacts;
  try {
    companyFacts = await fetchCompanyFacts(cik10);
  } catch (factError) {
    console.error(`[Verify] Failed to fetch company facts:`, factError);
    
    const { httpStatus, errorCode, userMessage, details } = categorizeError(factError);
    
    return NextResponse.json(
      { 
        ok: false,
        error: { 
          message: userMessage,
          code: errorCode,
          details,
        }
      } as ErrorResponse,
      { status: httpStatus }
    );
  }

  // 2. Extrahera KPIs
  let kpiResult;
  try {
    kpiResult = extractKpisFromCompanyFacts(companyFacts);
    console.log(`[Verify] Extracted ${kpiResult.kpis.length} KPIs from company facts`);
  } catch (extractError) {
    console.error(`[Verify] Failed to extract KPIs:`, extractError);
    return NextResponse.json(
      {
        ok: false,
        error: {
          message: "Kunde inte extrahera KPI:er från XBRL-data.",
          code: "KPI_EXTRACTION_FAILED",
          details: extractError instanceof Error ? extractError.message : "Unknown error",
        },
      } as ErrorResponse,
      { status: 500 }
    );
  }

  if (kpiResult.kpis.length === 0) {
    const emptyVerification = {
      status: "UNRESOLVED" as const,
      confidence: "low" as const,
      kpiUsed: null,
      comparison: { before: null, after: null, deltaAbs: null, deltaPct: null },
      notes: "Ingen KPI-data tillgänglig för verifiering.",
      reasoning: ["Inga KPI:er kunde extraheras från XBRL-data för detta bolag."],
    };
    return NextResponse.json({
      ok: true,
      data: {
        verification: emptyVerification,
        kpiSummary: { totalKpis: 0, uniqueMetrics: 0, coverageYears: [], asOf: kpiResult.asOf },
      },
      // Bakåtkompatibilitet
      success: true,
      verification: emptyVerification,
      kpiSummary: { totalKpis: 0, uniqueMetrics: 0, coverageYears: [], asOf: kpiResult.asOf },
    });
  }

  // 3. Förbered promise för verifiering
  const promiseForVerification: PromiseForVerification = {
    text: promise.text,
    type: promise.type as PromiseType,
    timeHorizon: promise.timeHorizon,
    measurable: promise.measurable,
    confidence: promise.confidence,
  };

  // 4. Kör verifiering
  let verificationResult;
  try {
    verificationResult = verifyPromiseWithKpis(promiseForVerification, kpiResult);
    console.log(`[Verify] Verification result: ${verificationResult.status} (${verificationResult.confidence})`);
  } catch (verifyError) {
    console.error(`[Verify] Verification logic failed:`, verifyError);
    return NextResponse.json(
      {
        ok: false,
        error: {
          message: "Verifieringslogiken misslyckades.",
          code: "VERIFICATION_FAILED",
          details: verifyError instanceof Error ? verifyError.message : "Unknown error",
        },
      } as ErrorResponse,
      { status: 500 }
    );
  }

  // 5. Spara till Firestore (om konfigurerat) - ej kritiskt
  const db = getFirestoreDb();
  let verificationId: string | undefined;
  let savedToFirestore = false;

  if (db) {
    try {
      const verificationDoc: PromiseVerification = {
        createdAt: FieldValue.serverTimestamp(),
        company: {
          cik10,
          name: companyName || "Unknown",
          ticker,
        },
        promiseRef: {
          promiseDocId,
          promiseIndex,
          filingAccession: filingAccession || "",
          filingDate: filingDate || "",
        },
        promise: {
          claim: promise.text,
          type: promise.type,
          timeHorizon: promise.timeHorizon,
          measurable: promise.measurable,
          confidence: promise.confidence,
        },
        kpiUsed: verificationResult.kpiUsed,
        comparison: verificationResult.comparison,
        status: verificationResult.status,
        verificationConfidence: verificationResult.confidence,
        notes: verificationResult.notes,
        reasoning: verificationResult.reasoning,
        source: {
          method: "XBRL_FACTS",
          asOf: kpiResult.asOf,
        },
      };

      const docRef = await db
        .collection(COMPANY_PROMISE_VERIFICATIONS_COLLECTION)
        .add(verificationDoc);
      
      verificationId = docRef.id;
      savedToFirestore = true;
      console.log(`[Verify] Saved verification to Firestore: ${verificationId}`);
    } catch (firestoreError) {
      // Firestore-fel är inte kritiskt - logga men fortsätt
      console.warn(`[Verify] Failed to save to Firestore:`, firestoreError);
    }
  } else {
    console.log(`[Verify] Firestore not configured, skipping save`);
  }

  // 6. Returnera resultat (normaliserat format)
  return NextResponse.json({
    ok: true,
    data: {
      verificationId,
      savedToFirestore,
      verification: {
        status: verificationResult.status,
        confidence: verificationResult.confidence,
        kpiUsed: verificationResult.kpiUsed,
        comparison: verificationResult.comparison,
        notes: verificationResult.notes,
        reasoning: verificationResult.reasoning,
      },
      kpiSummary: {
        totalKpis: kpiResult.kpis.length,
        uniqueMetrics: kpiResult.summary.uniqueMetrics,
        coverageYears: kpiResult.summary.coverageYears,
        asOf: kpiResult.asOf,
      },
      company: {
        cik10,
        name: companyName,
        ticker,
      },
      promise: {
        index: promiseIndex,
        type: promise.type,
        claim: promise.text.slice(0, 200) + (promise.text.length > 200 ? "..." : ""),
      },
    },
    // Bakåtkompatibilitet - behåll success och top-level fields
    success: true,
    verification: {
      status: verificationResult.status,
      confidence: verificationResult.confidence,
      kpiUsed: verificationResult.kpiUsed,
      comparison: verificationResult.comparison,
      notes: verificationResult.notes,
      reasoning: verificationResult.reasoning,
    },
    verificationId,
    savedToFirestore,
    kpiSummary: {
      totalKpis: kpiResult.kpis.length,
      uniqueMetrics: kpiResult.summary.uniqueMetrics,
      coverageYears: kpiResult.summary.coverageYears,
      asOf: kpiResult.asOf,
    },
  });
}

// ============================================
// GET - Hämta tidigare verifieringar
// ============================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const cik = searchParams.get("cik");
  const limit = parseInt(searchParams.get("limit") || "20");

  const db = getFirestoreDb();
  if (!db) {
    return NextResponse.json(
      { 
        ok: false,
        error: {
          message: "Firestore är inte konfigurerat. Historik är inte tillgänglig.",
          code: "FIRESTORE_NOT_CONFIGURED",
        }
      },
      { status: 503 }
    );
  }

  try {
    let query = db
      .collection(COMPANY_PROMISE_VERIFICATIONS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(Math.min(limit, 100));

    if (cik) {
      query = query.where("company.cik10", "==", cik);
    }

    const snapshot = await query.get();
    
    const verifications = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });

    return NextResponse.json({
      ok: true,
      data: {
        verifications,
        count: verifications.length,
      },
      // Bakåtkompatibilitet
      verifications,
      count: verifications.length,
    });
  } catch (error) {
    console.error(`[Verify GET] Error fetching verifications:`, error);
    return NextResponse.json(
      { 
        ok: false,
        error: {
          message: "Kunde inte hämta verifieringshistorik.",
          code: "FETCH_FAILED",
          details: error instanceof Error ? error.message : "Unknown error",
        }
      },
      { status: 500 }
    );
  }
}
