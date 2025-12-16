/**
 * KPI Extraction from SEC XBRL Company Facts
 * 
 * Extraherar standardiserade KPI:er från SEC Company Facts JSON.
 * Stödjer revenue, net income, EPS, cash, debt, och mer.
 */

import { CompanyFactsResponse, FactUnit } from "@/lib/sec/client";

// ============================================
// TYPES
// ============================================

export interface ExtractedKpi {
  key: string;
  label: string;
  period: string;
  periodType: "annual" | "quarterly" | "instant";
  value: number;
  unit: string;
  filedDate: string;
  fiscalYear: number;
  fiscalPeriod: string;
  form: string;
}

export interface KpiExtractionResult {
  cik: string;
  companyName: string;
  asOf: string;
  kpis: ExtractedKpi[];
  summary: {
    totalKpis: number;
    uniqueMetrics: number;
    latestFilingDate: string;
    coverageYears: number[];
  };
}

/**
 * Normaliserad KPI-map för enklare verifiering.
 * Grupperar olika KPI-keys under standardiserade kategorier.
 */
export interface NormalizedKpiMap {
  REVENUE: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  COGS: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  OPEX: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  CAPEX: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  GROSS_PROFIT: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  OPERATING_INCOME: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
}

// ============================================
// KPI DEFINITIONS
// ============================================

interface KpiDefinition {
  key: string;
  label: string;
  tags: string[]; // Prioriterad ordning
  unit: "USD" | "shares" | "USD/share" | "calculated";
  description: string;
}

