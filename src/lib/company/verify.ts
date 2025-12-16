/**
 * Promise Verification with KPI Data (XBRL)
 * 
 * Verifierar framåtblickande uttalanden (promises) mot faktiska KPI-data
 * från SEC XBRL Company Facts.
 * 
 * Förbättringar:
 * - Utökad KPI-mapping med fallbacks
 * - Tydligare feedback när KPI saknas
 * - Beräkning av Operating Margin för MARGIN promises
 * - Stöd för FCF och EPS verification
 */

import { ExtractedKpi, KpiExtractionResult, getKpiHistory } from "./kpis";
import { PromiseType } from "./promises";

// ============================================
// TYPES
// ============================================

export type VerificationStatus = 
  | "SUPPORTED"      // KPI-data stödjer promise (t.ex. revenue ökade)
  | "CONTRADICTED"   // KPI-data motsäger promise (t.ex. revenue minskade)
  | "UNRESOLVED"     // Kan inte avgöra (saknar data eller otydlig)
  | "PENDING";       // Väntar på framtida data

export type VerificationConfidence = "high" | "medium" | "low";

export interface KpiComparison {
  before: {
    period: string;
    value: number;
    unit: string;
    filedDate: string;
  } | null;
  after: {
    period: string;
    value: number;
    unit: string;
    filedDate: string;
  } | null;
  deltaAbs: number | null;
  deltaPct: number | null;
}

export interface VerificationResult {
  status: VerificationStatus;
  confidence: VerificationConfidence;
  kpiUsed: {
    key: string;
    label: string;
  } | null;
  comparison: KpiComparison;
  notes: string;
  reasoning: string[];
}

export interface PromiseForVerification {
  text: string;
  type: PromiseType;
  timeHorizon: string;
  measurable: boolean;
  confidence: string;
}

// ============================================
// KPI MAPPING FOR PROMISE TYPES (IMPROVED)
// ============================================

/**
 * Mappar promise-typer till relevanta KPI-nycklar med fallbacks.
 * Prioriterad ordning - första matchande KPI med data används.
 */
interface KpiMappingConfig {
  primary: string[];
  fallbacks?: string[];
  calculated?: {
    type: "margin";
    revenueKey: string;
    incomeKey: string;
    label: string;
  };
}

const PROMISE_TYPE_TO_KPI: Record<string, KpiMappingConfig> = {
  REVENUE: {
    primary: ["revenue"],
  },
  DEBT: {
    primary: ["totalDebt"],
    fallbacks: ["longTermDebt"], // Fallback om totalDebt saknas
  },
  CAPEX: {
    primary: ["capex"],
  },
  FCF: {
    primary: ["fcf"], // Free Cash Flow (beräknas i kpis.ts från CFO - CapEx)
  },
  COSTS: {
    // För COSTS: använd operatingIncome som proxy
    // Om operatingIncome ökar = relativa costs minskar = SUPPORTED
    primary: ["operatingIncome"],
    // Fallback: om operatingIncome saknas, kan vi använda netIncome som proxy
    // (men det är mindre optimalt eftersom det inkluderar icke-operativa poster)
    fallbacks: ["netIncome"],
  },
  MARGIN: {
    // För MARGIN: försök beräkna Operating Margin först (Revenue + OperatingIncome)
    // Fallback: använd direkt OperatingIncome eller GrossProfit
    primary: ["operatingIncome", "grossProfit"],
    calculated: {
      type: "margin",
      revenueKey: "revenue",
      incomeKey: "operatingIncome",
      label: "Operating Margin",
    },
  },
  EPS: {
    primary: ["epsBasic"],
    fallbacks: ["epsDiluted"],
  },
  STRATEGY: {
    primary: [], // Ingen direkt KPI-mapping
  },
  PRODUCT: {
    primary: ["revenue"], // Produkt-promises kan verifieras mot revenue
  },
  MARKET: {
    primary: ["revenue"], // Market-promises kan verifieras mot revenue
  },
  OTHER: {
    primary: [], // Ingen direkt KPI-mapping
  },
};

