/**
 * Central Verification Service
 * 
 * Denna fil innehåller all affärslogik för verifiering av promises.
 * UI-komponenter och data-lager (API-anrop) ska använda denna service.
 * 
 * SEPARATION OF CONCERNS:
 * - UI: Knappar, checkboxar, status-visning (page.tsx)
 * - Business Logic: Verifieringsregler, skip-logik (denna fil)
 * - Data Layer: API-anrop, state-uppdatering (page.tsx + API routes)
 */

import { VerificationResult } from "./verify";

// ============================================
// TYPES
// ============================================

/**
 * Standardiserad Promise-modell (MVP)
 * 
 * verified: boolean - Om promise är verifierad
 * verifiedAt: string | null - ISO timestamp när verifiering skedde
 * verifiedBy: string | null - Vem/vad som verifierade ("kpi" | "manual" | "auto")
 * relatedKpiId: string | null - KPI som användes (får finnas men används inte ännu)
 */
export interface StandardPromise {
  id?: string; // Optional för nuvarande implementation (använder index)
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  relatedKpiId: string | null;
  verification?: VerificationResult | null; // Detaljerad verifieringsdata
}

/**
 * Standardiserad KPI-modell (MVP)
 */
export interface StandardKpi {
  id: string;
  verified: boolean;
  verifiedAt: string | null;
}

/**
 * Verifieringsresultat från central funktion
 */
export interface VerificationServiceResult {
  success: boolean;
  skipped: boolean;
  error: {
    code: string;
    message: string;
    details?: string;
  } | null;
  verification: VerificationResult | null;
  promise: StandardPromise | null;
}

/**
 * Options för verifiering
 */
export interface VerifyPromiseOptions {
  skipIfVerified?: boolean; // Skip om redan verifierad (default: true)
  forceReverify?: boolean; // Tvinga omverifiering även om redan verifierad (default: false)
  verifiedBy?: "kpi" | "manual" | "auto"; // Vem/vad som verifierar (default: "kpi")
}

// ============================================
// CENTRAL VERIFIERINGSFUNKTION
// ============================================

/**
 * Central funktion för att verifiera en promise.
 * 
 * Denna funktion hanterar:
 * - Skip om redan verifierad (om skipIfVerified = true)
 * - Sätter verified, verifiedAt, verifiedBy
 * - Returnerar tydligt resultat (success/skipped/error)
 * 
 * @param promise - Promise att verifiera (med befintlig verification om finns)
 * @param verificationResult - Resultat från verifieringslogik (från verify.ts)
 * @param options - Verifieringsalternativ
 * @returns VerificationServiceResult med tydlig status
 */
export function verifyPromise(
  promise: StandardPromise,
  verificationResult: VerificationResult | null,
  options: VerifyPromiseOptions = {}
): VerificationServiceResult {
  const {
    skipIfVerified = true,
    forceReverify = false,
    verifiedBy = "kpi",
  } = options;

  // 1. Kontrollera om redan verifierad (skip-logik)
  if (skipIfVerified && !forceReverify && promise.verified) {
    return {
      success: true,
      skipped: true,
      error: null,
      verification: promise.verification || null,
      promise: {
        ...promise,
        // Behåll befintliga värden
      },
    };
  }

  // 2. Validera att vi har ett verifieringsresultat
  if (!verificationResult) {
    return {
      success: false,
      skipped: false,
      error: {
        code: "NO_VERIFICATION_RESULT",
        message: "Inget verifieringsresultat tillgängligt",
        details: "Verifieringslogiken returnerade inget resultat",
      },
      verification: null,
      promise: {
        ...promise,
        verified: false,
        verifiedAt: null,
        verifiedBy: null,
        verification: null,
      },
    };
  }

  // 3. Validera verifieringsresultat-struktur
  if (!verificationResult.status || !verificationResult.confidence) {
    return {
      success: false,
      skipped: false,
      error: {
        code: "INVALID_VERIFICATION_RESULT",
        message: "Ogiltig verifieringsstruktur",
        details: "Verifieringsresultat saknar status eller confidence",
      },
      verification: null,
      promise: {
        ...promise,
        verified: false,
        verifiedAt: null,
        verifiedBy: null,
        verification: null,
      },
    };
  }

  // 4. Sätt verified-status baserat på verification status
  // En promise är "verified" om vi har ett resultat (även om det är UNRESOLVED)
  // Detta är en affärslogik-beslut: vi har försökt verifiera = verified = true
  const isVerified = verificationResult.status !== "PENDING";

  // 5. Uppdatera promise med verifieringsdata
  const now = new Date().toISOString();
  const updatedPromise: StandardPromise = {
    ...promise,
    verified: isVerified,
    verifiedAt: now,
    verifiedBy: verifiedBy,
    verification: verificationResult,
    // relatedKpiId kan sättas senare när vi har KPI-ID mapping
    relatedKpiId: verificationResult.kpiUsed?.key || null,
  };

  // 6. Returnera success-resultat
  return {
    success: true,
    skipped: false,
    error: null,
    verification: verificationResult,
    promise: updatedPromise,
  };
}

// ============================================
// ERROR HELPERS
// ============================================

/**
 * Skapar en enhetlig error-struktur för verifieringsfel.
 * Alla verifieringsfel ska använda denna struktur.
 */
export function createVerificationError(
  code: string,
  message: string,
  details?: string
): VerificationServiceResult["error"] {
  return {
    code,
    message,
    details,
  };
}

/**
 * Normaliserar ett fel till enhetlig struktur.
 */
export function normalizeVerificationError(error: unknown): VerificationServiceResult["error"] {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as VerificationServiceResult["error"];
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  return createVerificationError(
    "UNKNOWN_ERROR",
    "Ett oväntat fel uppstod vid verifiering",
    errorMessage
  );
}

