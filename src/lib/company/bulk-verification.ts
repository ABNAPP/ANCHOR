/**
 * Bulk Verification Service
 * 
 * Centraliserad logik för bulk-verifiering av promises mot KPI-data.
 * 
 * AFFÄRSLOGIK:
 * - Loopar promises och verifierar mot KPI-data
 * - Skip om redan verifierad (status != "UNRESOLVED" eller verified=true)
 * - Mappar promise.type till KPI-keys
 * - Sätter verification-status enligt MVP-regler
 * - Hanterar fel per promise utan att stoppa resten
 */

import { VerificationResult, VerificationStatus, verifyPromiseWithKpis, PromiseForVerification } from "./verify";
import { KpiExtractionResult } from "./kpis";
import { PromiseType } from "./promises";
import { getKpiRefsForPromise } from "./promise-kpi-mapping";

// ============================================
// TYPES
// ============================================

export interface BulkVerificationResult {
  total: number;
  processed: number;
  skipped: number;
  updated: number;
  unclear: number;
  held: number;
  failed: number;
  mixed: number;
  errors: Array<{
    promiseId: string | number;
    message: string;
  }>;
}

export interface PromiseVerificationData {
  status: "Held" | "Failed" | "Mixed" | "Unclear";
  reason: string;
  kpiRefs: string[];
  computedAt: string;
  computedBy: "bulk-kpi";
}

// ============================================
// HELPER: INFER PROMISE TYPE FROM TEXT (MVP)
// ============================================

/**
 * Enkel best-effort klassning av promise type från text.
 * Används om promise saknar type eller har type="OTHER".
 */
function inferPromiseTypeFromText(text: string): PromiseType | "unknown" {
  const lowerText = text.toLowerCase();
  
  // Revenue
  if (lowerText.match(/\b(revenue|sales|netsales|reseller sales|demand)\b/)) {
    return "REVENUE";
  }
  
  // Margin
  if (lowerText.match(/\b(margin|profit|profitability|gross margin|operating margin)\b/)) {
    return "MARGIN";
  }
  
  // CapEx
  if (lowerText.match(/\b(capex|capital expenditure|invest|investment|spend|build|data center|property|plant|equipment)\b/)) {
    return "CAPEX";
  }
  
  // Costs
  if (lowerText.match(/\b(cost|expense|efficiency|savings|headcount|operating expense)\b/)) {
    return "COSTS";
  }
  
  // Debt
  if (lowerText.match(/\b(debt|borrowing|loan|leverage)\b/)) {
    return "DEBT";
  }
  
  return "unknown";
}

// ============================================
// HELPER: MAP PROMISE TYPE TO KPI (MVP)
// ============================================

/**
 * Minimal regel-tabell för KPI-mapping (MVP, stabil).
 * Returnerar array av KPI-keys att söka efter.
 */
function getKpiKeysForPromiseType(type: PromiseType | "unknown"): string[] {
  const mapping: Record<string, string[]> = {
    REVENUE: ["Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    DEBT: ["LongTermDebt", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligations"],
    CAPEX: ["CapitalExpenditures", "PaymentsToAcquirePropertyPlantAndEquipment"],
    COSTS: ["OperatingExpenses", "CostOfRevenue", "CostOfGoodsAndServicesSold"],
    MARGIN: ["GrossProfit", "OperatingIncomeLoss", "IncomeFromOperations"],
    FCF: ["FreeCashFlow", "NetCashProvidedByUsedInOperatingActivities", "CapitalExpenditures"], // Beräknas
    EPS: ["EarningsPerShareBasic", "EarningsPerShareDiluted"],
  };
  
  return mapping[type] || [];
}

// ============================================
// HELPER: MAP VERIFICATION STATUS (MVP -> BULK)
// ============================================

/**
 * Mappar VerificationStatus till bulk-format.
 */
function mapStatusToBulk(status: VerificationStatus): "Held" | "Failed" | "Mixed" | "Unclear" {
  switch (status) {
    case "SUPPORTED":
      return "Held";
    case "CONTRADICTED":
      return "Failed";
    case "PENDING":
      return "Unclear";
    case "UNRESOLVED":
    default:
      return "Unclear";
  }
}

