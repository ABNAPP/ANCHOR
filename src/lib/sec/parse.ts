/**
 * SEC Filing Parser
 * 
 * Funktioner för att parsa och extrahera text från SEC EDGAR HTML-dokument.
 * Fokuserar på att extrahera MD&A och Risk Factors från 10-K/10-Q filings.
 */

// ============================================
// TYPES
// ============================================

export interface ParsedSections {
  mdna: string | null;           // Management's Discussion and Analysis
  riskFactors: string | null;    // Risk Factors (Item 1A)
  fullText: string;              // Hela dokumentet som fallback
  metadata: {
    totalLength: number;
    mdnaLength: number;
    riskFactorsLength: number;
    sectionsFound: string[];
  };
}

export interface ParsedFiling {
  sections: ParsedSections;
  cleanedLength: number;
}

// ============================================
// HTML CLEANING
// ============================================

/**
 * Tar bort HTML-taggar och rensar text för analys.
 * 
 * Steg:
 * 1. Ta bort <script> och <style> block
 * 2. Ta bort HTML-kommentarer
 * 3. Ersätt HTML-entiteter
 * 4. Ta bort alla HTML-taggar
 * 5. Normalisera whitespace
 * 6. Ta bort repetitiva "Table of Contents"-block
 */
export function stripHtmlToText(html: string): string {
  if (!html) return "";

  let text = html;

  // 1. Ta bort script och style block helt
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  
  // 2. Ta bort HTML-kommentarer
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  
  // 3. Ersätt vanliga HTML-entiteter
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
    "&hellip;": "...",
    "&bull;": "•",
    "&trade;": "™",
    "&reg;": "®",
    "&copy;": "©",
    "&ldquo;": '"',
    "&rdquo;": '"',
    "&lsquo;": "'",
    "&rsquo;": "'",
  };
  
  for (const [entity, replacement] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, "gi"), replacement);
  }
  
  // Hantera numeriska entiteter
  text = text.replace(/&#(\d+);/g, (_, code) => {
    const num = parseInt(code, 10);
    return num < 65536 ? String.fromCharCode(num) : " ";
  });
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const num = parseInt(code, 16);
    return num < 65536 ? String.fromCharCode(num) : " ";
  });

  // 4. Ersätt block-element med radbrytningar för att bevara struktur
  text = text.replace(/<\/(p|div|tr|li|h[1-6]|br|section|article)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  
  // 5. Ta bort alla återstående HTML-taggar
  text = text.replace(/<[^>]+>/g, " ");

  // 6. Normalisera whitespace
  // - Ersätt tabs och multipla mellanslag med ett mellanslag
  text = text.replace(/[ \t]+/g, " ");
  // - Ersätt 3+ radbrytningar med 2
  text = text.replace(/\n{3,}/g, "\n\n");
  // - Trimma varje rad
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  // 7. Ta bort repetitiva "Table of Contents"-block (heuristik)
  // Dessa upprepas ofta i SEC filings
  text = text.replace(/Table of Contents\s*\n/gi, "");
  text = text.replace(/INDEX TO FINANCIAL STATEMENTS\s*\n/gi, "");
  
  // 8. Ta bort sidnummer och footer-text (heuristik)
  text = text.replace(/^\d+\s*$/gm, ""); // Ensamma siffror på en rad
  text = text.replace(/Page \d+ of \d+/gi, "");

  return text.trim();
}

// ============================================
// SECTION EXTRACTION
// ============================================

/**
 * Extraherar specifika sektioner från en SEC filing.
 * Prioriterar MD&A (Item 7 för 10-K, Item 2 för 10-Q) och Risk Factors (Item 1A).
 */
export function extractSections(text: string, formType: string): ParsedSections {
  const sectionsFound: string[] = [];
  
  // Normalisera formType
  const form = formType.toUpperCase();
  const is10K = form.includes("10-K");
  const is10Q = form.includes("10-Q");

  let mdna: string | null = null;
  let riskFactors: string | null = null;

  // ============================================
  // MD&A EXTRACTION
  // ============================================
  
  // MD&A patterns - olika för 10-K och 10-Q
  const mdnaPatterns = is10K
    ? [
        // 10-K: Item 7
        /ITEM\s*7[.\s]*[-–—]?\s*MANAGEMENT['']?S?\s*DISCUSSION\s*AND\s*ANALYSIS/i,
        /ITEM\s*7[.\s]*MANAGEMENT['']?S?\s*DISCUSSION/i,
        /MANAGEMENT['']?S?\s*DISCUSSION\s*AND\s*ANALYSIS\s*OF\s*FINANCIAL\s*CONDITION/i,
        /MD&A/i,
      ]
    : [
        // 10-Q: Item 2
        /ITEM\s*2[.\s]*[-–—]?\s*MANAGEMENT['']?S?\s*DISCUSSION\s*AND\s*ANALYSIS/i,
        /ITEM\s*2[.\s]*MANAGEMENT['']?S?\s*DISCUSSION/i,
        /MANAGEMENT['']?S?\s*DISCUSSION\s*AND\s*ANALYSIS/i,
      ];

  // MD&A end patterns
  const mdnaEndPatterns = is10K
    ? [
        /ITEM\s*7A[.\s]*[-–—]?\s*QUANTITATIVE\s*AND\s*QUALITATIVE/i,
        /ITEM\s*8[.\s]*[-–—]?\s*FINANCIAL\s*STATEMENTS/i,
        /QUANTITATIVE\s*AND\s*QUALITATIVE\s*DISCLOSURES/i,
      ]
    : [
        /ITEM\s*3[.\s]*[-–—]?\s*QUANTITATIVE\s*AND\s*QUALITATIVE/i,
        /ITEM\s*4[.\s]*[-–—]?\s*CONTROLS\s*AND\s*PROCEDURES/i,
        /QUANTITATIVE\s*AND\s*QUALITATIVE\s*DISCLOSURES/i,
      ];

  mdna = extractSectionBetween(text, mdnaPatterns, mdnaEndPatterns);
  if (mdna && mdna.length > 500) {
    sectionsFound.push("MD&A");
  } else {
    mdna = null;
  }

  // ============================================
  // RISK FACTORS EXTRACTION (10-K primarily)
  // ============================================
  
  if (is10K) {
    const riskPatterns = [
      /ITEM\s*1A[.\s]*[-–—]?\s*RISK\s*FACTORS/i,
      /RISK\s*FACTORS/i,
    ];
    
    const riskEndPatterns = [
      /ITEM\s*1B[.\s]*[-–—]?\s*UNRESOLVED\s*STAFF\s*COMMENTS/i,
      /ITEM\s*2[.\s]*[-–—]?\s*PROPERTIES/i,
      /UNRESOLVED\s*STAFF\s*COMMENTS/i,
    ];

    riskFactors = extractSectionBetween(text, riskPatterns, riskEndPatterns);
    if (riskFactors && riskFactors.length > 500) {
      sectionsFound.push("Risk Factors");
    } else {
      riskFactors = null;
    }
  }

  return {
    mdna,
    riskFactors,
    fullText: text,
    metadata: {
      totalLength: text.length,
      mdnaLength: mdna?.length || 0,
      riskFactorsLength: riskFactors?.length || 0,
      sectionsFound,
    },
  };
}

