/**
 * Extract Promises API
 * 
 * POST /api/company/extract-promises
 * 
 * Extraherar "promises" och "claims" från ett SEC filing.
 * Sparar resultatet i Firestore om konfigurerat.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFilingDocument } from "@/lib/sec/client";
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
  extraction: PromiseExtractionResult;
  savedToFirestore: boolean;
  firestoreId?: string;
}

export interface ExtractPromisesError {
  error: string;
  message: string;
}

const COMPANY_PROMISES_COLLECTION = "company_promises";

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

  try {
    console.log(`[Extract Promises] Processing: CIK=${cik}, Form=${formType}`);

    // 1. Hämta filing-dokumentet
    const rawContent = await getFilingDocument(cik, accessionNumber, document);
    console.log(`[Extract Promises] Fetched ${rawContent.length} bytes`);

    // 2. Parsa filing
    const parsed = parseFiling(rawContent, formType);
    console.log(`[Extract Promises] Parsed ${parsed.sections.length} sections`);

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
            document,
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
          message: `Dokumentet hittades inte`,
        },
        { status: 404 }
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

