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
 * - Automatisk KPI-baserad verifiering för UNCLEAR promises
 * - Fuzzy matching för KPI-keys
 * - Inferera promise type från text
 * - Förbättrad logging
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

/**
 * Extended promise interface för automatisk verifiering.
 * Inkluderar score med möjlighet att uppdatera status.
 */
export interface PromiseWithScore extends PromiseForVerification {
  score?: {
    score0to100: number;
    status: "HELD" | "MIXED" | "FAILED" | "UNCLEAR";
    reasons: string[];
    scoredAt?: string;
    verifiedBy?: "kpi" | "manual";
    comparedKpi?: {
      key: string;
      label: string;
    };
    delta?: {
      abs: number;
      pct: number;
    };
    verifiedAt?: string;
  };
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
  fuzzyMatch?: string[]; // Keywords för fuzzy matching mot KPI-keys
}

const PROMISE_TYPE_TO_KPI: Record<string, KpiMappingConfig> = {
  REVENUE: {
    primary: ["revenue", "netSales"],
    fuzzyMatch: ["revenue", "sales", "netsales"],
  },
  DEBT: {
    primary: ["totalDebt"],
    fallbacks: ["longTermDebt"],
    fuzzyMatch: ["debt"],
  },
  CAPEX: {
    primary: ["capex"],
    fuzzyMatch: ["capex", "propertyplantandequipment", "paymentstoacquire"],
  },
  FCF: {
    primary: ["fcf"],
    fuzzyMatch: ["fcf", "freecashflow"],
  },
  COSTS: {
    primary: ["operatingExpenses", "cogs"],
    fallbacks: ["operatingIncome"],
    fuzzyMatch: ["operatingexpense", "costofrevenue", "cogs", "cost"],
  },
  MARGIN: {
    primary: ["operatingIncome", "grossProfit"],
    calculated: {
      type: "margin",
      revenueKey: "revenue",
      incomeKey: "operatingIncome",
      label: "Operating Margin",
    },
    fuzzyMatch: ["margin", "grossmargin", "operatingmargin"],
  },
  EPS: {
    primary: ["epsBasic"],
    fallbacks: ["epsDiluted"],
    fuzzyMatch: ["eps", "earningspershare"],
  },
  STRATEGY: {
    primary: [],
  },
  PRODUCT: {
    primary: ["revenue", "netSales"],
    fuzzyMatch: ["revenue", "sales"],
  },
  MARKET: {
    primary: ["revenue", "netSales"],
    fuzzyMatch: ["revenue", "sales"],
  },
  OTHER: {
    primary: [],
  },
};

/**
 * Definierar hur KPI-förändring ska tolkas för verifiering.
 * true = ökning är positivt (SUPPORTED)
 * false = minskning är positivt (SUPPORTED)
 */
const KPI_DIRECTION_POSITIVE: Record<string, boolean> = {
  revenue: true,
  netSales: true,
  grossProfit: true,
  operatingIncome: true,
  netIncome: true,
  operatingExpenses: false, // Minskade expenses är positivt
  cogs: false, // Minskade COGS är positivt
  capex: true,
  totalDebt: false, // Minskad skuld är positivt
  longTermDebt: false,
  fcf: true,
  cash: true,
  epsBasic: true,
  epsDiluted: true,
  operatingMargin: true,
  grossMargin: true,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Infererar promise type från text med keywords.
 */
function inferPromiseTypeFromText(text: string): PromiseType | null {
  const lower = text.toLowerCase();
  
  // REVENUE keywords
  if (lower.match(/\b(revenue|sales|revenues|netsales|top.?line)\b/)) {
    return "REVENUE";
  }
  
  // MARGIN keywords
  if (lower.match(/\b(margin|gross.?margin|operating.?margin|profitability)\b/)) {
    return "MARGIN";
  }
  
  // CAPEX keywords
  if (lower.match(/\b(capex|capital.?expenditure|invest|property|plant|equipment|infrastructure)\b/)) {
    return "CAPEX";
  }
  
  // COSTS keywords
  if (lower.match(/\b(cost|expense|efficiency|operating.?expense|cogs|cost.?of.?revenue)\b/)) {
    return "COSTS";
  }
  
  // DEBT keywords
  if (lower.match(/\b(debt|leverage|borrowing|liability)\b/)) {
    return "DEBT";
  }
  
  return null;
}

/**
 * Fuzzy match KPI-keys baserat på keywords (case-insensitive, contains).
 */
function findKpiByFuzzyMatch(
  kpiResult: KpiExtractionResult,
  keywords: string[]
): ExtractedKpi[] {
  const matched: ExtractedKpi[] = [];
  const availableKeys = Array.from(new Set(kpiResult.kpis.map(k => k.key)));
  
  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();
    for (const kpiKey of availableKeys) {
      const lowerKey = kpiKey.toLowerCase();
      if (lowerKey.includes(lowerKeyword) || lowerKeyword.includes(lowerKey)) {
        const kpis = kpiResult.kpis.filter(k => k.key === kpiKey);
        matched.push(...kpis);
      }
    }
  }
  
  return matched;
}

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
 * Beräknar Gross Margin proxy från Revenue och COGS.
 */
