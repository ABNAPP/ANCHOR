/**
 * Promise Scoring (Rule-Based MVP)
 *
 * Beräknar ett poäng (0-100) för ett verifierat promise baserat på:
 * - MatchScore (KPI-träff)
 * - DirectionScore (om riktning i claim matchar KPI-delta)
 * - MagnitudeScore (hur väl uppsatt mål nåddes)
 * - ConfidenceScore (baserat på claimens confidence)
 *
 * Status:
 * - HELD:    score >= 80
 * - MIXED:   50–79
 * - FAILED:  < 50 (endast om KPI matchar)
 * - UNCLEAR: ingen KPI-match
 */

import { PromiseForVerification, VerificationResult } from "./verify";

export type PromiseScoreStatus = "HELD" | "MIXED" | "FAILED" | "UNCLEAR";

export interface PromiseScoreResult {
  score0to100: number;
  status: PromiseScoreStatus;
  reasons: string[];
}

// ============================================
// HELPERS
// ============================================

const INCREASE_KEYWORDS = [
  "increase",
  "increases",
  "increasing",
  "grow",
  "grows",
  "growing",
  "raise",
  "raises",
  "rising",
  "improve",
  "improves",
  "improving",
  "expand",
  "expanding",
  "higher",
  "up",
  "double",
  "triple",
];

const DECREASE_KEYWORDS = [
  "decrease",
  "decreases",
  "decreasing",
  "reduce",
  "reduces",
  "reducing",
  "cut",
  "cuts",
  "cutting",
  "lower",
  "lowering",
  "down",
  "decline",
  "declines",
  "declining",
];

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function detectDirection(text: string): "up" | "down" | null {
  const lower = text.toLowerCase();
  if (INCREASE_KEYWORDS.some((k) => lower.includes(k))) return "up";
  if (DECREASE_KEYWORDS.some((k) => lower.includes(k))) return "down";
  return null;
}

function parseTargetPercentage(text: string): number | null {
  // Hitta första procenttal, t.ex. "increase by 10%" eller "grow 15 %"
  const match = text.match(/([-+]?\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return parseFloat(match[1]);
}

function confidenceToScore(confidence: string): number {
  // Stöd både numeriska och verbala confidence-värden
  const numeric = Number(confidence);
  if (!Number.isNaN(numeric)) {
    if (numeric >= 80) return 10;
    if (numeric >= 60) return 6;
    return 3;
  }

  const lower = confidence.toLowerCase();
  if (lower === "high") return 10;
  if (lower === "medium") return 6;
  if (lower === "low") return 3;
  return 3; // fallback
}

// ============================================
// MAIN SCORING
// ============================================

export function scorePromise(
  promise: PromiseForVerification,
  verification: VerificationResult
): PromiseScoreResult {
  const reasons: string[] = [];
  let score = 0;

  // 1) MatchScore
  const hasKpiMatch = !!verification?.kpiUsed;
  if (hasKpiMatch) {
    score += 40;
    reasons.push(`KPI matchad: ${verification.kpiUsed?.label || verification.kpiUsed?.key}`);
  } else {
    reasons.push("Ingen matchad KPI – status sätts till UNCLEAR");
  }

  // Om ingen KPI-match → direkt UNCLEAR
  if (!hasKpiMatch) {
    return {
      score0to100: 0,
      status: "UNCLEAR",
      reasons,
    };
  }

  // Delta för riktning och magnitude
  const deltaPct = verification?.comparison?.deltaPct;
  const hasDelta = deltaPct !== null && deltaPct !== undefined;

  // 2) DirectionScore
  const direction = detectDirection(promise.text);
  if (direction && hasDelta) {
    const matchesDirection =
      (direction === "up" && deltaPct > 0) || (direction === "down" && deltaPct < 0);
    if (matchesDirection) {
      score += 30;
      reasons.push(`Riktning stämmer med KPI-delta (${deltaPct?.toFixed(2)}%)`);
    } else {
      reasons.push(`Riktning stämmer inte med KPI-delta (${deltaPct?.toFixed(2)}%)`);
    }
  } else if (direction && !hasDelta) {
    reasons.push("Riktning angiven men KPI-delta saknas");
  } else {
    reasons.push("Ingen tydlig riktning i claim");
  }

  // 3) MagnitudeScore
  const targetPct = parseTargetPercentage(promise.text);
  if (hasDelta) {
    if (targetPct !== null) {
      const sameSign = (targetPct >= 0 && deltaPct! >= 0) || (targetPct < 0 && deltaPct! < 0);
      const achieved = sameSign && Math.abs(deltaPct!) >= Math.abs(targetPct) * 0.8;
      const partial = sameSign && Math.abs(deltaPct!) >= Math.abs(targetPct) * 0.4;
      if (achieved) {
        score += 20;
        reasons.push(`Mål uppnått eller nära (${deltaPct?.toFixed(2)}% vs mål ${targetPct}%)`);
      } else if (partial) {
        score += 10;
        reasons.push(`Mål delvis uppnått (${deltaPct?.toFixed(2)}% vs mål ${targetPct}%)`);
      } else {
        reasons.push(`Mål ej uppnått (${deltaPct?.toFixed(2)}% vs mål ${targetPct}%)`);
      }
    } else {
      score += 10; // neutral bonus när inget tydligt mål finns men KPI matchas
      reasons.push("Inget explicit mål; neutral magnitudspoäng");
    }
  } else {
    reasons.push("KPI-delta saknas – ingen magnitudspoäng");
  }

  // 4) ConfidenceScore
  const confidenceScore = confidenceToScore(promise.confidence);
  score += confidenceScore;
  reasons.push(`Confidence-bidrag: +${confidenceScore} (confidence=${promise.confidence})`);

  // Slutlig status
  const finalScore = clampScore(score);
  let status: PromiseScoreStatus;
  if (finalScore >= 80) status = "HELD";
  else if (finalScore >= 50) status = "MIXED";
  else status = "FAILED";

  return {
    score0to100: finalScore,
    status,
    reasons,
  };
}

