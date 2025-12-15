/**
 * Single Filing API
 * 
 * GET /api/company/filing?cik=<cik>&accession=<accessionNumber>&doc=<document>&form=<formType>
 * 
 * Hämtar och parsar ett enskilt SEC filing-dokument.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFilingDocument, buildFilingDocumentUrl } from "@/lib/sec/client";
import { parseFiling, FilingSection } from "@/lib/sec/parse";

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
  rawLength: number;
  cleanedLength: number;
  sectionCount: number;
  sections: FilingSectionSummary[];
  fullSections?: FilingSection[];
}

export interface FilingError {
  error: string;
  message: string;
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

    const rawContent = await getFilingDocument(cik, accession, doc);
    
    console.log(`[Filing] Received ${rawContent.length} bytes, parsing...`);

    const parsed = parseFiling(rawContent, form);

    console.log(`[Filing] Parsed: ${parsed.sections.length} sections found`);

    const sectionSummaries: FilingSectionSummary[] = parsed.sections.map((s) => ({
      name: s.name,
      title: s.title,
      wordCount: s.content.split(/\s+/).length,
      characterCount: s.content.length,
    }));

    const response: FilingResponse = {
      cik: cik.padStart(10, "0"),
      accessionNumber: accession,
      document: doc,
      documentUrl: buildFilingDocumentUrl(cik, accession, doc),
      rawLength: parsed.rawLength,
      cleanedLength: parsed.cleanedLength,
      sectionCount: parsed.sections.length,
      sections: sectionSummaries,
    };

    if (includeFull) {
      response.fullSections = parsed.sections;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Filing] Error:", error);

    const message =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    if (message.includes("404")) {
      return NextResponse.json(
        {
          error: "Filing not found",
          message: `Dokumentet hittades inte: ${doc}`,
        },
        { status: 404 }
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