function calculateGrossMarginProxy(
  kpiResult: KpiExtractionResult,
  preferAnnual: boolean = true
): { before: { value: number; period: string; unit: string; filedDate: string } | null; after: { value: number; period: string; unit: string; filedDate: string } | null } {
  const revenueHistory = getKpiHistory(
    kpiResult,
    "revenue",
    preferAnnual ? "annual" : undefined
  );
  
  const cogsHistory = getKpiHistory(
    kpiResult,
    "cogs",
    preferAnnual ? "annual" : undefined
  );

  if (revenueHistory.length === 0 || cogsHistory.length === 0) {
    return { before: null, after: null };
  }

  const matched: Array<{ revenue: ExtractedKpi; cogs: ExtractedKpi; margin: number }> = [];
  
  for (const rev of revenueHistory) {
    const matchingCogs = cogsHistory.find(
      c => c.fiscalYear === rev.fiscalYear && c.fiscalPeriod === rev.fiscalPeriod
    );
    
    if (matchingCogs && rev.value !== 0) {
      const margin = ((rev.value - Math.abs(matchingCogs.value)) / rev.value) * 100;
      matched.push({
        revenue: rev,
        cogs: matchingCogs,
        margin,
      });
    }
  }

  if (matched.length === 0) {
    return { before: null, after: null };
  }

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
 * Använder fuzzy matching om exakt matchning misslyckas.
 */
function findFirstAvailableKpi(
  kpiResult: KpiExtractionResult,
  kpiKeys: string[],
  preferAnnual: boolean = true,
  fuzzyKeywords?: string[]
): { key: string; label: string; dataPoints: { before: ExtractedKpi | null; after: ExtractedKpi | null } } | null {
  // Steg 1: Försök exakt matchning
  for (const kpiKey of kpiKeys) {
    const dataPoints = findKpiDataPoints(kpiResult, kpiKey, preferAnnual);
    
    if (dataPoints.after) {
      const kpiSample = kpiResult.kpis.find(k => k.key === kpiKey);
      const label = kpiSample?.label || kpiKey;
      
      return {
        key: kpiKey,
        label,
        dataPoints,
      };
    }
  }
  
  // Steg 2: Om ingen exakt match, försök fuzzy matching
  if (fuzzyKeywords && fuzzyKeywords.length > 0) {
    const fuzzyMatches = findKpiByFuzzyMatch(kpiResult, fuzzyKeywords);
    if (fuzzyMatches.length > 0) {
      // Gruppera efter key och ta första med data
      const keyGroups = new Map<string, ExtractedKpi[]>();
      for (const kpi of fuzzyMatches) {
        if (!keyGroups.has(kpi.key)) {
          keyGroups.set(kpi.key, []);
        }
        keyGroups.get(kpi.key)!.push(kpi);
      }
      
      for (const [fuzzyKey, kpis] of keyGroups.entries()) {
        const dataPoints = findKpiDataPoints(kpiResult, fuzzyKey, preferAnnual);
        if (dataPoints.after) {
          const kpiSample = kpis[0];
          return {
            key: fuzzyKey,
            label: kpiSample.label || fuzzyKey,
            dataPoints,
          };
        }
      }
    }
  }
  
  return null;
}

// ============================================
// AUTOMATIC KPI-BASED VERIFICATION FOR UNCLEAR PROMISES
// ============================================

/**
 * Automatisk KPI-baserad verifiering för promises med status "UNCLEAR".
 */
export function autoVerifyUnclearPromises(
  promises: PromiseWithScore[],
  kpiResult: KpiExtractionResult
): PromiseWithScore[] {
  const updatedPromises: PromiseWithScore[] = [];

  for (const promise of promises) {
    if (!promise.score || promise.score.status !== "UNCLEAR") {
      updatedPromises.push(promise);
      continue;
    }

    try {
      const mapping = PROMISE_TYPE_TO_KPI[promise.type];
      
      if (!mapping || mapping.primary.length === 0) {
        updatedPromises.push(promise);
        continue;
      }

      let bestKpiKey: string | null = null;
      let bestLabel: string = "";
      let bestDataPoints: { before: ExtractedKpi | null; after: ExtractedKpi | null } | null = null;

      if (promise.type === "MARGIN" && mapping.calculated) {
        const marginData = calculateMarginDataPoints(
          kpiResult,
          mapping.calculated.revenueKey,
          mapping.calculated.incomeKey,
          true
        );
        
        if (marginData.after && marginData.before) {
          bestKpiKey = "operatingMargin";
          bestLabel = mapping.calculated.label;
          bestDataPoints = {
            after: {
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
            },
            before: {
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
            },
          };
        }
      }

      if (!bestDataPoints || !bestDataPoints.after || !bestDataPoints.before) {
        const kpiKeys = findKpiKeysForPromiseType(promise.type);
        const found = findFirstAvailableKpi(
          kpiResult, 
          kpiKeys, 
          true,
          mapping.fuzzyMatch
        );
        
        if (found && found.dataPoints.after && found.dataPoints.before) {
          bestKpiKey = found.key;
          bestLabel = found.label;
          bestDataPoints = found.dataPoints;
        }
      }

      if (!bestKpiKey || !bestDataPoints || !bestDataPoints.after || !bestDataPoints.before) {
        updatedPromises.push(promise);
        continue;
      }

      const { deltaAbs, deltaPct } = calculateDelta(
        bestDataPoints.before.value,
        bestDataPoints.after.value
      );

      const isIncreasePositive = KPI_DIRECTION_POSITIVE[bestKpiKey] ?? true;
      const valueIncreased = deltaAbs > 0;
      const isPositiveChange = isIncreasePositive ? valueIncreased : !valueIncreased;

      const promiseTextLower = promise.text.toLowerCase();
      const isPositiveClaim = 
        ["increase", "increases", "increasing", "grow", "grows", "growing", "raise", "raises", "rising", "improve", "improves", "improving", "expand", "expanding", "higher", "up", "double", "triple"].some(
          keyword => promiseTextLower.includes(keyword)
        );
      const isNegativeClaim = 
        ["decrease", "decreases", "decreasing", "reduce", "reduces", "reducing", "cut", "cuts", "cutting", "lower", "lowering", "down", "decline", "declines", "declining"].some(
          keyword => promiseTextLower.includes(keyword)
        );

      let newStatus: "HELD" | "MIXED" | "FAILED" | "UNCLEAR" = "UNCLEAR";

      if (isPositiveClaim) {
        if (isPositiveChange && Math.abs(deltaPct) >= 1) {
          newStatus = "HELD";
        } else if (!isPositiveChange && Math.abs(deltaPct) >= 1) {
          newStatus = "FAILED";
        } else {
          newStatus = "MIXED";
        }
      } else if (isNegativeClaim) {
        if (!isPositiveChange && Math.abs(deltaPct) >= 1) {
          newStatus = "HELD";
        } else if (isPositiveChange && Math.abs(deltaPct) >= 1) {
          newStatus = "FAILED";
        } else {
          newStatus = "MIXED";
        }
      } else {
        if (Math.abs(deltaPct) >= 5) {
          newStatus = "MIXED";
        } else {
          newStatus = "UNCLEAR";
        }
      }

      const updatedPromise: PromiseWithScore = {
        ...promise,
        score: {
          ...promise.score,
          status: newStatus,
          verifiedBy: "kpi",
          comparedKpi: {
            key: bestKpiKey,
            label: bestLabel,
          },
          delta: {
            abs: deltaAbs,
            pct: deltaPct,
          },
          verifiedAt: new Date().toISOString(),
          reasons: [
            ...promise.score.reasons,
            `Auto-verifierad via KPI: ${bestLabel} ${valueIncreased ? 'ökade' : 'minskade'} med ${Math.abs(deltaPct).toFixed(2)}% (${bestDataPoints.before.period} → ${bestDataPoints.after.period})`,
          ],
        },
      };

      updatedPromises.push(updatedPromise);
    } catch (error) {
      console.error(`[autoVerify] Error verifying promise:`, error);
      updatedPromises.push(promise);
    }
  }

  return updatedPromises;
}

// ============================================
// MAIN VERIFICATION FUNCTION
// ============================================

/**
 * Verifierar en promise mot KPI-data med förbättrad mapping och fuzzy matching.
 */
export function verifyPromiseWithKpis(
  promise: PromiseForVerification,
  kpiResult: KpiExtractionResult
): VerificationResult {
  const reasoning: string[] = [];
  
  // Försök inferera type om OTHER eller saknas
  let promiseType = promise.type;
  if (promiseType === "OTHER" || !promiseType) {
    const inferred = inferPromiseTypeFromText(promise.text);
    if (inferred) {
      promiseType = inferred;
      reasoning.push(`Infererade promise type: ${inferred} från text`);
    }
  }
  
  const mapping = PROMISE_TYPE_TO_KPI[promiseType];
  
  if (!mapping || mapping.primary.length === 0) {
    reasoning.push(`Promise-typ ${promiseType} har ingen direkt KPI-mapping`);
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
      notes: `Relevant KPI saknas i XBRL-data för att verifiera ${promiseType}-promises. Ingen KPI-mapping definierad för denna typ.`,
      reasoning,
    };
  }

  let bestKpiKey: string | null = null;
  let bestLabel: string = "";
  let bestDataPoints: { before: ExtractedKpi | null; after: ExtractedKpi | null } | null = null;

  // Steg 1: Försök med beräknad margin för MARGIN promises
  if (promiseType === "MARGIN" && mapping.calculated) {
    const marginData = calculateMarginDataPoints(
      kpiResult,
      mapping.calculated.revenueKey,
      mapping.calculated.incomeKey,
      true
    );
    
    if (marginData.after && marginData.before) {
      bestKpiKey = "operatingMargin";
      bestLabel = mapping.calculated.label;
      bestDataPoints = {
        after: {
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
        },
        before: {
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
        },
      };
      reasoning.push(`Beräknade ${bestLabel} från Revenue och Operating Income`);
    } else {
      // Försök Gross Margin proxy
      const grossMarginData = calculateGrossMarginProxy(kpiResult, true);
      if (grossMarginData.after && grossMarginData.before) {
        bestKpiKey = "grossMargin";
        bestLabel = "Gross Margin (proxy)";
        bestDataPoints = {
          after: {
            key: "grossMargin",
            label: bestLabel,
            period: grossMarginData.after.period,
            periodType: "annual",
            value: grossMarginData.after.value,
            unit: grossMarginData.after.unit,
            filedDate: grossMarginData.after.filedDate,
            fiscalYear: 0,
            fiscalPeriod: "FY",
            form: "10-K",
          },
          before: {
            key: "grossMargin",
            label: bestLabel,
            period: grossMarginData.before.period,
            periodType: "annual",
            value: grossMarginData.before.value,
            unit: grossMarginData.before.unit,
            filedDate: grossMarginData.before.filedDate,
            fiscalYear: 0,
            fiscalPeriod: "FY",
            form: "10-K",
          },
        };
        reasoning.push(`Beräknade ${bestLabel} från Revenue och COGS`);
      }
    }
  }

  // Steg 2: Om ingen beräknad margin, prova direkta KPIs med fuzzy matching
  if (!bestDataPoints || !bestDataPoints.after) {
    const kpiKeys = findKpiKeysForPromiseType(promiseType);
    const found = findFirstAvailableKpi(
      kpiResult, 
      kpiKeys, 
      true,
      mapping.fuzzyMatch
    );
    
    if (found) {
      bestKpiKey = found.key;
      bestLabel = found.label;
      bestDataPoints = found.dataPoints;
      reasoning.push(`Hittade KPI "${found.label}" (${found.key})`);
    }
  }

  // Steg 3: Om ingen data hittades, returnera UNRESOLVED
  if (!bestKpiKey || !bestDataPoints || !bestDataPoints.after) {
    const kpiKeys = findKpiKeysForPromiseType(promiseType);
    const triedKeys = kpiKeys.length > 0 ? kpiKeys.join(", ") : "ingen";
    reasoning.push(`Ingen KPI-data hittades för nycklar: ${triedKeys}`);
    
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
      notes: `Relevant KPI saknas i XBRL-data för ${promiseType}. Försökte hitta: ${triedKeys}. Tillgängliga KPIs i data: ${availableKeys || "inga"}.`,
      reasoning,
    };
  }

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

  const { deltaAbs, deltaPct } = calculateDelta(
    bestDataPoints.before.value,
    bestDataPoints.after.value
  );
  comparison.deltaAbs = deltaAbs;
  comparison.deltaPct = deltaPct;
  
  reasoning.push(`Delta: ${deltaAbs.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${bestDataPoints.after.unit} (${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(2)}%)`);

  const isIncreasePositive = KPI_DIRECTION_POSITIVE[bestKpiKey] ?? true;
  const valueIncreased = deltaAbs > 0;
  
  const isCostsPromise = promiseType === "COSTS";
  
  let status: VerificationStatus;
  let statusNote: string;

  if (isCostsPromise) {
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
 * Batch-verifierar flera promises mot KPI-data med logging.
 */
export function verifyMultiplePromises(
  promises: PromiseForVerification[],
  kpiResult: KpiExtractionResult
): Map<number, VerificationResult> {
  console.log(`[verify] Starting batch verification: ${promises.length} promises`);
  
  // Räkna promise types
  const typeCounts: Record<string, number> = {};
  promises.forEach(p => {
    const type = p.type || "UNKNOWN";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  });
  
  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => `${type}:${count}`)
    .join(", ");
  console.log(`[verify] Promise types (top 10): ${topTypes}`);
  
  const results = new Map<number, VerificationResult>();
  let matchedCount = 0;
  const statusCounts = {
    SUPPORTED: 0,
    CONTRADICTED: 0,
    UNRESOLVED: 0,
    PENDING: 0,
  };
  
  for (let i = 0; i < promises.length; i++) {
    const result = verifyPromiseWithKpis(promises[i], kpiResult);
    results.set(i, result);
    
    if (result.kpiUsed) {
      matchedCount++;
    }
    statusCounts[result.status]++;
  }
  
  console.log(`[verify] Verification complete:`);
  console.log(`[verify]   Total promises: ${promises.length}`);
  console.log(`[verify]   Matched KPI: ${matchedCount}`);
  console.log(`[verify]   Result counts: SUPPORTED=${statusCounts.SUPPORTED}, CONTRADICTED=${statusCounts.CONTRADICTED}, UNRESOLVED=${statusCounts.UNRESOLVED}, PENDING=${statusCounts.PENDING}`);
  
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
