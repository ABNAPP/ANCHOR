/**
 * Company Promises Extraction
 * 
 * Extraherar "promises" och "claims" från SEC filings.
 * MVP: Regelbaserad extraction utan ML.
 */

import { FilingSection, splitIntoSentences } from "../sec/parse";

// ============================================
// TYPES
// ============================================

export interface ExtractedPromise {
  text: string;
  category: PromiseCategory;
  confidence: "high" | "medium" | "low";
  source: string;
  keywords: string[];
}

export type PromiseCategory = 
  | "guidance" 
  | "growth" 
  | "strategy" 
  | "investment" 
  | "risk_mitigation"
  | "operational"
  | "financial"
  | "product"
  | "market"
  | "other";

export interface PromiseExtractionResult {
  totalSentences: number;
  extractedCount: number;
  promises: ExtractedPromise[];
  summary: {
    byCategory: Record<PromiseCategory, number>;
    byConfidence: Record<string, number>;
  };
}

// ============================================
// PATTERNS
// ============================================

const FORWARD_LOOKING_PATTERNS: RegExp[] = [
  /\bwe\s+(expect|anticipate|believe|plan|intend|aim|project|forecast|estimate)\b/i,
  /\bmanagement\s+(expects|anticipates|believes|plans|intends)\b/i,
  /\bthe\s+company\s+(expects|anticipates|believes|plans|intends|will)\b/i,
  /\bwe\s+will\s+(continue|focus|invest|expand|launch|develop|grow|increase|improve)\b/i,
  /\bgoing\s+forward\b/i,
  /\bin\s+the\s+(coming|next|future|following)\s+(year|quarter|months?|period)\b/i,
  /\bour\s+(goal|objective|target|strategy)\s+is\b/i,
  /\bwe\s+are\s+(committed|focused|positioned)\b/i,
  /\bis\s+expected\s+to\b/i,
  /\bwe\s+remain\s+(confident|optimistic|committed)\b/i,
];

const GUIDANCE_PATTERNS: RegExp[] = [
  /\b(revenue|sales)\s+(guidance|outlook|forecast)\b/i,
  /\beps\s+(guidance|outlook|forecast)\b/i,
  /\b(full[- ]?year|quarterly|annual)\s+(guidance|outlook)\b/i,
  /\bexpect\s+(revenue|earnings|growth)\s+(to|of)\b/i,
];

const GROWTH_PATTERNS: RegExp[] = [
  /\b(revenue|sales|earnings)\s+growth\s+of\b/i,
  /\bgrow\s+(revenue|earnings|sales)\s+by\b/i,
  /\bexpand\s+(margins?|operations?|presence)\b/i,
  /\bincrease\s+(market\s+share|capacity|production)\b/i,
  /\bdouble[- ]digit\s+growth\b/i,
];

const STRATEGY_PATTERNS: RegExp[] = [
  /\bstrategic\s+(initiative|priority|plan|focus)\b/i,
  /\bour\s+strategy\s+(is|involves|focuses)\b/i,
  /\bkey\s+(initiative|priority|pillar)\b/i,
  /\btransform(ation|ing)\b/i,
];

const INVESTMENT_PATTERNS: RegExp[] = [
  /\binvest(ing|ment)?\s+(in|into)\b/i,
  /\bcapital\s+(expenditure|investment|allocation)\b/i,
  /\br&d\s+(investment|spending|expenditure)\b/i,
  /\bacquisition\s+(strategy|pipeline|opportunities)\b/i,
];

const PRODUCT_PATTERNS: RegExp[] = [
  /\blaunch(ing)?\s+(new|our|a)\s+(product|service|platform)\b/i,
  /\bnew\s+product\s+(launch|introduction|release)\b/i,
  /\bpipeline\s+(of|includes)\b/i,
  /\bproduct\s+roadmap\b/i,
];

const OPERATIONAL_PATTERNS: RegExp[] = [
  /\boperational\s+(efficiency|excellence|improvement)\b/i,
  /\bcost\s+(reduction|savings|optimization)\b/i,
  /\bmargin\s+(expansion|improvement)\b/i,
];

// ============================================
// EXTRACTION LOGIC
// ============================================

function isForwardLooking(sentence: string): boolean {
  return FORWARD_LOOKING_PATTERNS.some(pattern => pattern.test(sentence));
}

