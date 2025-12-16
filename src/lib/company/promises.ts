/**
 * Promise Extraction V2 (Rule-Based) - Improved Filtering
 * 
 * Extraherar framåtblickande uttalanden (promises/claims) från SEC filings.
 * Klassificerar med type, timeHorizon, measurable och confidence.
 * 
 * Förbättringar:
 * - Kräver framtidstriggers för att acceptera meningar
 * - Filtrerar bort historiska fakta och redovisningstext
 * - Förbättrad längd- och kvalitetskontroll
 */

// ============================================
// TYPES
// ============================================

export type PromiseType =
  | "REVENUE"
  | "MARGIN"
  | "COSTS"
  | "CAPEX"
  | "DEBT"
  | "STRATEGY"
  | "PRODUCT"
  | "MARKET"
  | "OTHER";

export type TimeHorizon =
  | "NEXT_Q"
  | "FY1"
  | "FY2PLUS"
  | "LONG_TERM"
  | "UNSPECIFIED";

export type Confidence = "high" | "medium" | "low";

export interface ExtractedPromise {
  text: string;
  type: PromiseType;
  timeHorizon: TimeHorizon;
  measurable: boolean;
  confidence: Confidence;
  confidenceScore: number; // 0-100 för sortering
  keywords: string[];
  source: string;
}

export interface PromiseExtractionResult {
  promises: ExtractedPromise[];
  totalSentences: number;
  extractedCount: number;
  summary: {
    byType: Record<PromiseType, number>;
    byTimeHorizon: Record<TimeHorizon, number>;
    byConfidence: Record<Confidence, number>;
    measurableCount: number;
  };
}

export interface ExtractionMeta {
  source: string;
  formType: string;
  companyName?: string;
  ticker?: string;
}

// ============================================
// CONSTANTS - TRIGGER WORDS (REQUIRED)
// ============================================

/**
 * Framtidstriggers som MÅSTE finnas för att en mening ska accepteras som promise.
 */
const REQUIRED_FORWARD_LOOKING_TRIGGERS = [
  "will",
  "expect",
  "expects",
  "expected",
  "expecting",
  "plan",
  "plans",
  "planned",
  "planning",
  "aim",
  "aims",
  "aiming",
  "target",
  "targets",
  "targeting",
  "intend",
  "intends",
  "intended",
  "intending",
  "outlook",
  "guidance",
  "committed",
  "commit",
  "continue to",
  "continues to",
  "continuing to",
  "anticipate",
  "anticipates",
  "anticipated",
  "project",
  "projects",
  "projected",
  "forecast",
  "forecasts",
  "forecasted",
  "we believe",
  "believes",
  "believe",
  "estimate",
  "estimates",
  "estimated",
  "goal",
  "goals",
  "objective",
  "objectives",
  "strategy",
  "strategic",
  "initiative",
  "initiatives",
  "priority",
  "priorities",
  "focus on",
  "focused on",
];

// Vaga ord som sänker confidence
const HEDGE_WORDS = [
  "may",
  "might",
  "could",
  "would",
  "should",
  "possibly",
  "potentially",
  "approximately",
  "roughly",
  "around",
  "about",
  "uncertain",
  "subject to",
  "depending on",
  "if",
];

// ============================================
// NEGATIVE FILTERS - Historiska/Redovisningstext
// ============================================

/**
 * Mönster som indikerar historisk/redovisningstext som ska filtreras bort.
 */
const HISTORICAL_START_PATTERNS = [
  /^the following table shows/i,
  /^we recorded/i,
  /^net income was/i,
  /^total assets/i,
  /^the company reported/i,
  /^revenue was/i,
  /^revenues were/i,
  /^we reported/i,
  /^during the (period|quarter|year|fiscal)/i,
  /^for the (period|quarter|year|fiscal)/i,
  /^in the (period|quarter|year|fiscal)/i,
  /^compared to the/i,
  /^compared with the/i,
  /^as compared to/i,
  /^as compared with/i,
];

/**
 * Historiska verb som indikerar att texten handlar om det förflutna.
 */
const HISTORICAL_VERB_PATTERNS = [
  /\bwas\b/i,
  /\bwere\b/i,
  /\bended\b/i,
  /\bincreased during\b/i,
  /\bdecreased during\b/i,
  /\boccurred\b/i,
  /\bhappened\b/i,
  /\btook place\b/i,
  /\bresulted in\b/i,
  /\bamounted to\b/i,
  /\bconsisted of\b/i,
];

/**
 * Kontrollerar om meningen är uppenbart historisk (trots framtidstrigger).
 */
