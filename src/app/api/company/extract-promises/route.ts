/**
 * Extract Promises API
 * 
 * POST /api/company/extract-promises
 * 
 * Extraherar "promises" och "claims" från ett SEC filing.
 * Sparar resultatet i Firestore om konfigurerat.
 * 
 * OBS: 8-K filings avvisas eftersom de oftast saknar analysbart textinnehåll.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { fetchFilingDocument, FetchedDocument } from "@/lib/sec/client";
import { parseFiling } from "@/lib/sec/parse";
import { extractPromises, PromiseExtractionResult } from "@/lib/company/promises";
import { getFirestoreDb, isFirebaseConfigured } from "@/lib/firebase/admin";

// ============================================
// TYPES
// ============================================

export interface ExtractPromisesRequest {
  cik: string;
  accessionNumber: string;
  document: string;
  formType: string;
  companyName?: string;
  ticker?: string;
}

export interface ExtractPromisesResponse {
  cik: string;
  accessionNumber: string;
  formType: string;
  companyName: string | null;
  ticker: string | null;
  documentUsed: string;
  usedFallback: boolean;
  extraction: PromiseExtractionResult;
  savedToFirestore: boolean;
  firestoreId?: string;
}

export interface ExtractPromisesError {
  error: string;
  message: string;
  details?: string;
  suggestion?: string;
}

const COMPANY_PROMISES_COLLECTION = "company_promises";

// Form types som stöds för promise extraction
const SUPPORTED_FORM_TYPES = ["10-K", "10-Q"];

// ============================================
// HANDLER
// ============================================

export async function POST(
  request: NextRequest
): Promise<NextResponse<ExtractPromisesResponse | ExtractPromisesError>> {
  let body: ExtractPromisesRequest;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON",
        message: "Request body måste vara giltig JSON",
      },
      { status: 400 }
    );
  }

  const { cik, accessionNumber, document, formType, companyName, ticker } = body;

  if (!cik || !accessionNumber || !document || !formType) {
    return NextResponse.json(
      {
        error: "Missing parameters",
        message: "Ange cik, accessionNumber, document och formType",
      },
      { status: 400 }
    );
  }

  // GUARD: Avvisa 8-K filings
  const formUpper = formType.toUpperCase();
  if (formUpper.includes("8-K")) {
    console.log(`[Extract Promises] Rejected 8-K filing: CIK=${cik}, Accession=${accessionNumber}`);
    return NextResponse.json(
      {
        error: "Unsupported form type",
        message: "8-K filings saknar ofta analysbart textinnehåll. De innehåller vanligtvis endast exhibits, pressmeddelanden eller PDF-bilagor utan strukturerad MD&A-text.",
        details: `Form type: ${formType}`,
        suggestion: "Välj en 10-K (årsredovisning) eller 10-Q (kvartalsrapport) för promise extraction. Dessa innehåller Management's Discussion and Analysis (MD&A) och andra analysbara sektioner.",
      },
      { status: 400 }
    );
  }

  // Varning för andra form types (men tillåt)
  const isSupportedForm = SUPPORTED_FORM_TYPES.some(f => formUpper.includes(f));
  if (!isSupportedForm) {
    console.warn(`[Extract Promises] Unsupported form type attempted: ${formType}`);
  }

  try {
    console.log(`[Extract Promises] Processing: CIK=${cik}, Form=${formType}`);

    // 1. Hämta filing-dokumentet med robust fetch
    const fetchedDoc: FetchedDocument | null = await fetchFilingDocument(cik, accessionNumber, document);
    
    if (!fetchedDoc) {
      console.error(`[Extract Promises] Document not found: CIK=${cik}, Accession=${accessionNumber}`);
      return NextResponse.json(
        {
          error: "Filing not found",
          message: `Dokumentet kunde inte hämtas från SEC EDGAR. Varken primärt dokument (${document}) eller fallback-dokument hittades.`,
          details: `CIK: ${cik}, Accession: ${accessionNumber}`,
        },
        { status: 404 }
      );
    }
    
    const usedFallback = fetchedDoc.documentName !== document;
    
    if (usedFallback) {
      console.info(`[Extract Promises] Used fallback document: ${fetchedDoc.documentName} instead of ${document}`);
    }
    
    console.log(`[Extract Promises] Fetched ${fetchedDoc.content.length} bytes`);

    // 2. Parsa filing
    const parsed = parseFiling(fetchedDoc.content, formType);
    console.log(`[Extract Promises] Parsed ${parsed.sections.length} sections`);

    // Kontrollera om vi hittade några sektioner
    if (parsed.sections.length === 0) {
      console.warn(`[Extract Promises] No sections found in ${formType} filing`);
      return NextResponse.json(
        {
          error: "No analyzable content",
          message: "Inga analysbara sektioner hittades i dokumentet. Det kan bero på att dokumentet är i ett format som inte stöds (t.ex. XBRL inline eller exhibit-only).",
          details: `CIK: ${cik}, Form: ${formType}`,
          suggestion: "Prova en annan filing eller verifiera att dokumentet innehåller standard SEC-sektioner.",
        },
        { status: 422 }
      );
    }

    // 3. Extrahera promises
    const extraction = extractPromises(parsed.sections);
    console.log(`[Extract Promises] Extracted ${extraction.extractedCount} promises`);

    // 4. Spara till Firestore om konfigurerat
    let savedToFirestore = false;
    let firestoreId: string | undefined;

    if (isFirebaseConfigured()) {
      try {
        const db = getFirestoreDb();
        if (db) {
          const docData = {
            createdAt: FieldValue.serverTimestamp(),
            cik: cik.padStart(10, "0"),
            accessionNumber,
            document: fetchedDoc.documentName,
            originalDocument: document,
            usedFallback,
            formType,
            companyName: companyName || null,
            ticker: ticker || null,
            extraction: {
              totalSentences: extraction.totalSentences,
              extractedCount: extraction.extractedCount,
              summary: extraction.summary,
            },
            promises: extraction.promises
              .filter((p) => p.confidence !== "low")
              .map((p) => ({
                text: p.text,
                category: p.category,
                confidence: p.confidence,
                source: p.source,
                keywords: p.keywords,
              })),
          };

          const docRef = await db.collection(COMPANY_PROMISES_COLLECTION).add(docData);
          firestoreId = docRef.id;
          savedToFirestore = true;
          console.log(`[Extract Promises] Saved to Firestore: ${firestoreId}`);
        }
      } catch (firestoreError) {
        console.error("[Extract Promises] Firestore error:", firestoreError);
      }
    } else {
      console.log("[Extract Promises] Firebase not configured, skipping save");
    }

    return NextResponse.json({
      cik: cik.padStart(10, "0"),
      accessionNumber,
      formType,
      companyName: companyName || null,
      ticker: ticker || null,
      documentUsed: fetchedDoc.documentName,
      usedFallback,
      extraction,
      savedToFirestore,
      firestoreId,
    });
  } catch (error) {
    console.error("[Extract Promises] Error:", error);

    const message =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    if (message.includes("404")) {
      return NextResponse.json(
        {
          error: "Filing not found",
          message: `Dokumentet hittades inte på SEC EDGAR`,
          details: `CIK: ${cik}, Accession: ${accessionNumber}`,
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
        error: "Extraction failed",
        message,
      },
      { status: 500 }
    );
  }
}