// ============================================
// HELPER: SKIP LOGIC
// ============================================

/**
 * Kontrollerar om en promise ska skipas (redan verifierad).
 * 
 * Skip-logik (MVP):
 * - Om promise.verified === true, skip
 * - Om promise.verification.status finns och är Held/Failed/Mixed (inte Unclear/UNRESOLVED), skip
 * - Om existingVerification.status finns och är SUPPORTED/CONTRADICTED (inte UNRESOLVED/PENDING), skip
 */
function shouldSkipPromise(
  promise: any,
  existingVerification?: VerificationResult | null
): boolean {
  // Om promise har verified=true, skip
  if (promise.verified === true) {
    return true;
  }
  
  // Om verification.status finns och inte är "UNRESOLVED" eller "PENDING", skip
  if (existingVerification?.status && 
      existingVerification.status !== "UNRESOLVED" && 
      existingVerification.status !== "PENDING") {
    return true;
  }
  
  // Om promise.verification finns (i bulk-format) och status inte är "Unclear" eller "UNRESOLVED", skip
  if (promise.verification?.status) {
    const status = promise.verification.status;
    // Skip om status är Held, Failed, eller Mixed
    if (status === "Held" || status === "Failed" || status === "Mixed") {
      return true;
    }
    // Skip om status är SUPPORTED eller CONTRADICTED (gamla format)
    if (status === "SUPPORTED" || status === "CONTRADICTED") {
      return true;
    }
  }
  
  return false;
}

// ============================================
// MAIN: BULK VERIFY FUNCTION
// ============================================

/**
 * Verifierar en lista av promises mot KPI-data.
 * 
 * @param promises - Array av promises att verifiera
 * @param kpiResult - KPI-data från XBRL
 * @param promiseIds - Optional: array av promise IDs/indices att verifiera (om undefined, verifierar alla)
 * @returns BulkVerificationResult med summary
 */
