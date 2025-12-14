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
 * Regler (MVP):
 * 1. risk_off: VIX chg_20d > 0 OCH slope10y2y < 0 (eller bara VIX om slope saknas)
 * 2. tightening: DGS10 chg_20d > 0 OCH HY spread chg_20d > 0
 * 3. risk_on: Motsatsen till risk_off
 * 4. neutral: Annars
 */
export function detectRegime(features: MacroFeatures): RegimeResult {
  const conditions: string[] = [];
  
  const vixChg = features.chg20d["VIXCLS"];
  const dgs10Chg = features.chg20d["DGS10"];
  const hySpreadChg = features.chg20d["BAMLH0A0HYM2"];
  const slope = features.slope10y2y;

  // Analysera volatilitet (VIX)
  const vixRising = vixChg !== null && vixChg > 0;
  const vixFalling = vixChg !== null && vixChg < 0;

  // Analysera yield curve
  const curveInverted = slope !== null && slope < 0;
  const curveNormal = slope !== null && slope > 0;

  // Analysera ränteutveckling
  const ratesRising = dgs10Chg !== null && dgs10Chg > 0;
  const spreadWidening = hySpreadChg !== null && hySpreadChg > 0;

  // Samla aktiva conditions
  if (vixRising) conditions.push("VIX stiger (risk-off signal)");
  if (vixFalling) conditions.push("VIX faller (risk-on signal)");
  if (curveInverted) conditions.push("Inverterad yieldkurva (recession-varning)");
  if (curveNormal) conditions.push("Normal yieldkurva");
  if (ratesRising) conditions.push("Stigande räntor");
  if (spreadWidening) conditions.push("Vidgande kreditspreader");

  // Bestäm regime
  let risk: RiskLevel;
  let explanation: string;

  // RISK OFF: VIX stiger + inverterad kurva (eller bara VIX om slope saknas)
  if (vixRising && (curveInverted || slope === null)) {
    risk = "risk_off";
    explanation = slope === null
      ? "Risk-off läge: VIX stiger vilket indikerar ökad marknadsoro. Yield curve data saknas."
      : "Risk-off läge: VIX stiger och yieldkurvan är inverterad. Historiskt en stark recession-indikator. Rekommendation: defensiv positionering.";
  }
  // TIGHTENING/STRESS: Stigande räntor + vidgande spreader
  else if (ratesRising && spreadWidening) {
    risk = "tightening";
    explanation = "Åtstramning/stress: Både räntor och kreditspreader stiger. Detta indikerar finansiell stress och potentiellt stramare kreditvillkor.";
  }
  // RISK ON: VIX faller + normal kurva
  else if (vixFalling && curveNormal) {
    risk = "risk_on";
    explanation = "Risk-on läge: VIX faller och yieldkurvan är normal. Marknaden prisar in låg risk och ekonomisk tillväxt.";
  }
  // NEUTRAL: Blandade eller otillräckliga signaler
  else {
    risk = "neutral";
    explanation = "Neutral: Blandade signaler från marknaden. Ingen tydlig risk-on eller risk-off trend identifierad.";
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

