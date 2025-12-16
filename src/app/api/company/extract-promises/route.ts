/**
 * Extract Promises API
 * 
 * POST /api/company/extract-promises
 * 
 * Extraherar "promises" och "claims" från ett SEC 10-K eller 10-Q filing.
 * Använder MD&A-sektionen i första hand.
 * Sparar resultatet i Firestore om konfigurerat.
 * 
 * VIKTIGT: Endast 10-K och 10-Q stöds. 8-K och andra form types avvisas.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { fetchFilingDocument } from "@/lib/sec/client";
import { parseFiling, selectBestTextForAnalysis } from "@/lib/sec/parse";
import { extractPromises, PromiseExtractionResult } from "@/lib/company/promises";
import { getFirestoreDb, isFirebaseConfigured, COMPANY_PROMISES_COLLECTION } from "@/lib/firebase/admin";
import { sanitizeForFirestore } from "@/lib/firebase/sanitize";

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
  textSource: string;
  textLength: number;
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


// Endast dessa form types stöds
const SUPPORTED_FORM_TYPES = ["10-K", "10-Q"];

// ============================================
// VALIDATION
// ============================================

/**
 * Kontrollerar om form type stöds för promise extraction.
 */
function isSupportedFormType(formType: string): boolean {
  const upper = formType.toUpperCase();
  return SUPPORTED_FORM_TYPES.some((supported) => upper.includes(supported));
}

/**
 * Kontrollerar om form type är en 8-K (avvisas explicit).
 */
