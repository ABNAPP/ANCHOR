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
  const kpis: ExtractedKpi[] = [];
  const coveredYears = new Set<number>();
  let latestFiledDate = "";

  // Extrahera varje KPI
  for (const def of KPI_DEFINITIONS) {
    const factResult = findFactData(factsJson.facts, def.tags);
    
    if (!factResult) continue;

    // Filtrera och sortera
    let units = filterToRelevantFilings(factResult.data);
    units = sortByDate(units);
    units = deduplicateByPeriod(units);

    // Ta max 8 perioder per KPI (senaste 2 år kvartal + årliga)
    const limitedUnits = units.slice(0, 8);

    for (const unit of limitedUnits) {
      kpis.push({
        key: def.key,
        label: def.label,
        period: formatPeriod(unit),
        periodType: getPeriodType(unit.fp),
        value: unit.val,
        unit: def.unit,
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

  // Begränsa till max 50 KPIs
  const limitedKpis = kpis.slice(0, 50);

  // Beräkna unika metrics
  const uniqueMetrics = new Set(limitedKpis.map(k => k.key)).size;

  return {
    cik: factsJson.cik.toString().padStart(10, "0"),
    companyName: factsJson.entityName,
    asOf: new Date().toISOString().split("T")[0],
    kpis: limitedKpis,
    summary: {
      totalKpis: limitedKpis.length,
      uniqueMetrics,
      latestFilingDate: latestFiledDate,
      coverageYears: Array.from(coveredYears).sort((a, b) => b - a),
    },
  };
}

/**
 * Hämtar senaste värde för en specifik KPI.
 */
export function getLatestKpiValue(
  result: KpiExtractionResult,
  key: string,
  periodType?: "annual" | "quarterly"
): ExtractedKpi | null {
  const filtered = result.kpis.filter(k => {
    if (k.key !== key) return false;
    if (periodType && k.periodType !== periodType) return false;
    return true;
  });
  
  if (filtered.length === 0) return null;
  
  // Redan sorterad nyast först
  return filtered[0];
}

/**
 * Formaterar KPI-värde för visning.
 */
export function formatKpiValue(kpi: ExtractedKpi): string {
  return formatValue(kpi.value, kpi.unit);
}

/**
 * Hämtar KPI-historik för en specifik metric.
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

