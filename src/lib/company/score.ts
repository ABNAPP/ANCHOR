/**
 * Company Score Calculation
 * 
 * Beräknar company credibility score baserat på verifierade promises.
 * 
 * Regler:
 * - HELD = +1
 * - MIXED = 0
 * - FAILED = -1
 * - IGNORERA UNCLEAR
 * 
 * Company Score = (summa poäng / antal verifierade promises) * 100
 * Avrunda till heltal
 */

export type PromiseScoreStatus = "HELD" | "MIXED" | "FAILED" | "UNCLEAR";

export interface PromiseWithScore {
  score?: {
    status: PromiseScoreStatus | string; // Acceptera både specifik typ och string för flexibilitet
    verifiedBy?: "kpi" | "manual";
    [key: string]: any;
  };
}

export interface CompanyScoreResult {
  companyScore: number | null;
  scoredCount: number;
  breakdown: {
    held: number;
    mixed: number;
    failed: number;
    unclear: number;
  };
}

/**
 * Beräknar company score baserat på verifierade promises.
 * 
 * @param promises - Array av promises med score
 * @returns Company score resultat med breakdown
 */
export function calculateCompanyScore(
  promises: PromiseWithScore[]
): CompanyScoreResult {
  const breakdown = {
    held: 0,
    mixed: 0,
    failed: 0,
    unclear: 0,
  };

  let scoreSum = 0;
  let verifiedCount = 0;

  for (const promise of promises) {
    if (!promise.score || !promise.score.status) {
      breakdown.unclear++;
      continue;
    }

    const status = String(promise.score.status).toUpperCase() as PromiseScoreStatus;

    // Räkna alla statusar
    if (status === "HELD") {
      breakdown.held++;
    } else if (status === "MIXED") {
      breakdown.mixed++;
    } else if (status === "FAILED") {
      breakdown.failed++;
    } else {
      breakdown.unclear++;
      continue; // Ignorera UNCLEAR i score-beräkning
    }

    // Lägg till poäng för verifierade promises (ignorera UNCLEAR)
    if (status === "HELD") {
      scoreSum += 1;
      verifiedCount++;
    } else if (status === "MIXED") {
      scoreSum += 0;
      verifiedCount++;
    } else if (status === "FAILED") {
      scoreSum += -1;
      verifiedCount++;
    }
  }

  // Beräkna company score
  // Company Score = (summa poäng / antal verifierade promises) * 100
  let companyScore: number | null = null;
  
  if (verifiedCount > 0) {
    const rawScore = (scoreSum / verifiedCount) * 100;
    // Avrunda till heltal
    companyScore = Math.round(rawScore);
  }

  return {
    companyScore,
    scoredCount: verifiedCount,
    breakdown,
  };
}