function is8KForm(formType: string): boolean {
  return formType.toUpperCase().includes("8-K");
}

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
        error: "INVALID_JSON",
        message: "Request body måste vara giltig JSON",
      },
      { status: 400 }
    );
  }

  const { cik, accessionNumber, document, formType, companyName, ticker } = body;

  // ============================================
  // PARAMETER VALIDATION
  // ============================================

  if (!cik || !accessionNumber || !document || !formType) {
    return NextResponse.json(
      {
        error: "MISSING_PARAMETERS",
        message: "Ange cik, accessionNumber, document och formType",
      },
      { status: 400 }
    );
  }

  // ============================================
  // FORM TYPE GUARD
  // ============================================

  if (is8KForm(formType)) {
    console.log(`[Extract Promises] Rejected 8-K filing: CIK=${cik}, Form=${formType}`);
    return NextResponse.json(
      {
        error: "UNSUPPORTED_FORM_TYPE",
        message: "Välj 10-K eller 10-Q. 8-K saknar ofta analysbart textinnehåll.",
        details: `Form type: ${formType}`,
        suggestion: "8-K filings innehåller vanligtvis endast pressmeddelanden och exhibits. Välj en 10-K (årsredovisning) eller 10-Q (kvartalsrapport) för meningsfull promise extraction.",
      },
      { status: 400 }
    );
  }

  if (!isSupportedFormType(formType)) {
    console.log(`[Extract Promises] Rejected unsupported form: CIK=${cik}, Form=${formType}`);
    return NextResponse.json(
      {
        error: "UNSUPPORTED_FORM_TYPE",
        message: `Form type "${formType}" stöds inte för promise extraction.`,
        details: `Stödda form types: ${SUPPORTED_FORM_TYPES.join(", ")}`,
        suggestion: "Välj en 10-K (årsredovisning) eller 10-Q (kvartalsrapport).",
      },
      { status: 400 }
    );
  }

  // ============================================
  // FETCH AND PARSE FILING
  // ============================================

  try {
    console.log(`[Extract Promises] Processing: CIK=${cik}, Form=${formType}, Accession=${accessionNumber}`);

    // 1. Hämta filing-dokumentet med robust fetch
    const fetchedDoc = await fetchFilingDocument(cik, accessionNumber, document);
    
    if (!fetchedDoc) {
      console.error(`[Extract Promises] Document not found: CIK=${cik}, Accession=${accessionNumber}`);
      return NextResponse.json(
        {
          error: "FILING_NOT_FOUND",
          message: `Dokumentet kunde inte hämtas från SEC EDGAR.`,
          details: `CIK: ${cik}, Accession: ${accessionNumber}, Document: ${document}`,
          suggestion: "Kontrollera att filing finns på SEC EDGAR och försök igen.",
        },
        { status: 404 }
      );
    }
    
    const usedFallback = fetchedDoc.documentName !== document;
    
    if (usedFallback) {
      console.info(`[Extract Promises] Used fallback document: ${fetchedDoc.documentName}`);
    }
    
    console.log(`[Extract Promises] Fetched ${fetchedDoc.content.length} bytes`);

    // 2. Parsa filing och extrahera sektioner
    const parsed = parseFiling(fetchedDoc.content, formType);
    console.log(`[Extract Promises] Parsed: ${parsed.cleanedLength} chars cleaned`);
    console.log(`[Extract Promises] Sections: ${parsed.sections.metadata.sectionsFound.join(", ") || "none"}`);

    // 3. Välj bästa text för analys (prioriterar MD&A)
    const { text: analysisText, source: textSource } = selectBestTextForAnalysis(
      parsed.sections,
      5000 // Minst 5000 tecken för MD&A
    );

    if (analysisText.length < 1000) {
      console.warn(`[Extract Promises] Very short text: ${analysisText.length} chars`);
      return NextResponse.json(
        {
          error: "INSUFFICIENT_CONTENT",
          message: "Dokumentet innehåller för lite analysbar text.",
          details: `Endast ${analysisText.length} tecken hittades. Minst 1000 tecken krävs.`,
          suggestion: "Prova en annan filing eller kontrollera att dokumentet inte är tom/korrupt.",
        },
        { status: 422 }
      );
    }

    console.log(`[Extract Promises] Using ${textSource}: ${analysisText.length} chars`);

    // 4. Extrahera promises med V2 rule-based approach
    const extraction = extractPromises(analysisText, {
      source: textSource,
      formType,
      companyName: companyName || undefined,
      ticker: ticker || undefined,
    });

    console.log(`[Extract Promises] Extracted ${extraction.extractedCount} promises from ${extraction.totalSentences} sentences`);
    console.log(`[Extract Promises] By type: ${JSON.stringify(extraction.summary.byType)}`);

    // 5. Spara till Firestore om konfigurerat
    let savedToFirestore = false;
    let firestoreId: string | undefined;

    if (isFirebaseConfigured()) {
      try {
        const db = getFirestoreDb();
        if (db && extraction.extractedCount > 0) {
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
            textSource,
            textLength: analysisText.length,
            extraction: {
              totalSentences: extraction.totalSentences,
              extractedCount: extraction.extractedCount,
              summary: extraction.summary,
            },
            // Spara endast high/medium confidence promises
            promises: extraction.promises
              .filter((p) => p.confidence !== "low")
              .slice(0, 30) // Max 30 för Firestore
              .map((p) => ({
                text: p.text.slice(0, 500), // Begränsa textlängd
                type: p.type,
                timeHorizon: p.timeHorizon,
                measurable: p.measurable,
                confidence: p.confidence,
                confidenceScore: p.confidenceScore,
                keywords: p.keywords,
                verification: null, // Explicit null istället för undefined
                score: null, // Explicit null istället för undefined
              })),
          };

          // Sanitera innan Firestore write
          const sanitizedDocData = sanitizeForFirestore(docData);
          const docRef = await db.collection(COMPANY_PROMISES_COLLECTION).add(sanitizedDocData);
          console.log("[firestore] sanitized write payload ok");
          firestoreId = docRef.id;
          savedToFirestore = true;
          console.log(`[Extract Promises] Saved to Firestore: ${firestoreId}`);
        }
      } catch (firestoreError) {
        console.error("[Extract Promises] Firestore error:", firestoreError);
        // Fortsätt ändå - Firestore är optional
      }
    } else {
      console.log("[Extract Promises] Firebase not configured, skipping save");
    }

    // 6. Returnera resultat (normaliserat format)
    const responseData = {
      cik: cik.padStart(10, "0"),
      accessionNumber,
      formType,
      companyName: companyName || null,
      ticker: ticker || null,
      documentUsed: fetchedDoc.documentName,
      usedFallback,
      textSource,
      textLength: analysisText.length,
      extraction,
      savedToFirestore,
      firestoreId,
    };
    
    return NextResponse.json({
      ok: true,
      data: responseData,
      // Bakåtkompatibilitet
      ...responseData,
    });

  } catch (error) {
    console.error("[Extract Promises] Error:", error);

    const message = error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    if (message.includes("404")) {
      return NextResponse.json(
        {
          error: "FILING_NOT_FOUND",
          message: `Dokumentet hittades inte på SEC EDGAR`,
          details: `CIK: ${cik}, Accession: ${accessionNumber}`,
        },
        { status: 404 }
      );
    }

    if (message.includes("timeout") || message.includes("Timeout")) {
      return NextResponse.json(
        {
          error: "REQUEST_TIMEOUT",
          message: "SEC EDGAR svarade inte i tid. Försök igen senare.",
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        error: "EXTRACTION_FAILED",
        message,
      },
      { status: 500 }
    );
  }
}
