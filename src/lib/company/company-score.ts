/**
 * Company Score Calculation (MVP)
 * 
 * Beräknar company credibility score baserat på promises med verifierings-status.
 * 
 * DEFINITION (MVP):
 * - Använder promise.verification.status:
 *   - "Held" = +1
 *   - "Failed" = -1
 *   - "Mixed" = 0
 *   - "Unclear" = ignoreras (räknas inte med)
 * 
 * FORMEL (MVP):
 * - Låt N = antal promises där status != "Unclear"
 * - Låt S = summa av poäng (Held=+1, Failed=-1, Mixed=0)
 * - Låt C = genomsnitt = S / N  (C ligger mellan -1 och +1)
 * - Skala till 0–100:
 *   companyScore = round((C + 1) * 50)
 * 
 * Exempel:
 * - Alla Held → C=+1 → (1+1)*50 = 100
 * - Alla Failed → C=-1 → (-1+1)*50 = 0
 * - Blandat → mitt emellan
 */

// ============================================
// TYPES
// ============================================

export interface PromiseWithVerification {
  verification?: {
    status?: "Held" | "Failed" | "Mixed" | "Unclear" | string;
    [key: string]: any;
  } | null;
}

export interface CompanyScoreResult {
  companyScore: number | null;
  basis: {
    nonUnclearCount: number;
    held: number;
    failed: number;
    mixed: number;
    unclear: number;
  };
}

// ============================================
// MAIN: COMPUTE COMPANY SCORE
// ============================================

/**
 * Beräknar company score baserat på promises med verifierings-status.
 * 
 * @param promises - Array av promises med verification-status
 * @returns Company score resultat med basis
 * 
 * VIKTIGT:
 * - Om promises saknar verification-fält → behandla som "Unclear"
 * - Systemet får aldrig krascha pga saknade fält
 * - Om inga promises är verifierade (alla Unclear) → companyScore = null
 */
export function computeCompanyScoreFromPromises(
  promises: PromiseWithVerification[]
): CompanyScoreResult {
  const basis = {
    nonUnclearCount: 0,
    held: 0,
    failed: 0,
    mixed: 0,
    unclear: 0,
  };

  let scoreSum = 0;

  for (const promise of promises) {
    // Om verification saknas → behandla som "Unclear"
    if (!promise.verification || !promise.verification.status) {
      basis.unclear++;
      continue;
    }

    // Normalisera status (hantera både string och specifika typer)
    const status = String(promise.verification.status).trim();

    // Räkna alla statusar
    // Mappar både bulk-format ("Held", "Failed", "Mixed", "Unclear") 
    // och verification-format ("SUPPORTED", "CONTRADICTED", "UNRESOLVED", "PENDING")
    const normalizedStatus = status.toUpperCase();
    
    if (normalizedStatus === "HELD" || normalizedStatus === "SUPPORTED") {
      basis.held++;
      basis.nonUnclearCount++;
      scoreSum += 1; // Held = +1
    } else if (normalizedStatus === "FAILED" || normalizedStatus === "CONTRADICTED") {
      basis.failed++;
      basis.nonUnclearCount++;
      scoreSum += -1; // Failed = -1
    } else if (normalizedStatus === "MIXED") {
      basis.mixed++;
      basis.nonUnclearCount++;
      scoreSum += 0; // Mixed = 0
    } else {
      // Unclear, UNRESOLVED, PENDING, eller okänd status → ignorera
      basis.unclear++;
    }
  }

  // Beräkna company score
  // Score beräknas ENDAST om det finns minst 1 promise med status != "Unclear"
  let companyScore: number | null = null;

  if (basis.nonUnclearCount > 0) {
    // C = genomsnitt = S / N  (C ligger mellan -1 och +1)
    const C = scoreSum / basis.nonUnclearCount;

    // Skala till 0–100: companyScore = round((C + 1) * 50)
    companyScore = Math.round((C + 1) * 50);

    // Säkerställ att score ligger i intervallet 0-100 (säkerhetscheck)
    companyScore = Math.max(0, Math.min(100, companyScore));
  }

  return {
    companyScore,
    basis,
  };
}

