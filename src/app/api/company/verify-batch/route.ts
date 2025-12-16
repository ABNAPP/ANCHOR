/**
 * API Route: POST /api/company/verify-batch
 * 
 * Verifierar flera promises i batch mot KPI-data från SEC XBRL.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { fetchCompanyFacts } from "@/lib/sec/client";
import { extractKpisFromCompanyFacts } from "@/lib/company/kpis";
import { verifyPromiseWithKpis, PromiseForVerification } from "@/lib/company/verify";
import { PromiseType } from "@/lib/company/promises";
import { 
  getFirestoreDb, 
  isFirebaseConfigured,
  COMPANY_PROMISE_VERIFICATIONS_COLLECTION,
  COMPANY_PROMISES_COLLECTION
} from "@/lib/firebase/admin";
import { PromiseVerification } from "@/lib/firebase/types";
import { sanitizePromisesForFirestore, sanitizeForFirestore } from "@/lib/firebase/sanitize";

// ============================================
// TYPES
// ============================================

interface VerifyBatchRequestBody {
  cik10: string;
  companyName?: string;
  ticker?: string;
  filingAccession?: string;
  filingDate?: string;
  promiseDocId: string;
  promiseIndexes?: number[];
  promises: PromiseForVerification[];
}

interface BatchVerificationResult {
  promiseIndex: number;
  status: "SUPPORTED" | "CONTRADICTED" | "UNRESOLVED" | "PENDING";
  confidence: "high" | "medium" | "low";
  kpiUsed: { key: string; label: string } | null;
  comparison: {
    before: { period: string; value: number; unit: string; filedDate: string } | null;
    after: { period: string; value: number; unit: string; filedDate: string } | null;
    deltaAbs: number | null;
    deltaPct: number | null;
  };
  notes: string;
  reasoning: string[];
  verificationId?: string;
}

interface BatchVerificationResponse {
  ok: true;
  data: {
    total: number;
    verified: number;
    results: BatchVerificationResult[];
    kpiSummary: {
      totalKpis: number;
      uniqueMetrics: number;
      coverageYears: number[];
      asOf: string;
    };
  };
}

interface ErrorResponse {
  error: string;
  message: string;
  details?: string;
}

// ============================================
// ERROR HELPERS
// ============================================

function categorizeError(error: unknown): { httpStatus: number; errorCode: string; userMessage: string; details: string } {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (errorMessage.includes("404")) {
    return {
      httpStatus: 404,
      errorCode: "COMPANY_NOT_FOUND",
      userMessage: "Inga XBRL facts hittades för detta bolag. Bolaget kanske inte har XBRL-rapportering.",
      details: `SEC returnerade 404 för companyfacts endpoint. ${errorMessage}`,
    };
  }
  
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
  
  return {
    httpStatus: 500,
    errorCode: "BATCH_VERIFICATION_FAILED",
    userMessage: "Kunde inte verifiera promises. Försök igen.",
    details: errorMessage,
  };
}

// ============================================
// API HANDLER
// ============================================

export async function POST(request: NextRequest): Promise<NextResponse<BatchVerificationResponse | ErrorResponse>> {
  console.log("[verify] POST /api/company/verify-batch - Starting");
  
  let parsedBody: VerifyBatchRequestBody;
  
  // Steg 0: Parsa JSON body
  try {
    parsedBody = await request.json();
  } catch (parseError) {
    console.error("[verify] Failed to parse request body:", parseError);
    return NextResponse.json(
      {
        error: "INVALID_JSON",
        message: "Ogiltig JSON i request body.",
        details: parseError instanceof Error ? parseError.message : "Parse error",
      },
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
    promiseIndexes,
    promises
  } = parsedBody;

  // Validera obligatoriska fält
  if (!cik10) {
    return NextResponse.json(
      { 
        error: "MISSING_CIK",
        message: "cik10 är obligatoriskt."
      },
      { status: 400 }
    );
  }

  if (!promiseDocId) {
    return NextResponse.json(
      { 
        error: "MISSING_PROMISE_DOC_ID",
        message: "promiseDocId är obligatoriskt."
      },
      { status: 400 }
    );
  }

  if (!promises || !Array.isArray(promises) || promises.length === 0) {
    return NextResponse.json(
      { 
        error: "MISSING_PROMISES",
        message: "promises array är obligatoriskt och får inte vara tom."
      },
      { status: 400 }
    );
  }

  // Debug: Räkna promise-typer
  const promiseTypeCounts: Record<string, number> = {};
  promises.forEach((p) => {
    const type = p.type || "UNKNOWN";
    promiseTypeCounts[type] = (promiseTypeCounts[type] || 0) + 1;
  });
  console.log(`[verify] Promise types:`, promiseTypeCounts);
  console.log(`[verify] Total promises: ${promises.length}`);

  // Bestäm vilka promises som ska verifieras
  let promisesToVerify: { index: number; promise: PromiseForVerification }[];
  
  if (promiseIndexes && promiseIndexes.length > 0) {
    // Verifiera endast valda promises
    promisesToVerify = promiseIndexes
      .filter((idx) => idx >= 0 && idx < promises.length)
      .map((idx) => ({
        index: idx,
        promise: promises[idx],
      }));
    
    if (promisesToVerify.length === 0) {
      return NextResponse.json(
        { 
          error: "INVALID_PROMISE_INDEXES",
          message: "Inga giltiga promise indexes angivna."
        },
        { status: 400 }
      );
    }
  } else {
    // Verifiera alla promises
    promisesToVerify = promises.map((promise, idx) => ({
      index: idx,
      promise,
    }));
  }

  console.log(`[verify] Starting batch verification for CIK ${cik10}, ${promisesToVerify.length} promises to verify`);

  // 1. Hämta company facts (XBRL data) - en gång för alla
  let companyFacts;
  try {
    console.log(`[verify] Fetching company facts for CIK ${cik10}...`);
    companyFacts = await fetchCompanyFacts(cik10);
    console.log(`[verify] Company facts fetched successfully`);
  } catch (factError) {
    console.error(`[verify] Failed to fetch company facts:`, factError);
    
    const { httpStatus, errorCode, userMessage, details } = categorizeError(factError);
    
    return NextResponse.json(
      { 
        error: errorCode,
        message: userMessage,
        details,
      },
      { status: httpStatus }
    );
  }

  // 2. Extrahera KPIs - en gång för alla
  let kpiResult;
  try {
    console.log(`[verify] Extracting KPIs from company facts...`);
    kpiResult = extractKpisFromCompanyFacts(companyFacts);
    console.log(`[verify] Extracted ${kpiResult.kpis.length} KPIs from company facts`);
    
    // Debug: Visa tillgängliga KPI-keys (top 20)
    const kpiKeys = Array.from(new Set(kpiResult.kpis.map(k => k.key))).slice(0, 20);
    console.log(`[verify] Available KPI keys (top 20):`, kpiKeys);
    console.log(`[verify] KPI summary:`, {
      totalKpis: kpiResult.kpis.length,
      uniqueMetrics: kpiResult.summary.uniqueMetrics,
      coverageYears: kpiResult.summary.coverageYears,
      asOf: kpiResult.asOf,
    });
  } catch (extractError) {
    console.error(`[verify] Failed to extract KPIs:`, extractError);
    return NextResponse.json(
      {
        error: "KPI_EXTRACTION_FAILED",
        message: "Kunde inte extrahera KPI:er från XBRL-data.",
        details: extractError instanceof Error ? extractError.message : "Unknown error",
      },
      { status: 500 }
    );
  }

  // 3. Verifiera varje promise
  const results: BatchVerificationResult[] = [];
  const db = getFirestoreDb();
  
  // Räkna statusar för debug
  const statusCounts = {
    SUPPORTED: 0,
    CONTRADICTED: 0,
    UNRESOLVED: 0,
    PENDING: 0,
  };
  let matchedKpiCount = 0;

  for (const { index, promise } of promisesToVerify) {
    try {
      // Förbered promise för verifiering
      const promiseForVerification: PromiseForVerification = {
        text: promise.text,
        type: promise.type as PromiseType,
        timeHorizon: promise.timeHorizon,
        measurable: promise.measurable,
        confidence: promise.confidence,
      };

      // Kör verifiering
      const verificationResult = verifyPromiseWithKpis(promiseForVerification, kpiResult);
      
      // Räkna statusar
      statusCounts[verificationResult.status]++;
      if (verificationResult.kpiUsed) {
        matchedKpiCount++;
      }
      
      // Spara till Firestore (om konfigurerat) - ej kritiskt
      let verificationId: string | undefined;
      
      if (db && isFirebaseConfigured()) {
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
              promiseIndex: index,
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
        } catch (firestoreError) {
          // Firestore-fel är inte kritiskt - logga men fortsätt
          console.warn(`[verify] Failed to save verification ${index} to Firestore:`, firestoreError);
        }
      }

      results.push({
        promiseIndex: index,
        status: verificationResult.status,
        confidence: verificationResult.confidence,
        kpiUsed: verificationResult.kpiUsed,
        comparison: verificationResult.comparison,
        notes: verificationResult.notes,
        reasoning: verificationResult.reasoning,
        verificationId,
      });
    } catch (verifyError) {
      console.error(`[verify] Failed to verify promise ${index}:`, verifyError);
      statusCounts.UNRESOLVED++;
      // Lägg till ett felsvar för denna promise
      results.push({
        promiseIndex: index,
        status: "UNRESOLVED",
        confidence: "low",
        kpiUsed: null,
        comparison: {
          before: null,
          after: null,
          deltaAbs: null,
          deltaPct: null,
        },
        notes: verifyError instanceof Error ? verifyError.message : "Verifiering misslyckades",
        reasoning: ["Ett fel uppstod vid verifieringen"],
      });
    }
  }

  // Debug: Sammanfattning
  console.log(`[verify] Verification complete:`);
  console.log(`[verify]   Total promises: ${promisesToVerify.length}`);
  console.log(`[verify]   Matched KPI: ${matchedKpiCount}`);
  console.log(`[verify]   Status breakdown:`, statusCounts);

  // 4. Uppdatera promises-arrayen i Firestore med verifications
  if (db && promiseDocId) {
    try {
      console.log(`[verify] Updating promises in Firestore document ${promiseDocId}...`);
      const docRef = db.collection(COMPANY_PROMISES_COLLECTION).doc(promiseDocId);
      const docSnap = await docRef.get();
      
      if (docSnap.exists) {
        const docData = docSnap.data();
        const existingPromises = docData?.promises || [];
        
        // Uppdatera promises med verifications
        const updatedPromises = existingPromises.map((p: any, idx: number) => {
          const result = results.find(r => r.promiseIndex === idx);
          if (result) {
            return {
              ...p,
              verification: {
                status: result.status,
                confidence: result.confidence,
                kpiUsed: result.kpiUsed,
                comparison: result.comparison,
                notes: result.notes,
                reasoning: result.reasoning,
              },
            };
          }
          return p;
        });
        
        // Sanitera promises innan Firestore update
        const sanitizedPromises = sanitizePromisesForFirestore(updatedPromises);
        const updateData = sanitizeForFirestore({
          promises: sanitizedPromises,
          verificationUpdatedAt: FieldValue.serverTimestamp(),
        });
        
        await docRef.update(updateData);
        console.log("[firestore] sanitized write payload ok");
        console.log(`[verify] Firestore document updated with ${results.length} verifications`);
      } else {
        console.warn(`[verify] Firestore document ${promiseDocId} not found - skipping update`);
      }
    } catch (updateError) {
      console.error(`[verify] Failed to update Firestore document:`, updateError);
      // Fortsätt ändå - verifications är sparade i separat collection
    }
  }

  // 5. Returnera resultat
  return NextResponse.json({
    ok: true,
    data: {
      total: promisesToVerify.length,
      verified: results.filter((r) => r.status !== "UNRESOLVED").length,
      results,
      kpiSummary: {
        totalKpis: kpiResult.kpis.length,
        uniqueMetrics: kpiResult.summary.uniqueMetrics,
        coverageYears: kpiResult.summary.coverageYears,
        asOf: kpiResult.asOf,
      },
    },
  });
}