const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    key: "revenue",
    label: "Revenue",
    tags: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet"],
    unit: "USD",
    description: "Total revenue/sales",
  },
  {
    key: "netSales",
    label: "Net Sales",
    tags: ["SalesRevenueNet", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    unit: "USD",
    description: "Net sales",
  },
  {
    key: "netIncome",
    label: "Net Income",
    tags: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    unit: "USD",
    description: "Net income/loss",
  },
  {
    key: "operatingIncome",
    label: "Operating Income",
    tags: ["OperatingIncomeLoss", "OperatingIncome"],
    unit: "USD",
    description: "Operating income/loss",
  },
  {
    key: "grossProfit",
    label: "Gross Profit",
    tags: ["GrossProfit"],
    unit: "USD",
    description: "Gross profit",
  },
  {
    key: "epsBasic",
    label: "EPS (Basic)",
    tags: ["EarningsPerShareBasic"],
    unit: "USD/share",
    description: "Earnings per share - basic",
  },
  {
    key: "epsDiluted",
    label: "EPS (Diluted)",
    tags: ["EarningsPerShareDiluted"],
    unit: "USD/share",
    description: "Earnings per share - diluted",
  },
  {
    key: "cash",
    label: "Cash & Equivalents",
    tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsAndShortTermInvestments", "Cash"],
    unit: "USD",
    description: "Cash and cash equivalents",
  },
  {
    key: "totalDebt",
    label: "Total Debt",
    tags: ["Debt", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"],
    unit: "USD",
    description: "Total debt",
  },
  {
    key: "longTermDebt",
    label: "Long-Term Debt",
    tags: ["LongTermDebtNoncurrent", "LongTermDebt"],
    unit: "USD",
    description: "Long-term debt",
  },
  {
    key: "sharesOutstanding",
    label: "Shares Outstanding",
    tags: ["CommonStockSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"],
    unit: "shares",
    description: "Common shares outstanding",
  },
  {
    key: "cfo",
    label: "Cash Flow from Operations",
    tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    unit: "USD",
    description: "Operating cash flow",
  },
  {
    key: "capex",
    label: "CapEx",
    tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    unit: "USD",
    description: "Capital expenditures",
  },
  {
    key: "operatingExpenses",
    label: "Operating Expenses",
    tags: ["OperatingExpenses", "CostsAndExpenses", "OperatingCostsAndExpenses"],
    unit: "USD",
    description: "Operating expenses",
  },
  {
    key: "cogs",
    label: "Cost of Goods Sold",
    tags: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfSales"],
    unit: "USD",
    description: "Cost of goods sold / Cost of revenue",
  },
  {
    key: "totalAssets",
    label: "Total Assets",
    tags: ["Assets"],
    unit: "USD",
    description: "Total assets",
  },
  {
    key: "totalLiabilities",
    label: "Total Liabilities",
    tags: ["Liabilities"],
    unit: "USD",
    description: "Total liabilities",
  },
  {
    key: "stockholdersEquity",
    label: "Stockholders Equity",
    tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    unit: "USD",
    description: "Total stockholders equity",
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Hittar fact data för en given tag i us-gaap namespace.
 */
function findFactData(
  facts: CompanyFactsResponse["facts"],
  tags: string[]
): { tag: string; data: FactUnit[] } | null {
  const usGaap = facts["us-gaap"];
  if (!usGaap) return null;

  for (const tag of tags) {
    const factData = usGaap[tag];
    if (factData) {
      // Hitta rätt unit (vanligtvis USD eller shares)
      const units = factData.units;
      const usdUnits = units["USD"] || units["shares"] || units["USD/shares"] || units["pure"];
      
      if (usdUnits && usdUnits.length > 0) {
        return { tag, data: usdUnits };
      }
    }
  }

  return null;
}

/**
 * Bestämmer periodtyp baserat på fiscal period.
 */
function getPeriodType(fp: string): "annual" | "quarterly" | "instant" {
  if (fp === "FY") return "annual";
  if (["Q1", "Q2", "Q3", "Q4"].includes(fp)) return "quarterly";
  return "instant";
}

/**
 * Formaterar period-sträng för visning.
 */
function formatPeriod(unit: FactUnit): string {
  if (unit.fp === "FY") {
    return `FY${unit.fy}`;
  }
  return `${unit.fp} ${unit.fy}`;
}

/**
 * Formaterar värde för visning.
 */
function formatValue(value: number, unitType: string): string {
  if (unitType === "shares") {
    // Visa i miljoner
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    return value.toLocaleString();
  }
  
  if (unitType === "USD/share") {
    return `$${value.toFixed(2)}`;
  }
  
  // USD - visa i miljoner eller miljarder
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${value.toLocaleString()}`;
}

/**
 * Sorterar FactUnits efter datum (nyast först).
 */
function sortByDate(units: FactUnit[]): FactUnit[] {
  return [...units].sort((a, b) => {
    // Primär sortering: filed date (nyast först)
    const filedCompare = b.filed.localeCompare(a.filed);
    if (filedCompare !== 0) return filedCompare;
    
    // Sekundär sortering: end date
    return b.end.localeCompare(a.end);
  });
}

/**
 * Filtrerar till endast 10-K och 10-Q filings.
 */
function filterToRelevantFilings(units: FactUnit[]): FactUnit[] {
  return units.filter(u => u.form === "10-K" || u.form === "10-Q");
}

/**
 * Tar bort duplikater baserat på period.
 */
function deduplicateByPeriod(units: FactUnit[]): FactUnit[] {
  const seen = new Set<string>();
  const result: FactUnit[] = [];
  
  for (const unit of units) {
    const key = `${unit.fy}-${unit.fp}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(unit);
    }
  }
  
  return result;
}

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Extraherar KPI:er från SEC Company Facts JSON.
 * 
 * @param factsJson - Raw JSON från SEC Company Facts API
 * @returns KpiExtractionResult med extraherade KPI:er
 */
export function extractKpisFromCompanyFacts(
  factsJson: CompanyFactsResponse
): KpiExtractionResult {
  console.log("[xbrl] Starting KPI extraction from Company Facts");
  
  const kpis: ExtractedKpi[] = [];
  const coveredYears = new Set<number>();
  let latestFiledDate = "";
  
  // Samla alla faktiska tag-namn från XBRL för logging
  const allAvailableTags: string[] = [];
  const usGaap = factsJson.facts?.["us-gaap"];
  if (usGaap) {
    Object.keys(usGaap).forEach(tag => {
      allAvailableTags.push(tag);
    });
  }
  
  console.log(`[xbrl] Total available XBRL tags: ${allAvailableTags.length}`);
  console.log(`[xbrl] Top 30 XBRL tag keys:`, allAvailableTags.slice(0, 30));

  // Extrahera varje KPI
  for (const def of KPI_DEFINITIONS) {
    const factResult = findFactData(factsJson.facts, def.tags);
    
    if (!factResult) continue;

    // Filtrera och sortera
    let units = filterToRelevantFilings(factResult.data);
    units = sortByDate(units);
    units = deduplicateByPeriod(units);

    if (units.length === 0) continue;

    // Extrahera varje datapunkt
    for (const unit of units) {
      const periodType = getPeriodType(unit.fp);
      const period = formatPeriod(unit);
      
      kpis.push({
        key: def.key,
        label: def.label,
        period,
        periodType,
        value: unit.val,
        unit: def.unit === "USD" ? "USD" : def.unit === "shares" ? "shares" : "USD/share",
        filedDate: unit.filed,
        fiscalYear: unit.fy,
        fiscalPeriod: unit.fp,
        form: unit.form,
      });

      coveredYears.add(unit.fy);
      
      if (unit.filed > latestFiledDate) {
        latestFiledDate = unit.filed;
      }
    }
  }

  // Beräkna Free Cash Flow om CFO och CapEx finns
  const cfoKpis = kpis.filter(k => k.key === "cfo");
  const capexKpis = kpis.filter(k => k.key === "capex");
  
  for (const cfo of cfoKpis) {
    const matchingCapex = capexKpis.find(
      c => c.fiscalYear === cfo.fiscalYear && c.fiscalPeriod === cfo.fiscalPeriod
    );
    
    if (matchingCapex) {
      // FCF = CFO - CapEx (CapEx är vanligtvis negativt redan)
      const fcf = cfo.value - Math.abs(matchingCapex.value);
      
      kpis.push({
        key: "fcf",
        label: "Free Cash Flow",
        period: cfo.period,
        periodType: cfo.periodType,
        value: fcf,
        unit: "USD",
        filedDate: cfo.filedDate,
        fiscalYear: cfo.fiscalYear,
        fiscalPeriod: cfo.fiscalPeriod,
        form: cfo.form,
      });
    }
  }

  // Sortera KPIs: först efter key, sedan efter period (nyast först)
  kpis.sort((a, b) => {
    const keyCompare = a.key.localeCompare(b.key);
    if (keyCompare !== 0) return keyCompare;
    
    // Nyast först
    if (a.fiscalYear !== b.fiscalYear) return b.fiscalYear - a.fiscalYear;
    
    // FY före Q4 före Q3 etc
    const periodOrder: Record<string, number> = { FY: 0, Q4: 1, Q3: 2, Q2: 3, Q1: 4 };
    return (periodOrder[a.fiscalPeriod] ?? 5) - (periodOrder[b.fiscalPeriod] ?? 5);
  });

  // Logga perioder som finns
  const periods = new Set<string>();
  kpis.forEach(k => {
    periods.add(`${k.fiscalYear}-${k.fiscalPeriod}`);
  });
  const sortedPeriods = Array.from(periods).sort().reverse();
  console.log(`[xbrl] Available periods (FY/Q):`, sortedPeriods.slice(0, 10));
  
  // Logga unika KPI-keys som faktiskt extraherades
  const extractedKeys = Array.from(new Set(kpis.map(k => k.key)));
  console.log(`[xbrl] Extracted KPI keys (${extractedKeys.length}):`, extractedKeys);
  console.log(`[xbrl] Total KPI data points: ${kpis.length}`);

  const uniqueMetrics = new Set(kpis.map(k => k.key)).size;
  const coverageYearsArray = Array.from(coveredYears).sort((a, b) => b - a);

  const result: KpiExtractionResult = {
    cik: factsJson.cik?.toString().padStart(10, "0") || "",
    companyName: factsJson.entityName || "",
    asOf: latestFiledDate || new Date().toISOString().split("T")[0],
    kpis,
    summary: {
      totalKpis: kpis.length,
      uniqueMetrics,
      latestFilingDate: latestFiledDate,
      coverageYears: coverageYearsArray,
    },
  };

  console.log(`[xbrl] Extracted KPI keys: ${Array.from(new Set(kpis.map(k => k.key))).join(", ")}`);
  console.log(`[xbrl] Total KPI data points: ${kpis.length}`);

  return result;
}

/**
 * Normaliserad KPI-map för enklare verifiering.
 * Grupperar olika KPI-keys under standardiserade kategorier.
 */
export interface NormalizedKpiMap {
  REVENUE: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  COGS: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  OPEX: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  CAPEX: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  GROSS_PROFIT: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
  OPERATING_INCOME: { latest: ExtractedKpi | null; prev: ExtractedKpi | null };
}

/**
 * Skapar en normaliserad KPI-map från extraherade KPIs.
 * Grupperar olika KPI-keys under standardiserade kategorier och väljer senaste FY.
 */
export function createNormalizedKpiMap(kpiResult: KpiExtractionResult): NormalizedKpiMap {
  const map: NormalizedKpiMap = {
    REVENUE: { latest: null, prev: null },
    COGS: { latest: null, prev: null },
    OPEX: { latest: null, prev: null },
    CAPEX: { latest: null, prev: null },
    GROSS_PROFIT: { latest: null, prev: null },
    OPERATING_INCOME: { latest: null, prev: null },
  };

  // Hjälpfunktion: hitta senaste FY och föregående FY för en KPI-key
  function findLatestAndPrev(kpiKeys: string[]): { latest: ExtractedKpi | null; prev: ExtractedKpi | null } {
    // Hitta alla KPIs som matchar någon av keys
    const matchingKpis = kpiResult.kpis.filter(k => kpiKeys.includes(k.key));
    
    // Filtrera till endast annual (FY) data
    const annualKpis = matchingKpis.filter(k => k.periodType === "annual");
    
    if (annualKpis.length === 0) {
      // Om inga annual, försök med quarterly
      const quarterlyKpis = matchingKpis.filter(k => k.periodType === "quarterly");
      if (quarterlyKpis.length === 0) return { latest: null, prev: null };
      
      // Gruppera efter fiscal year och ta senaste Q4 per år
      const byYear = new Map<number, ExtractedKpi[]>();
      quarterlyKpis.forEach(k => {
        if (!byYear.has(k.fiscalYear)) byYear.set(k.fiscalYear, []);
        byYear.get(k.fiscalYear)!.push(k);
      });
      
      const years = Array.from(byYear.keys()).sort((a, b) => b - a);
      if (years.length === 0) return { latest: null, prev: null };
      
      const latestYear = years[0];
      const latestYearKpis = byYear.get(latestYear)!;
      const latest = latestYearKpis.find(k => k.fiscalPeriod === "Q4") || latestYearKpis[0];
      
      if (years.length > 1) {
        const prevYear = years[1];
        const prevYearKpis = byYear.get(prevYear)!;
        const prev = prevYearKpis.find(k => k.fiscalPeriod === "Q4") || prevYearKpis[0];
        return { latest, prev };
      }
      
      return { latest, prev: null };
    }
    
    // Gruppera efter fiscal year
    const byYear = new Map<number, ExtractedKpi[]>();
    annualKpis.forEach(k => {
      if (!byYear.has(k.fiscalYear)) byYear.set(k.fiscalYear, []);
      byYear.get(k.fiscalYear)!.push(k);
    });
    
    const years = Array.from(byYear.keys()).sort((a, b) => b - a);
    if (years.length === 0) return { latest: null, prev: null };
    
    const latestYear = years[0];
    const latestYearKpis = byYear.get(latestYear)!;
    const latest = latestYearKpis[0]; // Ta första (borde bara finnas en per år för FY)
    
    if (years.length > 1) {
      const prevYear = years[1];
      const prevYearKpis = byYear.get(prevYear)!;
      const prev = prevYearKpis[0];
      return { latest, prev };
    }
    
    return { latest, prev: null };
  }

  // REVENUE: revenue, netSales
  map.REVENUE = findLatestAndPrev(["revenue", "netSales"]);
  
  // COGS: cogs
  map.COGS = findLatestAndPrev(["cogs"]);
  
  // OPEX: operatingExpenses
  map.OPEX = findLatestAndPrev(["operatingExpenses"]);
  
  // CAPEX: capex
  map.CAPEX = findLatestAndPrev(["capex"]);
  
  // GROSS_PROFIT: grossProfit
  map.GROSS_PROFIT = findLatestAndPrev(["grossProfit"]);
  
  // OPERATING_INCOME: operatingIncome
  map.OPERATING_INCOME = findLatestAndPrev(["operatingIncome"]);

  return map;
}

/**
 * Hämtar historik för en specifik KPI.
 */
export function getKpiHistory(
  result: KpiExtractionResult,
  key: string,
  periodType?: "annual" | "quarterly"
): ExtractedKpi[] {
  return result.kpis.filter(k => {
    if (k.key !== key) return false;
    if (periodType && k.periodType !== periodType) return false;
    return true;
  });
}