function isHistoricalStatement(sentence: string): boolean {
  const lowerSentence = sentence.toLowerCase().trim();
  
  // Kolla start-mönster
  for (const pattern of HISTORICAL_START_PATTERNS) {
    if (pattern.test(lowerSentence)) {
      return true;
    }
  }
  
  // Kolla om meningen har historiska verb UTAN framtidsord nära början
  let hasHistoricalVerb = false;
  for (const pattern of HISTORICAL_VERB_PATTERNS) {
    if (pattern.test(lowerSentence)) {
      hasHistoricalVerb = true;
      break;
    }
  }
  
  if (hasHistoricalVerb) {
    // Om meningen börjar med historiskt verb eller har det nära början, filtrera bort
    const firstWords = lowerSentence.split(/\s+/).slice(0, 5).join(" ");
    for (const pattern of HISTORICAL_VERB_PATTERNS) {
      if (pattern.test(firstWords)) {
        // Om framtidsordet kommer EFTER det historiska verbet, filtrera bort
        const triggerIndex = lowerSentence.search(/\b(will|expect|plan|aim|target|intend|guidance|outlook|anticipate|we believe)\b/i);
        const verbMatch = firstWords.match(/\b(was|were|ended|occurred)\b/i);
        if (verbMatch && (triggerIndex === -1 || triggerIndex > 50)) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Kontrollerar om meningen har många siffror men saknar framtidsord.
 */
function hasNumbersButNoFuture(sentence: string): boolean {
  // Räkna siffror (inklusive procent och valuta)
  const numberMatches = sentence.match(/\d+(\.\d+)?/g);
  const numberCount = numberMatches ? numberMatches.length : 0;
  
  // Om det finns 3+ siffror, kontrollera att det finns framtidsord
  if (numberCount >= 3) {
    const hasFutureTrigger = REQUIRED_FORWARD_LOOKING_TRIGGERS.some((trigger) => {
      const pattern = new RegExp(`\\b${trigger.replace(/\s+/g, "\\s+")}\\b`, "i");
      return pattern.test(sentence);
    });
    
    if (!hasFutureTrigger) {
      return true;
    }
  }
  
  return false;
}

// ============================================
// TYPE CLASSIFICATION RULES
// ============================================

const TYPE_KEYWORDS: Record<PromiseType, string[]> = {
  REVENUE: [
    "revenue",
    "revenues",
    "sales",
    "demand",
    "growth",
    "top line",
    "top-line",
    "market share",
    "pricing",
    "volume",
    "orders",
    "bookings",
    "backlog",
  ],
  MARGIN: [
    "margin",
    "margins",
    "gross margin",
    "operating margin",
    "net margin",
    "profitability",
    "profit margin",
    "ebitda margin",
    "gross profit",
  ],
  COSTS: [
    "cost",
    "costs",
    "expense",
    "expenses",
    "opex",
    "operating expenses",
    "efficiency",
    "efficiencies",
    "restructuring",
    "savings",
    "cost reduction",
    "cost cutting",
    "headcount",
    "workforce",
  ],
  CAPEX: [
    "capex",
    "capital expenditure",
    "capital expenditures",
    "investment",
    "investments",
    "investing",
    "capacity",
    "expansion",
    "expanding",
    "facility",
    "facilities",
    "infrastructure",
    "r&d",
    "research and development",
  ],
  DEBT: [
    "debt",
    "leverage",
    "deleveraging",
    "deleverage",
    "balance sheet",
    "liquidity",
    "cash flow",
    "cash flows",
    "free cash flow",
    "dividend",
    "dividends",
    "buyback",
    "repurchase",
    "capital return",
    "capital allocation",
  ],
  STRATEGY: [
    "strategy",
    "strategic",
    "focus",
    "prioritize",
    "prioritizing",
    "roadmap",
    "transformation",
    "transforming",
    "pivot",
    "pivoting",
    "transition",
    "transitioning",
    "realign",
    "realignment",
    "repositioning",
  ],
  PRODUCT: [
    "product",
    "products",
    "launch",
    "launching",
    "release",
    "releasing",
    "innovation",
    "innovations",
    "pipeline",
    "development",
    "developing",
    "new features",
    "platform",
  ],
  MARKET: [
    "market",
    "markets",
    "geographic",
    "geography",
    "international",
    "domestic",
    "segment",
    "segments",
    "customer",
    "customers",
    "channel",
    "channels",
    "distribution",
  ],
  OTHER: [],
};

// ============================================
// TIME HORIZON RULES
// ============================================

const TIME_PATTERNS: { pattern: RegExp; horizon: TimeHorizon }[] = [
  // NEXT_Q patterns
  { pattern: /next quarter/i, horizon: "NEXT_Q" },
  { pattern: /this quarter/i, horizon: "NEXT_Q" },
  { pattern: /Q[1-4]\s*202[4-9]/i, horizon: "NEXT_Q" },
  { pattern: /first quarter|second quarter|third quarter|fourth quarter/i, horizon: "NEXT_Q" },
  { pattern: /current quarter/i, horizon: "NEXT_Q" },
  
  // FY1 patterns (current/next fiscal year)
  { pattern: /next year/i, horizon: "FY1" },
  { pattern: /this year/i, horizon: "FY1" },
  { pattern: /fiscal (year )?202[5-6]/i, horizon: "FY1" },
  { pattern: /FY\s*202[5-6]/i, horizon: "FY1" },
  { pattern: /in 202[5-6]/i, horizon: "FY1" },
  { pattern: /calendar (year )?202[5-6]/i, horizon: "FY1" },
  { pattern: /full year/i, horizon: "FY1" },
  { pattern: /annual/i, horizon: "FY1" },
  
  // FY2PLUS patterns
  { pattern: /202[7-9]/i, horizon: "FY2PLUS" },
  { pattern: /203\d/i, horizon: "FY2PLUS" },
  { pattern: /over the next (several|few|two|three|2|3) years/i, horizon: "FY2PLUS" },
  { pattern: /next (several|few|two|three|2|3) years/i, horizon: "FY2PLUS" },
  { pattern: /medium[- ]term/i, horizon: "FY2PLUS" },
  
  // LONG_TERM patterns
  { pattern: /long[- ]term/i, horizon: "LONG_TERM" },
  { pattern: /over time/i, horizon: "LONG_TERM" },
  { pattern: /multi[- ]year/i, horizon: "LONG_TERM" },
  { pattern: /sustainable/i, horizon: "LONG_TERM" },
  { pattern: /ongoing/i, horizon: "LONG_TERM" },
  { pattern: /continue to/i, horizon: "LONG_TERM" },
];

// ============================================
// MEASURABLE DETECTION
// ============================================

const MEASURABLE_PATTERNS = [
  /\d+(\.\d+)?%/,                           // Procent
  /\$\d+/,                                   // Dollar belopp
  /\d+\s*(million|billion|M|B|mn|bn)/i,      // Belopp i miljoner/miljarder
  /increase(d|s)?\s*(by|of)\s*\d+/i,         // "increase by X"
  /decrease(d|s)?\s*(by|of)\s*\d+/i,         // "decrease by X"
  /grow(th|ing|s)?\s*(of|by)\s*\d+/i,        // "growth of X"
  /\d+\s*basis\s*points?/i,                  // basis points
  /\d+x/i,                                    // multipliers
  /double|triple|quadruple/i,                 // multipliers
  /revenue of \$/i,
  /margin(s)? of \d+/i,
  /target(ing)? \d+/i,
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Splittar text i meningar med förbättrad hantering.
 */
function splitIntoSentences(text: string): string[] {
  // Split på . ! ? följt av mellanslag och stor bokstav
  const sentences = text
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20); // Minst 20 tecken

  return sentences;
}

/**
 * Delar upp långa meningar i kortare delar.
 */
function splitLongSentence(sentence: string, maxLength: number = 500): string[] {
  if (sentence.length <= maxLength) {
    return [sentence];
  }
  
  // Försök dela på semikolon, komma, eller "and"/"or"
  const parts: string[] = [];
  const splitPattern = /[;,]|(?:\s+and\s+)|(?:\s+or\s+)/i;
  
  let currentPart = sentence;
  
  while (currentPart.length > maxLength) {
    // Hitta bästa delningspunkt (närmast maxLength)
    let bestSplitIndex = -1;
    const matches = Array.from(currentPart.matchAll(new RegExp(splitPattern.source, "g")));
    
    for (const match of matches) {
      const index = match.index!;
      if (index > maxLength * 0.7 && index < maxLength) {
        bestSplitIndex = index;
        break;
      }
      if (bestSplitIndex === -1 && index < maxLength) {
        bestSplitIndex = index;
      }
    }
    
    if (bestSplitIndex === -1) {
      // Ingen bra delningspunkt, ta första delen
      parts.push(currentPart.substring(0, maxLength));
      currentPart = currentPart.substring(maxLength).trim();
    } else {
      // Dela vid bästa punkt
      const delimiter = currentPart[bestSplitIndex];
      parts.push(currentPart.substring(0, bestSplitIndex).trim());
      currentPart = currentPart.substring(bestSplitIndex + delimiter.length).trim();
    }
  }
  
  if (currentPart.length > 0) {
    parts.push(currentPart);
  }
  
  return parts.filter((p) => p.length > 20);
}

/**
 * Kontrollerar om en mening innehåller REQUIRED forward-looking triggers.
 */
function hasForwardLookingTrigger(sentence: string): string[] {
  const lowerSentence = sentence.toLowerCase();
  const foundTriggers: string[] = [];

  for (const trigger of REQUIRED_FORWARD_LOOKING_TRIGGERS) {
    // Hantera multi-word triggers (t.ex. "we believe", "continue to")
    if (trigger.includes(" ")) {
      if (lowerSentence.includes(trigger.toLowerCase())) {
        foundTriggers.push(trigger);
      }
    } else {
      // Använd word boundary för att matcha hela ord
      const pattern = new RegExp(`\\b${trigger}\\b`, "i");
      if (pattern.test(lowerSentence)) {
        foundTriggers.push(trigger);
      }
    }
  }

  return foundTriggers;
}

/**
 * Klassificerar promise type baserat på keywords.
 */
function classifyType(sentence: string): PromiseType {
  const lowerSentence = sentence.toLowerCase();
  const scores: Record<PromiseType, number> = {
    REVENUE: 0,
    MARGIN: 0,
    COSTS: 0,
    CAPEX: 0,
    DEBT: 0,
    STRATEGY: 0,
    PRODUCT: 0,
    MARKET: 0,
    OTHER: 0,
  };

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS) as [PromiseType, string[]][]) {
    for (const keyword of keywords) {
      if (lowerSentence.includes(keyword.toLowerCase())) {
        scores[type]++;
      }
    }
  }

  // Hitta typ med högst score
  let maxScore = 0;
  let maxType: PromiseType = "OTHER";
  for (const [type, score] of Object.entries(scores) as [PromiseType, number][]) {
    if (score > maxScore) {
      maxScore = score;
      maxType = type;
    }
  }

  return maxType;
}

/**
 * Bestämmer tidshorisont baserat på patterns.
 */
function classifyTimeHorizon(sentence: string): TimeHorizon {
  for (const { pattern, horizon } of TIME_PATTERNS) {
    if (pattern.test(sentence)) {
      return horizon;
    }
  }
  return "UNSPECIFIED";
}

/**
 * Kontrollerar om meningen är mätbar (innehåller specifika siffror/KPIs).
 */
function isMeasurable(sentence: string): boolean {
  return MEASURABLE_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Beräknar confidence score (0-100).
 */
function calculateConfidence(
  sentence: string,
  timeHorizon: TimeHorizon,
  measurable: boolean,
  triggers: string[]
): { confidence: Confidence; score: number } {
  let score = 50; // Baspoäng

  // Bonus för mätbarhet
  if (measurable) {
    score += 20;
  }

  // Bonus för specifik tidshorisont
  if (timeHorizon === "NEXT_Q") {
    score += 15;
  } else if (timeHorizon === "FY1") {
    score += 10;
  } else if (timeHorizon === "FY2PLUS" || timeHorizon === "LONG_TERM") {
    score += 5;
  }
  // UNSPECIFIED ger ingen bonus

  // Bonus för starka triggers
  const strongTriggers = ["will", "expect", "target", "committed", "guidance"];
  const hasStrongTrigger = triggers.some((t) =>
    strongTriggers.some((st) => t.includes(st))
  );
  if (hasStrongTrigger) {
    score += 10;
  }

  // Avdrag för hedge words
  const lowerSentence = sentence.toLowerCase();
  for (const hedge of HEDGE_WORDS) {
    if (lowerSentence.includes(hedge)) {
      score -= 10;
      break; // Max ett avdrag
    }
  }

  // Säkerställ att score är inom 0-100
  score = Math.max(0, Math.min(100, score));

  // Konvertera till confidence level
  let confidence: Confidence;
  if (score >= 70) {
    confidence = "high";
  } else if (score >= 45) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return { confidence, score };
}

/**
 * Hittar matchade keywords i meningen för debugging/display.
 */
function findMatchedKeywords(sentence: string): string[] {
  const lowerSentence = sentence.toLowerCase();
  const matched: string[] = [];

  // Kolla alla type keywords
  for (const keywords of Object.values(TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerSentence.includes(keyword.toLowerCase()) && !matched.includes(keyword)) {
        matched.push(keyword);
      }
    }
  }

  // Lägg till triggers
  for (const trigger of REQUIRED_FORWARD_LOOKING_TRIGGERS) {
    const pattern = trigger.includes(" ")
      ? new RegExp(trigger.replace(/\s+/g, "\\s+"), "i")
      : new RegExp(`\\b${trigger}\\b`, "i");
    if (pattern.test(lowerSentence) && !matched.includes(trigger)) {
      matched.push(trigger);
    }
  }

  return matched.slice(0, 5); // Max 5 keywords
}

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

/**
 * Extraherar promises från text med förbättrad filtrering.
 * 
 * Förbättringar:
 * - KRÄVER framtidstriggers för att acceptera meningar
 * - Filtrerar bort historiska/redovisningstext
 * - Begränsar längd till 400-600 tecken
 * - Filtrerar bort låg confidence promises
 * 
 * @param text - Text att analysera (helst MD&A sektion)
 * @param meta - Metadata om filing
 * @returns PromiseExtractionResult med klassificerade promises
 */
export function extractPromises(
  text: string,
  meta: ExtractionMeta
): PromiseExtractionResult {
  const sentences = splitIntoSentences(text);
  const promises: ExtractedPromise[] = [];

  // Minimum confidence score för att behålla promise (30 = låg tröskel)
  const MIN_CONFIDENCE_SCORE = 30;

  for (let originalSentence of sentences) {
    // Steg 1: Dela upp långa meningar (max 500 tecken)
    const sentenceParts = splitLongSentence(originalSentence, 500);
    
    for (let sentence of sentenceParts) {
      // Trim och validera längd (min 20, max 600 tecken)
      sentence = sentence.trim();
      if (sentence.length < 20 || sentence.length > 600) {
        continue;
      }

      // Steg 2: KRÄV framtidstrigger (del 1)
      const triggers = hasForwardLookingTrigger(sentence);
      if (triggers.length === 0) {
        continue; // Hoppa över om ingen framtidstrigger
      }

      // Steg 3: Negative filters (del 2)
      if (isHistoricalStatement(sentence)) {
        continue; // Filtrera bort historiska statements
      }

      if (hasNumbersButNoFuture(sentence)) {
        continue; // Filtrera bort siffror utan framtidsord
      }

      // Steg 4: Klassificera
      const type = classifyType(sentence);
      const timeHorizon = classifyTimeHorizon(sentence);
      const measurable = isMeasurable(sentence);
      const { confidence, score } = calculateConfidence(
        sentence,
        timeHorizon,
        measurable,
        triggers
      );

      // Steg 5: Filtrera bort låg confidence (del 3)
      if (score < MIN_CONFIDENCE_SCORE) {
        continue;
      }

      // Steg 6: Skapa promise objekt
      const promise: ExtractedPromise = {
        text: sentence,
        type,
        timeHorizon,
        measurable,
        confidence,
        confidenceScore: score,
        keywords: findMatchedKeywords(sentence),
        source: meta.source,
      };

      promises.push(promise);
    }
  }

  // Steg 7: Sortera efter confidence score (högst först)
  promises.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Steg 8: Begränsa till max 50 promises (behåll bästa)
  const limitedPromises = promises.slice(0, 50);

  // Steg 9: Beräkna summary
  const summary = calculateSummary(limitedPromises);

  return {
    promises: limitedPromises,
    totalSentences: sentences.length,
    extractedCount: limitedPromises.length,
    summary,
  };
}

/**
 * Beräknar summary-statistik för extraherade promises.
 */
function calculateSummary(promises: ExtractedPromise[]): PromiseExtractionResult["summary"] {
  const byType: Record<PromiseType, number> = {
    REVENUE: 0,
    MARGIN: 0,
    COSTS: 0,
    CAPEX: 0,
    DEBT: 0,
    STRATEGY: 0,
    PRODUCT: 0,
    MARKET: 0,
    OTHER: 0,
  };

  const byTimeHorizon: Record<TimeHorizon, number> = {
    NEXT_Q: 0,
    FY1: 0,
    FY2PLUS: 0,
    LONG_TERM: 0,
    UNSPECIFIED: 0,
  };

  const byConfidence: Record<Confidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  let measurableCount = 0;

  for (const promise of promises) {
    byType[promise.type]++;
    byTimeHorizon[promise.timeHorizon]++;
    byConfidence[promise.confidence]++;
    if (promise.measurable) {
      measurableCount++;
    }
  }

  return {
    byType,
    byTimeHorizon,
    byConfidence,
    measurableCount,
  };
}
