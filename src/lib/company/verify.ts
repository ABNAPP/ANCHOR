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

import { ExtractedKpi, KpiExtractionResult, getKpiHistory, NormalizedKpiMap, createNormalizedKpiMap } from "./kpis";
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
 * Infererar promise type från text med keywords (FÖRBÄTTRAD).
 */
function inferPromiseTypeFromText(text: string): PromiseType | null {
  const lower = text.toLowerCase();
  
  // REVENUE keywords (utökad)
  if (lower.match(/\b(revenue|sales|revenues|netsales|top.?line|demand|reseller.?sales|product.?sales)\b/)) {
    return "REVENUE";
  }
  
  // MARGIN keywords (utökad)
  if (lower.match(/\b(margin|gross.?margin|operating.?margin|profitability|profit|earnings)\b/)) {
    return "MARGIN";
  }
  
  // CAPEX keywords (utökad)
  if (lower.match(/\b(capex|capital.?expenditure|invest|investment|spend|build|data.?center|property|plant|equipment|infrastructure|facilities)\b/)) {
    return "CAPEX";
  }
  
  // COSTS keywords (utökad)
  if (lower.match(/\b(cost|expense|efficiency|operating.?expense|cogs|cost.?of.?revenue|savings|headcount|reduce.?costs|lower.?expenses)\b/)) {
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
      // Normalisera promise type
      const normalizedType = normalizePromiseType(promise.type);
      
      // Försök inferera type om OTHER eller om type inte matchar någon KPI
      let promiseType = normalizedType;
      if (normalizedType === "OTHER" || !PROMISE_TYPE_TO_KPI[normalizedType] || PROMISE_TYPE_TO_KPI[normalizedType].primary.length === 0) {
        const inferred = inferPromiseTypeFromText(promise.text);
        if (inferred) {
          promiseType = inferred;
        }
      }
      
      const mapping = PROMISE_TYPE_TO_KPI[promiseType];
      
      if (!mapping || mapping.primary.length === 0) {
        updatedPromises.push(promise);
        continue;
      }

      let bestKpiKey: string | null = null;
      let bestLabel: string = "";
      let bestDataPoints: { before: ExtractedKpi | null; after: ExtractedKpi | null } | null = null;

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
        }
      }

      if (!bestDataPoints || !bestDataPoints.after || !bestDataPoints.before) {
        const kpiKeys = findKpiKeysForPromiseType(promiseType);
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
        } else if (kpiKeys.length === 0 && mapping.fuzzyMatch) {
          // Om inga exakta keys, försök direkt fuzzy match
          const fuzzyMatches = findKpiByFuzzyMatch(kpiResult, mapping.fuzzyMatch);
          if (fuzzyMatches.length > 0) {
            const keyGroups = new Map<string, ExtractedKpi[]>();
            for (const kpi of fuzzyMatches) {
              if (!keyGroups.has(kpi.key)) {
                keyGroups.set(kpi.key, []);
              }
              keyGroups.get(kpi.key)!.push(kpi);
            }
            
            for (const [fuzzyKey, kpis] of keyGroups.entries()) {
              const dataPoints = findKpiDataPoints(kpiResult, fuzzyKey, true);
              if (dataPoints.after && dataPoints.before) {
                const kpiSample = kpis[0];
                bestKpiKey = fuzzyKey;
                bestLabel = kpiSample.label || fuzzyKey;
                bestDataPoints = dataPoints;
                break;
              }
            }
          }
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
 * Normaliserar promise type till uppercase och hanterar edge cases.
 */
function normalizePromiseType(type: string | undefined): PromiseType {
  if (!type) return "OTHER";
  
  const upper = type.toUpperCase();
  
  // Mappa kända varianter
  if (upper === "PRODUCT" || upper === "PRODUCTS") return "PRODUCT";
  if (upper === "MARKET" || upper === "MARKETS") return "MARKET";
  if (upper === "REVENUE" || upper === "REVENUES") return "REVENUE";
  if (upper === "COSTS" || upper === "COST") return "COSTS";
  if (upper === "CAPEX" || upper === "CAPITALEXPENDITURE") return "CAPEX";
  if (upper === "DEBT") return "DEBT";
  if (upper === "MARGIN" || upper === "MARGINS") return "MARGIN";
  if (upper === "STRATEGY" || upper === "STRATEGIC" || upper === "RISK") return "STRATEGY";
  if (upper === "OTHER" || upper === "UNKNOWN") return "OTHER";
  
  // Fallback
  return "OTHER";
}

/**
 * Verifierar en promise mot KPI-data med förbättrad mapping och fuzzy matching.
 */
export function verifyPromiseWithKpis(
  promise: PromiseForVerification,
  kpiResult: KpiExtractionResult
): VerificationResult {
  const reasoning: string[] = [];
  
  // Normalisera promise type (hantera olika casing och varianter)
  let promiseType = normalizePromiseType(promise.type);
  
  // Försök inferera type om OTHER eller om type inte matchar någon KPI
  if (promiseType === "OTHER" || !PROMISE_TYPE_TO_KPI[promiseType] || PROMISE_TYPE_TO_KPI[promiseType].primary.length === 0) {
    const inferred = inferPromiseTypeFromText(promise.text);
    if (inferred) {
      promiseType = inferred;
      reasoning.push(`Infererade promise type: ${inferred} från text (original: ${promise.type})`);
    } else {
      reasoning.push(`Promise type ${promise.type} normaliserad till ${promiseType}, ingen KPI-mapping`);
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
    reasoning.push(`Söker KPI för type ${promiseType}, försöker keys: ${kpiKeys.join(", ") || "ingen"}`);
    
    const found = findFirstAvailableKpi(
      kpiResult, 
      kpiKeys, 
      true,
      mapping.fuzzyMatch
    );
    
    if (found && found.dataPoints.after) {
      bestKpiKey = found.key;
      bestLabel = found.label;
      bestDataPoints = found.dataPoints;
      reasoning.push(`Hittade KPI "${found.label}" (${found.key})`);
    } else if (mapping.fuzzyMatch && mapping.fuzzyMatch.length > 0) {
      // Om inga exakta keys matchade, försök direkt fuzzy match mot alla tillgängliga KPIs
      reasoning.push(`Ingen exakt match, försöker fuzzy match med keywords: ${mapping.fuzzyMatch.join(", ")}`);
      const fuzzyMatches = findKpiByFuzzyMatch(kpiResult, mapping.fuzzyMatch);
      
      if (fuzzyMatches.length > 0) {
        reasoning.push(`Fuzzy match hittade ${fuzzyMatches.length} KPIs`);
        const keyGroups = new Map<string, ExtractedKpi[]>();
        for (const kpi of fuzzyMatches) {
          if (!keyGroups.has(kpi.key)) {
            keyGroups.set(kpi.key, []);
          }
          keyGroups.get(kpi.key)!.push(kpi);
        }
        
        for (const [fuzzyKey, kpis] of keyGroups.entries()) {
          const dataPoints = findKpiDataPoints(kpiResult, fuzzyKey, true);
          if (dataPoints.after && dataPoints.before) {
            const kpiSample = kpis[0];
            bestKpiKey = fuzzyKey;
            bestLabel = kpiSample.label || fuzzyKey;
            bestDataPoints = dataPoints;
            reasoning.push(`Hittade KPI via fuzzy match: "${bestLabel}" (${fuzzyKey})`);
            break;
          } else if (dataPoints.after) {
            // Om vi har after men inte before, använd det ändå (PENDING)
            const kpiSample = kpis[0];
            bestKpiKey = fuzzyKey;
            bestLabel = kpiSample.label || fuzzyKey;
            bestDataPoints = dataPoints;
            reasoning.push(`Hittade KPI via fuzzy match (endast senaste värde): "${bestLabel}" (${fuzzyKey})`);
            break;
          }
        }
      } else {
        reasoning.push(`Fuzzy match hittade inga KPIs`);
      }
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
 * Verifierar promises med normaliserad KPI-map och enklare regler (MVP).
 * Returnerar både VerificationResult och PromiseWithScore med uppdaterad score.
 */
export function verifyPromisesWithNormalizedKpis(
  promises: PromiseForVerification[],
  kpiResult: KpiExtractionResult
): { 
  results: Map<number, VerificationResult>;
  updatedPromises: PromiseWithScore[];
  debugMeta: {
    totalPromises: number;
    promiseTypeCounts: Record<string, number>;
    inferredTypeCounts: Record<string, number>;
    availableKpiKeysSample: string[];
    selectedKpisUsed: string[];
    resultsCounts: { held: number; mixed: number; failed: number; unclear: number };
  };
} {
  console.log(`[verify] Starting verification with normalized KPIs: ${promises.length} promises`);
  
  // Skapa normaliserad KPI-map
  const normalizedMap = createNormalizedKpiMap(kpiResult);
  
  // Logga tillgängliga KPIs
  const availableKpiKeys = Array.from(new Set(kpiResult.kpis.map(k => k.key))).slice(0, 30);
  console.log(`[verify] Available KPI keys (top 30):`, availableKpiKeys);
  
  // Räkna promise types (original och normaliserade)
  const promiseTypeCounts: Record<string, number> = {};
  const inferredTypeCounts: Record<string, number> = {};
  const selectedKpisUsed = new Set<string>();
  const results = new Map<number, VerificationResult>();
  const updatedPromises: PromiseWithScore[] = [];
  
  const resultsCounts = { held: 0, mixed: 0, failed: 0, unclear: 0 };
  
  for (let i = 0; i < promises.length; i++) {
    const promise = promises[i];
    const originalType = promise.type || "UNKNOWN";
    promiseTypeCounts[originalType] = (promiseTypeCounts[originalType] || 0) + 1;
    
    // Normalisera och inferera type
    let promiseType = normalizePromiseType(promise.type);
    if (promiseType === "OTHER" || promiseType === "STRATEGY" || promiseType === "PRODUCT" || promiseType === "MARKET") {
      const inferred = inferPromiseTypeFromText(promise.text);
      if (inferred) {
        promiseType = inferred;
        inferredTypeCounts[inferred] = (inferredTypeCounts[inferred] || 0) + 1;
      }
    }
    
    // Hitta relevant KPI från normaliserad map
    let kpiData: { latest: ExtractedKpi | null; prev: ExtractedKpi | null } | null = null;
    let kpiKey = "";
    let kpiLabel = "";
    
    if (promiseType === "REVENUE") {
      kpiData = normalizedMap.REVENUE;
      kpiKey = "revenue";
      kpiLabel = "Revenue";
    } else if (promiseType === "CAPEX") {
      kpiData = normalizedMap.CAPEX;
      kpiKey = "capex";
      kpiLabel = "CapEx";
    } else if (promiseType === "COSTS") {
      // Försök OPEX först, sedan COGS
      if (normalizedMap.OPEX.latest) {
        kpiData = normalizedMap.OPEX;
        kpiKey = "operatingExpenses";
        kpiLabel = "Operating Expenses";
      } else if (normalizedMap.COGS.latest) {
        kpiData = normalizedMap.COGS;
        kpiKey = "cogs";
        kpiLabel = "Cost of Goods Sold";
      }
    } else if (promiseType === "MARGIN") {
      // Beräkna margin proxy
      if (normalizedMap.REVENUE.latest && normalizedMap.REVENUE.prev && 
          normalizedMap.OPERATING_INCOME.latest && normalizedMap.OPERATING_INCOME.prev) {
        const latestMargin = normalizedMap.OPERATING_INCOME.latest.value / normalizedMap.REVENUE.latest.value;
        const prevMargin = normalizedMap.OPERATING_INCOME.prev.value / normalizedMap.REVENUE.prev.value;
        const marginDelta = latestMargin - prevMargin;
        
        // Skapa syntetiska KPI-objekt för margin
        kpiData = {
          latest: {
            ...normalizedMap.OPERATING_INCOME.latest,
            value: latestMargin,
            key: "operatingMargin",
            label: "Operating Margin",
          },
          prev: {
            ...normalizedMap.OPERATING_INCOME.prev,
            value: prevMargin,
            key: "operatingMargin",
            label: "Operating Margin",
          },
        };
        kpiKey = "operatingMargin";
        kpiLabel = "Operating Margin";
      } else if (normalizedMap.REVENUE.latest && normalizedMap.REVENUE.prev && 
                 normalizedMap.GROSS_PROFIT.latest && normalizedMap.GROSS_PROFIT.prev) {
        const latestMargin = normalizedMap.GROSS_PROFIT.latest.value / normalizedMap.REVENUE.latest.value;
        const prevMargin = normalizedMap.GROSS_PROFIT.prev.value / normalizedMap.REVENUE.prev.value;
        const marginDelta = latestMargin - prevMargin;
        
        kpiData = {
          latest: {
            ...normalizedMap.GROSS_PROFIT.latest,
            value: latestMargin,
            key: "grossMargin",
            label: "Gross Margin",
          },
          prev: {
            ...normalizedMap.GROSS_PROFIT.prev,
            value: prevMargin,
            key: "grossMargin",
            label: "Gross Margin",
          },
        };
        kpiKey = "grossMargin";
        kpiLabel = "Gross Margin";
      }
    }
    
    // Verifiera om vi har KPI-data
    if (!kpiData || !kpiData.latest || !kpiData.prev) {
      const result: VerificationResult = {
        status: "UNRESOLVED",
        confidence: "low",
        kpiUsed: null,
        comparison: { before: null, after: null, deltaAbs: null, deltaPct: null },
        notes: `Relevant KPI saknas för ${promiseType}`,
        reasoning: [`Ingen KPI-data hittades för ${promiseType}`],
      };
      results.set(i, result);
      
      const updatedPromise: PromiseWithScore = {
        ...promise,
        score: {
          score0to100: 0,
          status: "UNCLEAR",
          reasons: [`Ingen KPI-data för ${promiseType}`],
          scoredAt: new Date().toISOString(),
        },
      };
      updatedPromises.push(updatedPromise);
      resultsCounts.unclear++;
      continue;
    }
    
    selectedKpisUsed.add(kpiKey);
    
    // Beräkna delta
    const latest = kpiData.latest.value;
    const prev = kpiData.prev.value;
    const deltaAbs = latest - prev;
    const deltaPct = prev !== 0 ? (deltaAbs / Math.abs(prev)) * 100 : 0;
    
    // Bestäm claim direction från text
    const lowerText = promise.text.toLowerCase();
    const isPositiveClaim = lowerText.match(/\b(increase|growth|improve|expand|grow|raise|higher|more|continue to invest|expect growth)\b/);
    const isCostReduction = lowerText.match(/\b(reduce costs|cost savings|lower expenses|decrease costs|cut costs|efficiency)\b/);
    
    // Bestäm status baserat på regler
    let status: VerificationStatus = "UNRESOLVED";
    let scoreStatus: "HELD" | "MIXED" | "FAILED" | "UNCLEAR" = "UNCLEAR";
    const reasons: string[] = [];
    
    if (promiseType === "REVENUE") {
      if (deltaPct > 2) {
        status = "SUPPORTED";
        scoreStatus = "HELD";
        reasons.push(`Revenue ökade med ${deltaPct.toFixed(2)}%`);
      } else if (deltaPct < -2) {
        status = "CONTRADICTED";
        scoreStatus = "FAILED";
        reasons.push(`Revenue minskade med ${Math.abs(deltaPct).toFixed(2)}%`);
      } else {
        status = "UNRESOLVED";
        scoreStatus = "MIXED";
        reasons.push(`Revenue nästan oförändrad (${deltaPct.toFixed(2)}%)`);
      }
    } else if (promiseType === "CAPEX") {
      if (deltaPct > 2) {
        status = "SUPPORTED";
        scoreStatus = "HELD";
        reasons.push(`CapEx ökade med ${deltaPct.toFixed(2)}% (mer investering)`);
      } else if (deltaPct < -2) {
        status = "CONTRADICTED";
        scoreStatus = "FAILED";
        reasons.push(`CapEx minskade med ${Math.abs(deltaPct).toFixed(2)}%`);
      } else {
        status = "UNRESOLVED";
        scoreStatus = "MIXED";
        reasons.push(`CapEx nästan oförändrad (${deltaPct.toFixed(2)}%)`);
      }
    } else if (promiseType === "COSTS") {
      if (isCostReduction) {
        // För cost reduction: minskning är positivt
        if (deltaPct < -2) {
          status = "SUPPORTED";
          scoreStatus = "HELD";
          reasons.push(`Kostnader minskade med ${Math.abs(deltaPct).toFixed(2)}% (cost savings)`);
        } else if (deltaPct > 2) {
          status = "CONTRADICTED";
          scoreStatus = "FAILED";
          reasons.push(`Kostnader ökade med ${deltaPct.toFixed(2)}% (motsäger cost savings)`);
        } else {
          status = "UNRESOLVED";
          scoreStatus = "MIXED";
          reasons.push(`Kostnader nästan oförändrade (${deltaPct.toFixed(2)}%)`);
        }
      } else {
        // Neutral cost claim
        status = "UNRESOLVED";
        scoreStatus = "MIXED";
        reasons.push(`Kostnader ändrade med ${deltaPct.toFixed(2)}% (neutral claim)`);
      }
    } else if (promiseType === "MARGIN") {
      const marginDelta = latest - prev;
      if (marginDelta > 0.005) {
        status = "SUPPORTED";
        scoreStatus = "HELD";
        reasons.push(`Margin förbättrades med ${(marginDelta * 100).toFixed(2)}pp`);
      } else if (marginDelta < -0.005) {
        status = "CONTRADICTED";
        scoreStatus = "FAILED";
        reasons.push(`Margin försämrades med ${(Math.abs(marginDelta) * 100).toFixed(2)}pp`);
      } else {
        status = "UNRESOLVED";
        scoreStatus = "MIXED";
        reasons.push(`Margin nästan oförändrad (${(marginDelta * 100).toFixed(2)}pp)`);
      }
    }
    
    // Uppdatera resultsCounts
    if (scoreStatus === "HELD") resultsCounts.held++;
    else if (scoreStatus === "MIXED") resultsCounts.mixed++;
    else if (scoreStatus === "FAILED") resultsCounts.failed++;
    else resultsCounts.unclear++;
    
    const result: VerificationResult = {
      status,
      confidence: Math.abs(deltaPct) > 5 ? "high" : Math.abs(deltaPct) > 2 ? "medium" : "low",
      kpiUsed: { key: kpiKey, label: kpiLabel },
      comparison: {
        before: kpiData.prev ? {
          period: kpiData.prev.period,
          value: kpiData.prev.value,
          unit: kpiData.prev.unit,
          filedDate: kpiData.prev.filedDate,
        } : null,
        after: {
          period: kpiData.latest.period,
          value: kpiData.latest.value,
          unit: kpiData.latest.unit,
          filedDate: kpiData.latest.filedDate,
        },
        deltaAbs,
        deltaPct,
      },
      notes: reasons.join("; "),
      reasoning: reasons,
    };
    results.set(i, result);
    
    const updatedPromise: PromiseWithScore = {
      ...promise,
      score: {
        score0to100: scoreStatus === "HELD" ? 80 : scoreStatus === "MIXED" ? 50 : scoreStatus === "FAILED" ? 20 : 0,
        status: scoreStatus,
        reasons,
        scoredAt: new Date().toISOString(),
        verifiedBy: "kpi",
        comparedKpi: { key: kpiKey, label: kpiLabel },
        delta: { abs: deltaAbs, pct: deltaPct },
        verifiedAt: new Date().toISOString(),
      },
    };
    updatedPromises.push(updatedPromise);
  }
  
  console.log(`[verify] Verification complete:`);
  console.log(`[verify]   Total promises: ${promises.length}`);
  console.log(`[verify]   Matched KPI: ${Array.from(selectedKpisUsed).length}`);
  console.log(`[verify]   Result counts: HELD=${resultsCounts.held}, MIXED=${resultsCounts.mixed}, FAILED=${resultsCounts.failed}, UNCLEAR=${resultsCounts.unclear}`);
  
  return {
    results,
    updatedPromises,
    debugMeta: {
      totalPromises: promises.length,
      promiseTypeCounts,
      inferredTypeCounts,
      availableKpiKeysSample: availableKpiKeys,
      selectedKpisUsed: Array.from(selectedKpisUsed),
      resultsCounts,
    },
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
  
  // Räkna promise types (normaliserade)
  const typeCounts: Record<string, number> = {};
  const originalTypeCounts: Record<string, number> = {};
  promises.forEach(p => {
    const originalType = p.type || "UNKNOWN";
    const normalizedType = normalizePromiseType(p.type);
    
    originalTypeCounts[originalType] = (originalTypeCounts[originalType] || 0) + 1;
    typeCounts[normalizedType] = (typeCounts[normalizedType] || 0) + 1;
  });
  
  const topTypes = Object.entries(originalTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => `${type}:${count}`)
    .join(", ");
  console.log(`[verify] Promise types (top 10, original): ${topTypes}`);
  
  const topNormalized = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => `${type}:${count}`)
    .join(", ");
  console.log(`[verify] Promise types (top 10, normalized): ${topNormalized}`);
  
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