/**
 * Definierar hur KPI-förändring ska tolkas för verifiering.
 * true = ökning är positivt (SUPPORTED)
 * false = minskning är positivt (SUPPORTED)
 */
const KPI_DIRECTION_POSITIVE: Record<string, boolean> = {
  revenue: true,
  grossProfit: true,
  operatingIncome: true,
  netIncome: true,
  capex: true,
  totalDebt: false, // Minskad skuld är positivt
  longTermDebt: false,
  fcf: true,
  cash: true,
  epsBasic: true,
  epsDiluted: true,
  // För beräknade margins: ökning är positivt
  operatingMargin: true,
  grossMargin: true,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Hittar de två senaste datapunkterna för en KPI.
 */
function findKpiDataPoints(
  kpiResult: KpiExtractionResult,
  kpiKey: string,
  preferAnnual: boolean = true
): { before: ExtractedKpi | null; after: ExtractedKpi | null } {
  const history = getKpiHistory(
    kpiResult, 
    kpiKey, 
    preferAnnual ? "annual" : undefined
  );

  if (history.length === 0) {
    const quarterlyHistory = getKpiHistory(kpiResult, kpiKey, "quarterly");
    if (quarterlyHistory.length >= 2) {
      return {
        after: quarterlyHistory[0],
        before: quarterlyHistory[1],
      };
    }
    if (quarterlyHistory.length === 1) {
      return {
        after: quarterlyHistory[0],
        before: null,
      };
    }
    return { before: null, after: null };
  }

  if (history.length === 1) {
    return {
      after: history[0],
      before: null,
    };
  }

  return {
    after: history[0],
    before: history[1],
  };
}

/**
 * Beräknar Operating Margin från Revenue och Operating Income.
 */
function calculateMarginDataPoints(
  kpiResult: KpiExtractionResult,
  revenueKey: string,
  incomeKey: string,
  preferAnnual: boolean = true
): { before: { value: number; period: string; unit: string; filedDate: string } | null; after: { value: number; period: string; unit: string; filedDate: string } | null } {
  const revenueHistory = getKpiHistory(
    kpiResult,
    revenueKey,
    preferAnnual ? "annual" : undefined
  );
  
  const incomeHistory = getKpiHistory(
    kpiResult,
    incomeKey,
    preferAnnual ? "annual" : undefined
  );

  if (revenueHistory.length === 0 || incomeHistory.length === 0) {
    return { before: null, after: null };
  }

  // Hitta matchade perioder
  const matched: Array<{ revenue: ExtractedKpi; income: ExtractedKpi; margin: number }> = [];
  
  for (const rev of revenueHistory) {
    const matchingIncome = incomeHistory.find(
      inc => inc.fiscalYear === rev.fiscalYear && inc.fiscalPeriod === rev.fiscalPeriod
    );
    
    if (matchingIncome && rev.value !== 0) {
      const margin = (matchingIncome.value / rev.value) * 100;
      matched.push({
        revenue: rev,
        income: matchingIncome,
        margin,
      });
    }
  }

  if (matched.length === 0) {
    return { before: null, after: null };
  }

  // Sortera efter period (nyast först)
  matched.sort((a, b) => {
    if (a.revenue.fiscalYear !== b.revenue.fiscalYear) {
      return b.revenue.fiscalYear - a.revenue.fiscalYear;
    }
    const periodOrder: Record<string, number> = { FY: 0, Q4: 1, Q3: 2, Q2: 3, Q1: 4 };
    return (periodOrder[a.revenue.fiscalPeriod] ?? 5) - (periodOrder[b.revenue.fiscalPeriod] ?? 5);
  });

  const after = matched[0];
  const before = matched.length > 1 ? matched[1] : null;

  return {
    after: {
      value: after.margin,
      period: after.revenue.period,
      unit: "%",
      filedDate: after.revenue.filedDate,
    },
    before: before ? {
      value: before.margin,
      period: before.revenue.period,
      unit: "%",
      filedDate: before.revenue.filedDate,
    } : null,
  };
}

/**
 * Beräknar delta mellan två värden.
 */
function calculateDelta(
  before: number,
  after: number
): { deltaAbs: number; deltaPct: number } {
  const deltaAbs = after - before;
  const deltaPct = before !== 0 ? ((after - before) / Math.abs(before)) * 100 : 0;
  
  return {
    deltaAbs,
    deltaPct: Math.round(deltaPct * 100) / 100,
  };
}

/**
 * Bestämmer verification confidence baserat på data-kvalitet.
 */
function determineConfidence(
  hasBeforeData: boolean,
  hasAfterData: boolean,
  sameUnit: boolean,
  isAnnualData: boolean
): VerificationConfidence {
  let score = 0;

  if (hasBeforeData && hasAfterData) score += 40;
  else if (hasAfterData) score += 20;
  
  if (sameUnit) score += 20;
  if (isAnnualData) score += 20;
  
  if (hasBeforeData && hasAfterData && sameUnit) score += 20;

  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  return "low";
}

/**
 * Hittar KPI-nycklar för en promise-typ med fallbacks.
 */
function findKpiKeysForPromiseType(promiseType: string): string[] {
  const mapping = PROMISE_TYPE_TO_KPI[promiseType];
  if (!mapping) {
    return [];
  }
  
  const keys: string[] = [...mapping.primary];
  if (mapping.fallbacks) {
    keys.push(...mapping.fallbacks);
  }
  
  return keys;
}

/**
 * Hittar första tillgängliga KPI med data för en lista av KPI-nycklar.
 */
function findFirstAvailableKpi(
  kpiResult: KpiExtractionResult,
  kpiKeys: string[],
  preferAnnual: boolean = true
): { key: string; label: string; dataPoints: { before: ExtractedKpi | null; after: ExtractedKpi | null } } | null {
  for (const kpiKey of kpiKeys) {
    const dataPoints = findKpiDataPoints(kpiResult, kpiKey, preferAnnual);
    
    if (dataPoints.after) {
      // Hitta label från KPI-resultatet
      const kpiSample = kpiResult.kpis.find(k => k.key === kpiKey);
      const label = kpiSample?.label || kpiKey;
      
      return {
        key: kpiKey,
        label,
        dataPoints,
      };
    }
  }
  
  return null;
}

// ============================================
// MAIN VERIFICATION FUNCTION
// ============================================

/**
 * Verifierar en promise mot KPI-data med förbättrad mapping.
 * 
 * Regelbaserad MVP:
 * - REVENUE: SUPPORTED om after > before
 * - DEBT: SUPPORTED om after < before (minskat skuld)
 * - CAPEX: SUPPORTED om after > before (ökad investering)
 * - FCF: SUPPORTED om after > before
 * - COSTS: SUPPORTED om operatingIncome ökar (relativa costs minskar)
 * - MARGIN: SUPPORTED om margin ökar (kan beräknas från Revenue + OperatingIncome)
 * - EPS: SUPPORTED om after > before
 */
export function verifyPromiseWithKpis(
  promise: PromiseForVerification,
  kpiResult: KpiExtractionResult
): VerificationResult {
  const reasoning: string[] = [];
  
  const mapping = PROMISE_TYPE_TO_KPI[promise.type];
  
  // Steg 1: Kolla om promise-typen har KPI-mapping
  if (!mapping || mapping.primary.length === 0) {
    reasoning.push(`Promise-typ ${promise.type} har ingen direkt KPI-mapping`);
    return {
      status: "UNRESOLVED",
      confidence: "low",
      kpiUsed: null,
      comparison: {
        before: null,
        after: null,
        deltaAbs: null,
        deltaPct: null,
      },
      notes: `Relevant KPI saknas i XBRL-data för att verifiera ${promise.type}-promises. Ingen KPI-mapping definierad för denna typ.`,
      reasoning,
    };
  }

  // Steg 2: Försök hitta KPI-data
  let bestKpiKey: string | null = null;
  let bestLabel: string = "";
  let bestDataPoints: { before: ExtractedKpi | null; after: ExtractedKpi | null } | null = null;
  let isCalculatedMargin = false;

  // Steg 2a: Försök med beräknad margin för MARGIN promises
  if (promise.type === "MARGIN" && mapping.calculated) {
    const marginData = calculateMarginDataPoints(
      kpiResult,
      mapping.calculated.revenueKey,
      mapping.calculated.incomeKey,
      true
    );
    
    if (marginData.after) {
      bestKpiKey = "operatingMargin";
      bestLabel = mapping.calculated.label;
      bestDataPoints = {
        after: marginData.after ? {
          key: "operatingMargin",
          label: bestLabel,
          period: marginData.after.period,
          periodType: "annual",
          value: marginData.after.value,
          unit: marginData.after.unit,
          filedDate: marginData.after.filedDate,
          fiscalYear: 0,
          fiscalPeriod: "FY",
          form: "10-K",
        } : null,
        before: marginData.before ? {
          key: "operatingMargin",
          label: bestLabel,
          period: marginData.before.period,
          periodType: "annual",
          value: marginData.before.value,
          unit: marginData.before.unit,
          filedDate: marginData.before.filedDate,
          fiscalYear: 0,
          fiscalPeriod: "FY",
          form: "10-K",
        } : null,
      };
      isCalculatedMargin = true;
      reasoning.push(`Beräknade ${bestLabel} från Revenue och Operating Income`);
    }
  }

  // Steg 2b: Om ingen beräknad margin hittades, prova direkta KPIs
  if (!bestDataPoints || !bestDataPoints.after) {
    const kpiKeys = findKpiKeysForPromiseType(promise.type);
    const found = findFirstAvailableKpi(kpiResult, kpiKeys, true);
    
    if (found) {
      bestKpiKey = found.key;
      bestLabel = found.label;
      bestDataPoints = found.dataPoints;
      reasoning.push(`Hittade KPI "${found.label}" (${found.key})`);
    }
  }

  // Steg 3: Om ingen data hittades, returnera UNRESOLVED med tydlig feedback
  if (!bestKpiKey || !bestDataPoints || !bestDataPoints.after) {
    const kpiKeys = findKpiKeysForPromiseType(promise.type);
    const triedKeys = kpiKeys.length > 0 ? kpiKeys.join(", ") : "ingen";
    reasoning.push(`Ingen KPI-data hittades för nycklar: ${triedKeys}`);
    
    // Lista tillgängliga KPIs för debugging
    const availableKeys = Array.from(new Set(kpiResult.kpis.map(k => k.key))).slice(0, 10).join(", ");
    
    return {
      status: "UNRESOLVED",
      confidence: "low",
      kpiUsed: null,
      comparison: {
        before: null,
        after: null,
        deltaAbs: null,
        deltaPct: null,
      },
      notes: `Relevant KPI saknas i XBRL-data för ${promise.type}. Försökte hitta: ${triedKeys}. Tillgängliga KPIs i data: ${availableKeys || "inga"}.`,
      reasoning,
    };
  }

  // Steg 4: Bygg comparison-objekt
  const comparison: KpiComparison = {
    before: bestDataPoints.before ? {
      period: bestDataPoints.before.period,
      value: bestDataPoints.before.value,
      unit: bestDataPoints.before.unit,
      filedDate: bestDataPoints.before.filedDate,
    } : null,
    after: {
      period: bestDataPoints.after.period,
      value: bestDataPoints.after.value,
      unit: bestDataPoints.after.unit,
      filedDate: bestDataPoints.after.filedDate,
    },
    deltaAbs: null,
    deltaPct: null,
  };

  // Steg 5: Om endast senaste värde finns, returnera PENDING
  if (!bestDataPoints.before) {
    reasoning.push(`Endast senaste värde tillgängligt (${bestDataPoints.after.period})`);
    return {
      status: "PENDING",
      confidence: "low",
      kpiUsed: {
        key: bestKpiKey,
        label: bestLabel,
      },
      comparison,
      notes: `Endast senaste KPI-värde tillgängligt för ${bestLabel}. Väntar på nästa period för jämförelse.`,
      reasoning,
    };
  }

  // Steg 6: Beräkna delta och avgör status
  const { deltaAbs, deltaPct } = calculateDelta(
    bestDataPoints.before.value,
    bestDataPoints.after.value
  );
  comparison.deltaAbs = deltaAbs;
  comparison.deltaPct = deltaPct;
  
  reasoning.push(`Delta: ${deltaAbs.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${bestDataPoints.after.unit} (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%)`);

  const isIncreasePositive = KPI_DIRECTION_POSITIVE[bestKpiKey] ?? true;
  const valueIncreased = deltaAbs > 0;
  
  // Steg 7: Särskild hantering för COSTS promises
  // För COSTS: om operatingIncome ökar = relativ costs minskar = SUPPORTED
  const isCostsPromise = promise.type === "COSTS";
  
  let status: VerificationStatus;
  let statusNote: string;

  if (isCostsPromise) {
    // För COSTS använder vi operatingIncome som proxy
    // Om operating income ökar, betyder det att costs minskat relativt till revenue = SUPPORTED
    if (valueIncreased && deltaPct > 0) {
      status = "SUPPORTED";
      statusNote = `${bestLabel} ökade med ${deltaPct.toFixed(2)}%, vilket indikerar förbättrad kostnadseffektivitet (lägre relativa kostnader).`;
    } else if (deltaAbs < 0 && deltaPct < 0) {
      status = "CONTRADICTED";
      statusNote = `${bestLabel} minskade med ${Math.abs(deltaPct).toFixed(2)}%, vilket kan indikera ökade relativa kostnader.`;
    } else {
      status = "UNRESOLVED";
      statusNote = `${bestLabel} nästan oförändrad (${deltaPct.toFixed(2)}%).`;
    }
  } else {
    // Standard logik för andra promise-typer
    const isPositiveChange = isIncreasePositive ? valueIncreased : !valueIncreased;
    
    if (isPositiveChange && Math.abs(deltaPct) >= 1) {
      status = "SUPPORTED";
      statusNote = `${bestLabel} ${valueIncreased ? 'ökade' : 'minskade'} med ${Math.abs(deltaPct).toFixed(2)}%, vilket stödjer promise.`;
    } else if (!isPositiveChange && Math.abs(deltaPct) >= 1) {
      status = "CONTRADICTED";
      statusNote = `${bestLabel} ${valueIncreased ? 'ökade' : 'minskade'} med ${Math.abs(deltaPct).toFixed(2)}%, vilket motsäger promise.`;
    } else {
      status = "UNRESOLVED";
      statusNote = `${bestLabel} nästan oförändrad (${deltaPct.toFixed(2)}%).`;
    }
  }

  reasoning.push(statusNote);

  // Steg 8: Bestäm confidence
  const sameUnit = bestDataPoints.before.unit === bestDataPoints.after.unit;
  const isAnnualData = bestDataPoints.after.periodType === "annual";
  
  const confidence = determineConfidence(
    true,
    true,
    sameUnit,
    isAnnualData
  );

  return {
    status,
    confidence,
    kpiUsed: {
      key: bestKpiKey,
      label: bestLabel,
    },
    comparison,
    notes: statusNote,
    reasoning,
  };
}

/**
 * Batch-verifierar flera promises mot KPI-data.
 */
export function verifyMultiplePromises(
  promises: PromiseForVerification[],
  kpiResult: KpiExtractionResult
): Map<number, VerificationResult> {
  const results = new Map<number, VerificationResult>();
  
  for (let i = 0; i < promises.length; i++) {
    results.set(i, verifyPromiseWithKpis(promises[i], kpiResult));
  }
  
  return results;
}

/**
 * Filtrerar promises som kan verifieras (har KPI-mapping).
 */
export function getVerifiablePromiseTypes(): PromiseType[] {
  return Object.entries(PROMISE_TYPE_TO_KPI)
    .filter(([, mapping]) => mapping.primary.length > 0)
    .map(([type]) => type as PromiseType);
}

/**
 * Kontrollerar om en promise-typ kan verifieras.
 */
export function isVerifiableType(type: PromiseType): boolean {
  const mapping = PROMISE_TYPE_TO_KPI[type];
  return mapping !== undefined && mapping.primary.length > 0;
}