/**
 * Extraherar text mellan start- och slut-patterns.
 */
function extractSectionBetween(
  text: string,
  startPatterns: RegExp[],
  endPatterns: RegExp[]
): string | null {
  let startIndex = -1;
  let matchedStartPattern: RegExp | null = null;

  // Hitta första matchande start-pattern
  for (const pattern of startPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      if (startIndex === -1 || match.index < startIndex) {
        startIndex = match.index;
        matchedStartPattern = pattern;
      }
    }
  }

  if (startIndex === -1 || !matchedStartPattern) {
    return null;
  }

  // Hitta första matchande slut-pattern efter start
  let endIndex = text.length;
  for (const pattern of endPatterns) {
    const searchText = text.slice(startIndex + 100); // Sök efter startpositionen
    const match = searchText.match(pattern);
    if (match && match.index !== undefined) {
      const absoluteIndex = startIndex + 100 + match.index;
      if (absoluteIndex < endIndex) {
        endIndex = absoluteIndex;
      }
    }
  }

  // Extrahera sektionen
  const section = text.slice(startIndex, endIndex);
  
  // Rensa bort section-rubriken från början
  const cleanedSection = section.replace(matchedStartPattern, "").trim();

  return cleanedSection;
}

// ============================================
// MAIN PARSER
// ============================================

/**
 * Huvudfunktion för att parsa en SEC filing.
 * 
 * @param htmlContent - Raw HTML från SEC EDGAR
 * @param formType - "10-K" eller "10-Q"
 * @returns ParsedFiling med sektioner och metadata
 */
export function parseFiling(htmlContent: string, formType: string): ParsedFiling {
  // 1. Rensa HTML till ren text
  const cleanText = stripHtmlToText(htmlContent);
  
  // 2. Extrahera sektioner
  const sections = extractSections(cleanText, formType);

  console.log(`[Parse] Cleaned text: ${cleanText.length} chars`);
  console.log(`[Parse] Sections found: ${sections.metadata.sectionsFound.join(", ") || "none"}`);
  console.log(`[Parse] MD&A length: ${sections.metadata.mdnaLength}`);

  return {
    sections,
    cleanedLength: cleanText.length,
  };
}

/**
 * Väljer bästa text för promise extraction.
 * Prioriterar MD&A om den finns och är tillräckligt lång.
 * 
 * @param sections - ParsedSections från parseFiling
 * @param minMdnaLength - Minsta längd för MD&A att användas (default 5000)
 * @returns Bästa texten för analys och källan
 */
export function selectBestTextForAnalysis(
  sections: ParsedSections,
  minMdnaLength: number = 5000
): { text: string; source: string } {
  // Prioritet 1: MD&A om tillräckligt lång
  if (sections.mdna && sections.mdna.length >= minMdnaLength) {
    return {
      text: sections.mdna,
      source: "MD&A",
    };
  }

  // Prioritet 2: Risk Factors som komplement
  if (sections.riskFactors && sections.riskFactors.length >= minMdnaLength) {
    return {
      text: sections.riskFactors,
      source: "Risk Factors",
    };
  }

  // Prioritet 3: Kombinera MD&A + Risk Factors om båda finns men är korta
  if (sections.mdna && sections.riskFactors) {
    const combined = sections.mdna + "\n\n" + sections.riskFactors;
    if (combined.length >= minMdnaLength) {
      return {
        text: combined,
        source: "MD&A + Risk Factors",
      };
    }
  }

  // Fallback: Hela texten
  return {
    text: sections.fullText,
    source: "Full Text",
  };
}

/**
 * Trunkerar text till en maxlängd med ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Interface för en filing section (används av filing API route).
 */
export interface FilingSection {
  name: string;
  title: string;
  content: string;
  wordCount: number;
  characterCount: number;
}