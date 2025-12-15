/**
 * SEC Filing Parser
 * 
 * Parsar och extraherar sektioner från SEC filings (10-K, 10-Q, 8-K).
 * Hanterar både HTML och plain text format.
 */

// ============================================
// TYPES
// ============================================

export interface FilingSection {
  name: string;
  title: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedFiling {
  rawLength: number;
  cleanedLength: number;
  sections: FilingSection[];
  fullText: string;
}

// ============================================
// HTML CLEANING
// ============================================

/**
 * Tar bort HTML-taggar och normaliserar whitespace.
 */
export function stripHtml(html: string): string {
  let text = html;
  
  // Ta bort script och style-block helt
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  
  // Ersätt block-element med radbrytningar
  text = text.replace(/<\/(p|div|tr|li|h[1-6]|br|hr)>/gi, "\n");
  text = text.replace(/<(br|hr)\s*\/?>/gi, "\n");
  
  // Ta bort alla andra HTML-taggar
  text = text.replace(/<[^>]+>/g, " ");
  
  // Dekoda HTML-entiteter
  text = decodeHtmlEntities(text);
  
  // Normalisera whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();
  
  return text;
}

/**
 * Dekoderar vanliga HTML-entiteter.
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&mdash;": "—",
    "&ndash;": "–",
    "&ldquo;": '"',
    "&rdquo;": '"',
    "&lsquo;": "'",
    "&rsquo;": "'",
    "&bull;": "•",
    "&hellip;": "...",
    "&copy;": "©",
    "&reg;": "®",
    "&trade;": "™",
  };
  
  let result = text;
  for (const [entity, replacement] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, "gi"), replacement);
  }
  
  // Numeriska entiteter
  result = result.replace(/&#(\d+);/g, (_, code) => {
    return String.fromCharCode(parseInt(code, 10));
  });
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    return String.fromCharCode(parseInt(code, 16));
  });
  
  return result;
}

// ============================================
// SECTION PATTERNS
// ============================================

const SECTION_PATTERNS_10K: Array<{ name: string; title: string; patterns: RegExp[] }> = [
  {
    name: "item1",
    title: "Business",
    patterns: [/item\s*1\.?\s*[-–—]?\s*business/i],
  },
  {
    name: "item1a",
    title: "Risk Factors",
    patterns: [/item\s*1a\.?\s*[-–—]?\s*risk\s*factors/i],
  },
  {
    name: "item7",
    title: "Management's Discussion and Analysis (MD&A)",
    patterns: [
      /item\s*7\.?\s*[-–—]?\s*management['']?s?\s*discussion/i,
      /management['']?s?\s*discussion\s*and\s*analysis/i,
    ],
  },
  {
    name: "item7a",
    title: "Quantitative and Qualitative Disclosures About Market Risk",
    patterns: [/item\s*7a\.?\s*[-–—]?\s*quantitative/i],
  },
  {
    name: "item8",
    title: "Financial Statements",
    patterns: [/item\s*8\.?\s*[-–—]?\s*financial\s*statements/i],
  },
];

const SECTION_PATTERNS_10Q: Array<{ name: string; title: string; patterns: RegExp[] }> = [
  {
    name: "part1_item1",
    title: "Financial Statements",
    patterns: [/item\s*1\.?\s*[-–—]?\s*financial\s*statements/i],
  },
  {
    name: "part1_item2",
    title: "Management's Discussion and Analysis (MD&A)",
    patterns: [/item\s*2\.?\s*[-–—]?\s*management['']?s?\s*discussion/i],
  },
  {
    name: "part2_item1a",
    title: "Risk Factors",
    patterns: [/item\s*1a\.?\s*[-–—]?\s*risk\s*factors/i],
  },
];

const SECTION_PATTERNS_8K: Array<{ name: string; title: string; patterns: RegExp[] }> = [
  { name: "item2_02", title: "Results of Operations", patterns: [/item\s*2\.02/i] },
  { name: "item7_01", title: "Regulation FD Disclosure", patterns: [/item\s*7\.01/i] },
  { name: "item8_01", title: "Other Events", patterns: [/item\s*8\.01/i] },
];

// ============================================
// SECTION EXTRACTION
// ============================================

function findSections(
  text: string, 
  patterns: Array<{ name: string; title: string; patterns: RegExp[] }>
): FilingSection[] {
  const sections: FilingSection[] = [];
  const matches: Array<{ name: string; title: string; index: number }> = [];
  
  for (const sectionDef of patterns) {
    for (const pattern of sectionDef.patterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        const existing = matches.find(m => m.name === sectionDef.name);
        if (!existing || match.index < existing.index) {
          if (existing) {
            matches.splice(matches.indexOf(existing), 1);
          }
          matches.push({
            name: sectionDef.name,
            title: sectionDef.title,
            index: match.index,
          });
        }
        break;
      }
    }
  }
  
  matches.sort((a, b) => a.index - b.index);
  
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    
    const startIndex = current.index;
    const endIndex = next ? next.index : text.length;
    const content = text.substring(startIndex, endIndex).trim();
    
    if (content.length > 200) {
      sections.push({
        name: current.name,
        title: current.title,
        content,
        startIndex,
        endIndex,
      });
    }
  }
  
  return sections;
}

/**
 * Parsar en SEC filing och extraherar sektioner.
 */
export function parseFiling(rawContent: string, formType: string): ParsedFiling {
  const cleanedText = stripHtml(rawContent);
  
  let patterns: Array<{ name: string; title: string; patterns: RegExp[] }>;
  const formUpper = formType.toUpperCase();
  
  if (formUpper.includes("10-K")) {
    patterns = SECTION_PATTERNS_10K;
  } else if (formUpper.includes("10-Q")) {
    patterns = SECTION_PATTERNS_10Q;
  } else if (formUpper.includes("8-K")) {
    patterns = SECTION_PATTERNS_8K;
  } else {
    patterns = [...SECTION_PATTERNS_10K, ...SECTION_PATTERNS_10Q];
  }
  
  const sections = findSections(cleanedText, patterns);
  
  return {
    rawLength: rawContent.length,
    cleanedLength: cleanedText.length,
    sections,
    fullText: cleanedText,
  };
}

/**
 * Extraherar MD&A-sektionen.
 */
export function extractMdaSection(parsedFiling: ParsedFiling): FilingSection | null {
  return parsedFiling.sections.find(s => 
    s.name === "item7" || 
    s.name === "part1_item2" ||
    s.title.toLowerCase().includes("management")
  ) || null;
}

/**
 * Extraherar Risk Factors-sektionen.
 */
export function extractRiskFactorsSection(parsedFiling: ParsedFiling): FilingSection | null {
  return parsedFiling.sections.find(s =>
    s.name === "item1a" ||
    s.name === "part2_item1a" ||
    s.title.toLowerCase().includes("risk factor")
  ) || null;
}

/**
 * Delar upp text i meningar.
 */
export function splitIntoSentences(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  return sentences.filter(s => s.trim().length > 0);
}

/**
 * Trunkerar text till max längd.
 */
export function truncateText(text: string, maxLength: number = 5000): string {
  if (text.length <= maxLength) return text;
  const truncated = text.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf(". ");
  if (lastPeriod > maxLength * 0.8) {
    return truncated.substring(0, lastPeriod + 1) + "...";
  }
  return truncated + "...";
}