export function bulkVerifyPromises(
  promises: Array<any>,
  kpiResult: KpiExtractionResult,
  promiseIds?: (string | number)[]
): { results: Array<{ promiseIndex: number; verification: PromiseVerificationData | null; error?: string }>; summary: BulkVerificationResult } {
  
  // Filtrera promises om promiseIds anges
  const promisesToVerify = promiseIds 
    ? promises.filter((_, idx) => promiseIds.includes(idx) || promiseIds.includes(String(idx)))
    : promises;
  
  const results: Array<{ promiseIndex: number; verification: PromiseVerificationData | null; error?: string }> = [];
  const summary: BulkVerificationResult = {
    total: promisesToVerify.length,
    processed: 0,
    skipped: 0,
    updated: 0,
    unclear: 0,
    held: 0,
    failed: 0,
    mixed: 0,
    errors: [],
  };
  
  // Loop genom promises
  promises.forEach((promise, originalIndex) => {
    // Skip om inte i promisesToVerify
    if (promiseIds && !promiseIds.includes(originalIndex) && !promiseIds.includes(String(originalIndex))) {
      return;
    }
    
    summary.processed++;
    
    try {
      // Kontrollera skip-logik
      const existingVerification = promise.verification || null;
      if (shouldSkipPromise(promise, existingVerification)) {
        summary.skipped++;
        results.push({
          promiseIndex: originalIndex,
          verification: null,
        });
        return;
      }
      
      // Använd centraliserad mapping för att hitta relevanta KPI:er
      const mappedKpiRefs = getKpiRefsForPromise({
        type: promise.type,
        text: promise.text || "",
      });
      
      // Om ingen KPI-matchning → sätt direkt till Unclear (skip verifiering)
      if (mappedKpiRefs.length === 0) {
        const bulkVerification: PromiseVerificationData = {
          status: "Unclear",
          reason: "Ingen KPI-mapping hittades för denna promise-typ",
          kpiRefs: [],
          computedAt: new Date().toISOString(),
          computedBy: "bulk-kpi",
        };
        
        summary.updated++;
        summary.unclear++;
        results.push({
          promiseIndex: originalIndex,
          verification: bulkVerification,
        });
        return;
      }
      
      // Infer promise type om saknas eller är "OTHER" (för verifyPromiseWithKpis)
      let promiseType: PromiseType = promise.type || "OTHER";
      if (promiseType === "OTHER" || !promiseType) {
        // Om mapping hittade KPI:er, försök inferera type från text
        // (enklare logik här eftersom mapping redan gjorts)
        const lowerText = (promise.text || "").toLowerCase();
        if (lowerText.match(/\b(revenue|sales)\b/)) promiseType = "REVENUE";
        else if (lowerText.match(/\b(margin|profit)\b/)) promiseType = "MARGIN";
        else if (lowerText.match(/\b(capex|invest)\b/)) promiseType = "CAPEX";
        else if (lowerText.match(/\b(cost|expense)\b/)) promiseType = "COSTS";
        else if (lowerText.match(/\b(debt)\b/)) promiseType = "DEBT";
      }
      
      // Förbered promise för verifiering
      const promiseForVerification: PromiseForVerification = {
        text: promise.text || "",
        type: promiseType,
        timeHorizon: promise.timeHorizon || "UNSPECIFIED",
        measurable: promise.measurable || false,
        confidence: promise.confidence || "low",
      };
      
      // Kör verifiering (använd befintlig logik)
      let verificationResult: VerificationResult;
      try {
        verificationResult = verifyPromiseWithKpis(
          promiseForVerification,
          kpiResult
        );
      } catch (verifyError) {
        // Om verifiering kastar, returnera Unclear
        throw new Error(`Verifiering misslyckades: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`);
      }
      
      // Mappa till bulk-format
      const bulkStatus = mapStatusToBulk(verificationResult.status);
      // Använd faktiska KPI:er från verifieringen, fallback till mappade KPI:er
      const finalKpiRefs: string[] = verificationResult.kpiUsed 
        ? [verificationResult.kpiUsed.key] 
        : mappedKpiRefs;
      
      // Bygg reason-sträng från notes och reasoning
      let reason = verificationResult.notes || "";
      if (verificationResult.reasoning && verificationResult.reasoning.length > 0) {
        reason += (reason ? " " : "") + verificationResult.reasoning.join("; ");
      }
      if (!reason) {
        reason = `Status: ${verificationResult.status}, Confidence: ${verificationResult.confidence}`;
      }
      
      const bulkVerification: PromiseVerificationData = {
        status: bulkStatus,
        reason,
        kpiRefs: finalKpiRefs,
        computedAt: new Date().toISOString(),
        computedBy: "bulk-kpi",
      };
      
      // Uppdatera summary
      summary.updated++;
      switch (bulkStatus) {
        case "Held":
          summary.held++;
          break;
        case "Failed":
          summary.failed++;
          break;
        case "Mixed":
          summary.mixed++;
          break;
        case "Unclear":
          summary.unclear++;
          break;
      }
      
      results.push({
        promiseIndex: originalIndex,
        verification: bulkVerification,
      });
      
    } catch (error) {
      // Fel i en promise stoppar inte resten
      const errorMessage = error instanceof Error ? error.message : String(error);
      summary.errors.push({
        promiseId: originalIndex,
        message: errorMessage,
      });
      
      // Sätt Unclear som fallback
      const bulkVerification: PromiseVerificationData = {
        status: "Unclear",
        reason: `Fel vid verifiering: ${errorMessage}`,
        kpiRefs: [],
        computedAt: new Date().toISOString(),
        computedBy: "bulk-kpi",
      };
      
      summary.updated++; // Räkna ändå som uppdaterad (med Unclear status)
      summary.unclear++;
      results.push({
        promiseIndex: originalIndex,
        verification: bulkVerification,
        error: errorMessage,
      });
    }
  });
  
  return { results, summary };
}

