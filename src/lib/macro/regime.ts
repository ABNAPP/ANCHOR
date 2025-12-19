import { MacroFeatures } from "./features";

export type RiskLevel = "risk_off" | "tightening" | "neutral" | "risk_on";

export interface RegimeResult {
  risk: RiskLevel;
  conditions: string[];
  explanation: string;
}

/**
 * Detekterar makroekonomiskt regime baserat på features
 * 
 * CONTRACT: Regime-prioritet (första match vinner):
 * 1. RISK OFF (högsta prioritet)
 * 2. TIGHTENING
 * 3. RISK ON
 * 4. NEUTRAL (fallback)
 * 
 * CONTRACT: Regler:
 * - RISK OFF: VIX upp över tröskel (≥18) OCH chg20d ≥ +0.10 OCH yieldkurvan inverterad (slope < 0)
 * - TIGHTENING: Långa räntor stiger (DGS10 chg20d > 0) OCH kreditspreadar vidgas (BAMLH0A0HYM2 chg20d > 0)
 * - RISK ON: VIX faller (chg20d < 0) OCH yieldkurvan är positiv (slope > 0)
 * - NEUTRAL: Alla andra fall
 * 
 * CONTRACT: Regim kräver minst två aktiva signaler (förutom NEUTRAL som är fallback)
 */
export function detectRegime(features: MacroFeatures): RegimeResult {
  const conditions: string[] = [];
  
  const vixLatest = features.latest["VIXCLS"];
  const vixChg = features.chg20d["VIXCLS"];
  const dgs10Chg = features.chg20d["DGS10"];
  const hySpreadChg = features.chg20d["BAMLH0A0HYM2"];
  const slope = features.slope10y2y;

  // Analysera volatilitet (VIX)
  // CONTRACT: VIX-signal kräver: latest VIX ≥ 18 OCH chg20d ≥ +0.10
  const vixAboveThreshold = vixLatest !== null && vixLatest >= 18;
  const vixRisingEnough = vixChg !== null && vixChg >= 0.10;
  const vixSignal = vixAboveThreshold && vixRisingEnough;
  const vixFalling = vixChg !== null && vixChg < 0;

  // Analysera yield curve
  const curveInverted = slope !== null && slope < 0;
  const curveNormal = slope !== null && slope > 0;

  // Analysera ränteutveckling
  const ratesRising = dgs10Chg !== null && dgs10Chg > 0;
  const spreadWidening = hySpreadChg !== null && hySpreadChg > 0;

  // Samla aktiva conditions
  if (vixAboveThreshold) conditions.push(`VIX ≥ 18 (${vixLatest?.toFixed(1)})`);
  if (vixRisingEnough) conditions.push(`VIX stiger ≥ +0.10 (${vixChg?.toFixed(2)})`);
  if (vixFalling) conditions.push("VIX faller (risk-on signal)");
  if (curveInverted) conditions.push("Inverterad yieldkurva (recession-varning)");
  if (curveNormal) conditions.push("Normal yieldkurva");
  if (ratesRising) conditions.push("Stigande räntor");
  if (spreadWidening) conditions.push("Vidgande kreditspreader");

  // Bestäm regime (CONTRACT: första match vinner, strikt ordning)
  let risk: RiskLevel;
  let explanation: string;

  // 1. RISK OFF (högsta prioritet)
  // CONTRACT: VIX upp över tröskel OCH chg20d ≥ +0.10 OCH yieldkurvan inverterad
  // CONTRACT: Kräver minst två aktiva signaler (VIX-signal + inverterad kurva)
  if (vixSignal && curveInverted) {
    risk = "risk_off";
    explanation = "RISK OFF: VIX är högt (≥18) och stiger kraftigt (≥+0.10), samtidigt som yieldkurvan är inverterad. Detta är en stark recession-indikator. Rekommendation: defensiv positionering.";
  }
  // 2. TIGHTENING
  // CONTRACT: Långa räntor stiger OCH kreditspreadar vidgas
  // CONTRACT: Kräver minst två aktiva signaler (räntor + spreader)
  else if (ratesRising && spreadWidening) {
    risk = "tightening";
    explanation = "TIGHTENING: Både räntor och kreditspreader stiger. Detta indikerar finansiell stress och potentiellt stramare kreditvillkor.";
  }
  // 3. RISK ON
  // CONTRACT: VIX faller OCH yieldkurvan är positiv
  // CONTRACT: Kräver minst två aktiva signaler (VIX faller + normal kurva)
  else if (vixFalling && curveNormal) {
    risk = "risk_on";
    explanation = "RISK ON: VIX faller och yieldkurvan är normal. Marknaden prisar in låg risk och ekonomisk tillväxt.";
  }
  // 4. NEUTRAL (fallback)
  // CONTRACT: Alla andra fall (blandade eller otillräckliga signaler)
  else {
    risk = "neutral";
    explanation = "NEUTRAL: Blandade signaler från marknaden. Ingen tydlig risk-on eller risk-off trend identifierad. Kräver minst två aktiva signaler för att trigga ett specifikt regime.";
  }

  return {
    risk,
    conditions,
    explanation,
  };
}

/**
 * Returnerar en färgkod för risknivån (för UI)
 */
export function getRiskColor(risk: RiskLevel): string {
  switch (risk) {
    case "risk_off":
      return "#dc2626"; // Röd
    case "tightening":
      return "#f59e0b"; // Orange
    case "risk_on":
      return "#16a34a"; // Grön
    case "neutral":
    default:
      return "#6b7280"; // Grå
  }
}

/**
 * Returnerar en läsbar etikett för risknivån
 */
export function getRiskLabel(risk: RiskLevel): string {
  switch (risk) {
    case "risk_off":
      return "RISK OFF";
    case "tightening":
      return "TIGHTENING";
    case "risk_on":
      return "RISK ON";
    case "neutral":
    default:
      return "NEUTRAL";
  }
}
