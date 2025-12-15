/**
 * Company Search API
 * 
 * GET /api/company/search?q=<query>
 * 
 * Söker efter bolag via SEC EDGAR baserat på ticker eller namn.
 */

import { NextRequest, NextResponse } from "next/server";
import { searchCompanies, SecSearchResult } from "@/lib/sec/client";

export interface CompanySearchResponse {
  query: string;
  count: number;
  results: SecSearchResult[];
}

export interface CompanySearchError {
  error: string;
  message: string;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<CompanySearchResponse | CompanySearchError>> {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim();

  if (!query || query.length < 1) {
    return NextResponse.json(
      {
        error: "Invalid query",
        message: "Ange minst 1 tecken för sökning (parameter: q)",
      },
      { status: 400 }
    );
  }

  try {
    console.log(`[Company Search] Searching for: "${query}"`);
    
    const results = await searchCompanies(query);

    console.log(`[Company Search] Found ${results.length} results`);

    return NextResponse.json({
      query,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("[Company Search] Error:", error);

    const message =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    return NextResponse.json(
      {
        error: "Search failed",
        message,
      },
      { status: 500 }
    );
  }
}