function categorizePromise(sentence: string): { category: PromiseCategory; keywords: string[] } {
  const keywords: string[] = [];
  
  if (GUIDANCE_PATTERNS.some(p => p.test(sentence))) {
    const match = sentence.match(/\b(revenue|earnings|eps|margin|guidance|outlook|forecast)\b/gi);
    if (match) keywords.push(...match.map(m => m.toLowerCase()));
    return { category: "guidance", keywords };
  }
  
  if (GROWTH_PATTERNS.some(p => p.test(sentence))) {
    const match = sentence.match(/\b(growth|expand|increase|accelerate)\b/gi);
    if (match) keywords.push(...match.map(m => m.toLowerCase()));
    return { category: "growth", keywords };
  }
  
  if (STRATEGY_PATTERNS.some(p => p.test(sentence))) {
    const match = sentence.match(/\b(strategy|strategic|initiative|transform)\b/gi);
    if (match) keywords.push(...match.map(m => m.toLowerCase()));
    return { category: "strategy", keywords };
  }
  
  if (INVESTMENT_PATTERNS.some(p => p.test(sentence))) {
    const match = sentence.match(/\b(invest|capital|r&d|acquisition)\b/gi);
    if (match) keywords.push(...match.map(m => m.toLowerCase()));
    return { category: "investment", keywords };
  }
  
  if (PRODUCT_PATTERNS.some(p => p.test(sentence))) {
    const match = sentence.match(/\b(product|launch|pipeline|innovation)\b/gi);
    if (match) keywords.push(...match.map(m => m.toLowerCase()));
    return { category: "product", keywords };
  }
  
  if (OPERATIONAL_PATTERNS.some(p => p.test(sentence))) {
    const match = sentence.match(/\b(operational|efficiency|cost|margin)\b/gi);
    if (match) keywords.push(...match.map(m => m.toLowerCase()));
    return { category: "operational", keywords };
  }
  
  if (/\b(financial|earnings|revenue|profit|cash\s+flow)\b/i.test(sentence)) {
    return { category: "financial", keywords: ["financial"] };
  }
  
  if (/\b(market|customer|competitive|industry)\b/i.test(sentence)) {
    return { category: "market", keywords: ["market"] };
  }
  
  if (/\b(risk|mitigat|protect|hedge)\b/i.test(sentence)) {
    return { category: "risk_mitigation", keywords: ["risk"] };
  }
  
  return { category: "other", keywords };
}

function calculateConfidence(sentence: string): "high" | "medium" | "low" {
  let score = 0;
  
  if (/\b(expect|anticipate|commit|will|plan|intend)\b/i.test(sentence)) {
    score += 2;
  }
  
  if (/\b\d+%|\$[\d,]+|\d+\s*(million|billion|M|B)\b/i.test(sentence)) {
    score += 2;
  }
  
  if (/\b(FY|fiscal\s+year|Q[1-4]|20\d{2}|next\s+year|coming\s+months?)\b/i.test(sentence)) {
    score += 1;
  }
  
  if (/\b(may|might|could|possible|potentially)\b/i.test(sentence)) {
    score -= 1;
  }
  
  if (score >= 3) return "high";
  if (score >= 1) return "medium";
  return "low";
}

function extractFromSection(section: FilingSection): ExtractedPromise[] {
  const sentences = splitIntoSentences(section.content);
  const promises: ExtractedPromise[] = [];
  
  for (const sentence of sentences) {
    if (sentence.length < 50 || sentence.length > 1000) continue;
    if (!isForwardLooking(sentence)) continue;
    
    const { category, keywords } = categorizePromise(sentence);
    const confidence = calculateConfidence(sentence);
    
    if (category === "other" && confidence === "low") continue;
    
    promises.push({
      text: sentence.trim(),
      category,
      confidence,
      source: section.title,
      keywords: [...new Set(keywords)],
    });
  }
  
  return promises;
}

/**
 * Huvudfunktion för att extrahera promises från en filing.
 */
export function extractPromises(sections: FilingSection[]): PromiseExtractionResult {
  const allPromises: ExtractedPromise[] = [];
  let totalSentences = 0;
  
  for (const section of sections) {
    const sentences = splitIntoSentences(section.content);
    totalSentences += sentences.length;
    
    const sectionPromises = extractFromSection(section);
    allPromises.push(...sectionPromises);
  }
  
  // Deduplicera
  const seen = new Set<string>();
  const uniquePromises: ExtractedPromise[] = [];
  
  for (const promise of allPromises) {
    const key = promise.text.toLowerCase().replace(/\s+/g, " ").substring(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      uniquePromises.push(promise);
    }
  }
  
  // Sortera: high confidence först
  uniquePromises.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    return confOrder[a.confidence] - confOrder[b.confidence];
  });
  
  // Sammanställ summary
  const byCategory: Record<PromiseCategory, number> = {
    guidance: 0, growth: 0, strategy: 0, investment: 0,
    risk_mitigation: 0, operational: 0, financial: 0,
    product: 0, market: 0, other: 0,
  };
  
  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0 };
  
  for (const promise of uniquePromises) {
    byCategory[promise.category]++;
    byConfidence[promise.confidence]++;
  }
  
  return {
    totalSentences,
    extractedCount: uniquePromises.length,
    promises: uniquePromises,
    summary: { byCategory, byConfidence },
  };
}

/**
 * Formaterar en promise för display.
 */
export function formatPromiseForDisplay(promise: ExtractedPromise): string {
  const emoji = { high: "🟢", medium: "🟡", low: "🔴" };
  return `${emoji[promise.confidence]} [${promise.category.toUpperCase()}] ${promise.text}`;
}

