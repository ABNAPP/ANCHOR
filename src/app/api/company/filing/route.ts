/**
 * Single Filing API
 * 
 * GET /api/company/filing?cik=<cik>&accession=<accessionNumber>&doc=<document>&form=<formType>
 * 
 * Hämtar och parsar ett enskilt SEC filing-dokument.
 * Använder robust fetch med fallback via index.json.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchFilingDocument, buildFilingDocumentUrl, FetchedDocument } from "@/lib/sec/client";
import { parseFiling, FilingSection, truncateText } from "@/lib/sec/parse";

export interface FilingSectionSummary {
  name: string;
  title: string;
  wordCount: number;
  characterCount: number;
}

export interface FilingResponse {
  cik: string;
  accessionNumber: string;
  document: string;
  documentUrl: string;
  sourceUrl: string; // Faktisk URL som användes (kan skilja vid fallback)
  usedFallback: boolean;
  rawLength: number;
  cleanedLength: number;
  sectionCount: number;
  sections: FilingSectionSummary[];
  textPreview?: string; // Första 2000 tecken av rensat innehåll
  fullSections?: FilingSection[];
}

export interface FilingError {
  error: string;
  message: string;
  details?: string;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<FilingResponse | FilingError>> {
  const searchParams = request.nextUrl.searchParams;
  const cik = searchParams.get("cik")?.trim();
  const accession = searchParams.get("accession")?.trim();
  const doc = searchParams.get("doc")?.trim();
  const form = searchParams.get("form")?.trim() || "10-K";
  const includeFull = searchParams.get("include") === "full";
  const includePreview = searchParams.get("preview") !== "false";

  if (!cik || !accession || !doc) {
    return NextResponse.json(
      {
        error: "Missing parameters",
        message: "Ange cik, accession och doc parametrar",
      },
      { status: 400 }
    );
  }

  try {
    console.log(`[Filing] Fetching: CIK=${cik}, Accession=${accession}, Doc=${doc}`);

    // Robust fetch med fallback
    const fetchedDoc: FetchedDocument | null = await fetchFilingDocument(cik, accession, doc);
    
    if (!fetchedDoc) {
      console.error(`[Filing] Document not found after all attempts: CIK=${cik}, Accession=${accession}`);
      return NextResponse.json(
        {
          error: "Filing not found",
          message: `Dokumentet kunde inte hämtas från SEC EDGAR. Varken primärt dokument (${doc}) eller fallback-dokument hittades.`,
          details: `CIK: ${cik}, Accession: ${accession}`,
        },
        { status: 404 }
      );
    }
    
    const usedFallback = fetchedDoc.documentName !== doc;
    
    if (usedFallback) {
      console.info(`[Filing] Used fallback document: ${fetchedDoc.documentName} instead of ${doc}`);
    }
    
    console.log(`[Filing] Received ${fetchedDoc.content.length} bytes, parsing...`);

    // Parsa dokumentet
    const parsed = parseFiling(fetchedDoc.content, form);

    // Bygg section summaries från ParsedSections (objekt, inte array)
    const sectionSummaries: FilingSectionSummary[] = [];
    const fullSections: FilingSection[] = [];
    
    if (parsed.sections.mdna) {
      const mdnaContent = parsed.sections.mdna;
      const summary: FilingSectionSummary = {
        name: "mdna",
        title: "Management's Discussion and Analysis",
        wordCount: mdnaContent.split(/\s+/).length,
        characterCount: mdnaContent.length,
      };
      sectionSummaries.push(summary);
      fullSections.push({
        name: "mdna",
        title: "Management's Discussion and Analysis",
        content: mdnaContent,
        wordCount: summary.wordCount,
        characterCount: summary.characterCount,
      });
    }
    
    if (parsed.sections.riskFactors) {
      const riskContent = parsed.sections.riskFactors;
      const summary: FilingSectionSummary = {
        name: "riskFactors",
        title: "Risk Factors",
        wordCount: riskContent.split(/\s+/).length,
        characterCount: riskContent.length,
      };
      sectionSummaries.push(summary);
      fullSections.push({
        name: "riskFactors",
        title: "Risk Factors",
        content: riskContent,
        wordCount: summary.wordCount,
        characterCount: summary.characterCount,
      });
    }

    console.log(`[Filing] Parsed: ${sectionSummaries.length} sections found`);

    // Bygg response
    const response: FilingResponse = {
      cik: cik.padStart(10, "0"),
      accessionNumber: accession,
      document: fetchedDoc.documentName, // Faktiskt använt dokument
      documentUrl: buildFilingDocumentUrl(cik, accession, doc), // Ursprunglig förfrågan
      sourceUrl: fetchedDoc.sourceUrl, // Faktisk källa
      usedFallback,
      rawLength: fetchedDoc.content.length,
      cleanedLength: parsed.cleanedLength,
      sectionCount: sectionSummaries.length,
      sections: sectionSummaries,
    };

    // Inkludera textpreview om begärt (default: ja)
    if (includePreview) {
      response.textPreview = truncateText(parsed.sections.fullText, 2000);
    }

    // Inkludera fullständiga sektioner om begärt
    if (includeFull) {
      response.fullSections = fullSections;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Filing] Error:", error);

    const message =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    // Ge mer specifik felinfo
    if (message.includes("404")) {
      return NextResponse.json(
        {
          error: "Filing not found",
          message: `Dokumentet hittades inte på SEC EDGAR: ${doc}`,
          details: `CIK: ${cik}, Accession: ${accession}`,
        },
        { status: 404 }
      );
    }

    if (message.includes("timeout") || message.includes("Timeout")) {
      return NextResponse.json(
        {
          error: "Request timeout",
          message: "SEC EDGAR svarade inte i tid. Försök igen senare.",
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        error: "Filing fetch failed",
        message,
      },
      { status: 500 }
    );
  }
}
