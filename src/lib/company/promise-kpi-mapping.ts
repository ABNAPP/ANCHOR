/**
 * Promise-KPI Mapping (MVP)
 * 
 * Centraliserad mapping-modul för att avgöra vilka KPI:er som ska kontrolleras
 * för en given promise.
 * 
 * VIKTIGT:
 * - Denna modul mappar ENDAST promise → KPI-referenser
 * - Mapping verifierar INTE promises
 * - Bulk-verifiering använder mappingens resultat för att hitta relevanta KPI:er
 * 
 * DESIGNPRINCIP:
 * - Statisk MVP-mapping (enkel och stabil)
 * - Fallback till keyword-matchning på promise-text
 * - Om ingen match → returnera tom array (→ "Unclear" status)
 */

import { PromiseType } from "./promises";

// ============================================
// TYPES
// ============================================

export interface PromiseInput {
  type?: PromiseType | string;
  text: string;
}

// ============================================
// STATIC MAPPING: PromiseType → KPI Tags
// ============================================

/**
 * Statisk MVP-mapping: PromiseType → KPI-taggar
 * 
 * KPI-taggarna motsvarar XBRL concept-namn som används i SEC Company Facts.
 * Listan är begränsad och stabil för MVP.
 */
/**
 * Statisk MVP-mapping: PromiseType → KPI-taggar
 * 
 * KPI-taggarna motsvarar XBRL concept-namn som används i SEC Company Facts.
 * Listan är begränsad och stabil för MVP.
 * 
 * NOTE: FCF och EPS finns inte som PromiseType, men mappningen finns här
 * för att kunna hantera dem om de skulle läggas till i framtiden.
 */
const PROMISE_TYPE_TO_KPI_TAGS: Record<string, string[]> = {
  REVENUE: ["Revenues", "SalesRevenueNet", "RevenueGrowth", "RevenueFromContractWithCustomerExcludingAssessedTax"],
  CAPEX: ["CapitalExpenditures", "PaymentsToAcquirePropertyPlantAndEquipment"],
  DEBT: ["LongTermDebt", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligations"],
  COSTS: ["OperatingExpenses", "CostOfRevenue", "CostOfGoodsAndServicesSold"],
  MARGIN: ["GrossProfit", "OperatingIncomeLoss", "IncomeFromOperations"],
  // FCF och EPS finns inte som PromiseType, men kan användas för keyword-matchning
  FCF: ["FreeCashFlow", "NetCashProvidedByUsedInOperatingActivities"],
  EPS: ["EarningsPerShareBasic", "EarningsPerShareDiluted"],
};

// ============================================
// KEYWORD MAPPING: Text → PromiseType
// ============================================

/**
 * Enkel keyword-matchning för att inferera promise-typ från text.
 * Används som fallback när promise.type saknas eller är "OTHER".
 */
function inferPromiseTypeFromText(text: string): PromiseType | null {
  const lowerText = text.toLowerCase();
  
  // Revenue keywords
  if (lowerText.match(/\b(revenue|sales|netsales|reseller sales|demand|top.?line|product.?sales)\b/)) {
    return "REVENUE";
  }
  
  // Margin keywords
  if (lowerText.match(/\b(margin|profit|profitability|gross margin|operating margin|earnings)\b/)) {
    return "MARGIN";
  }
  
  // CapEx keywords
  if (lowerText.match(/\b(capex|capital expenditure|invest|investment|spend|build|data center|property|plant|equipment|infrastructure)\b/)) {
    return "CAPEX";
  }
  
  // Costs keywords
  if (lowerText.match(/\b(cost|expense|efficiency|savings|headcount|operating expense|cogs|cost.?of.?revenue)\b/)) {
    return "COSTS";
  }
  
  // Debt keywords
  if (lowerText.match(/\b(debt|borrowing|loan|leverage|liability)\b/)) {
    return "DEBT";
  }
  
  // FCF keywords - mappas till OTHER eftersom FCF inte är en PromiseType
  // (användaren kan ändå matcha mot FCF-KPI:er via mapping)
  
  // EPS keywords - mappas till OTHER eftersom EPS inte är en PromiseType
  // (användaren kan ändå matcha mot EPS-KPI:er via mapping)
  
  return null;
}

// ============================================
// MAIN: GET KPI REFS FOR PROMISE
// ============================================

/**
 * Hämta KPI-referenser för en promise.
 * 
 * @param promise - Promise med type (optional) och text
 * @returns Array av KPI-taggar som ska kontrolleras, eller tom array om ingen match
 * 
 * LOGIK:
 * 1. Om promise.type finns och matchar mapping → returnera KPI-lista
 * 2. Annars: inferera type från text via keyword-matchning
 * 3. Om infererad type matchar mapping → returnera KPI-lista
 * 4. Om ingen match → returnera tom array (→ "Unclear" status)
 */
export function getKpiRefsForPromise(promise: PromiseInput): string[] {
  // 1. Om promise.type finns och matchar mapping
  if (promise.type && PROMISE_TYPE_TO_KPI_TAGS[promise.type]) {
    return PROMISE_TYPE_TO_KPI_TAGS[promise.type];
  }
  
  // 2. Inferera type från text
  const inferredType = inferPromiseTypeFromText(promise.text);
  
  if (inferredType && PROMISE_TYPE_TO_KPI_TAGS[inferredType]) {
    return PROMISE_TYPE_TO_KPI_TAGS[inferredType];
  }
  
  // 3. Ingen match → returnera tom array
  return [];
}

/**
 * Hämta promise-typ för en promise (från type eller infererad från text).
 * 
 * @param promise - Promise med type (optional) och text
 * @returns PromiseType eller null om ingen match
 */
/**
 * Hämta promise-typ för en promise (från type eller infererad från text).
 * 
 * @param promise - Promise med type (optional) och text
 * @returns PromiseType eller null om ingen match
 * 
 * NOTE: Returnerar endast giltiga PromiseType-värden.
 * Om infererad type är FCF/EPS (som inte är PromiseType), returnerar null.
 */
export function getPromiseType(promise: PromiseInput): PromiseType | null {
  // Om type finns och är giltig PromiseType
  if (promise.type && PROMISE_TYPE_TO_KPI_TAGS[promise.type]) {
    // Kontrollera att det är en giltig PromiseType (inte FCF/EPS)
    const validTypes: PromiseType[] = ["REVENUE", "MARGIN", "COSTS", "CAPEX", "DEBT", "STRATEGY", "PRODUCT", "MARKET", "OTHER"];
    if (validTypes.includes(promise.type as PromiseType)) {
      return promise.type as PromiseType;
    }
  }
  
  // Inferera från text (returnerar endast giltiga PromiseType)
  const inferred = inferPromiseTypeFromText(promise.text);
  if (inferred && ["REVENUE", "MARGIN", "COSTS", "CAPEX", "DEBT"].includes(inferred)) {
    return inferred as PromiseType;
  }
  
  return null;
}

