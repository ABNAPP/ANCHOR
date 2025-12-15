/**
 * Company Filings API
 * 
 * GET /api/company/filings?cik=<cik>&forms=10-K,10-Q,8-K
 * 
 * Hämtar filings för ett bolag från SEC EDGAR.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCompanySubmissions, getCompanyFilings, FilingInfo } from "@/lib/sec/client";

export interface CompanyFilingsResponse {
  cik: string;
  companyName: string;
  tickers: string[];
  formTypes: string[];
  filingCount: number;
  filings: FilingInfo[];
}

export interface CompanyFilingsError {
  error: string;
  message: string;
}

const DEFAULT_FORM_TYPES = ["10-K", "10-Q", "8-K"];

export async function GET(
  request: NextRequest
): Promise<NextResponse<CompanyFilingsResponse | CompanyFilingsError>> {
  const searchParams = request.nextUrl.searchParams;
  const cik = searchParams.get("cik")?.trim();
  const formsParam = searchParams.get("forms")?.trim();

  if (!cik) {
    return NextResponse.json(
      {
        error: "Missing CIK",
        message: "Ange CIK-nummer (parameter: cik)",
      },
      { status: 400 }
    );
  }

  const formTypes = formsParam
    ? formsParam.split(",").map((f) => f.trim().toUpperCase())
    : DEFAULT_FORM_TYPES;

  try {
    console.log(`[Company Filings] Fetching for CIK ${cik}, forms: ${formTypes.join(", ")}`);

    const submissions = await getCompanySubmissions(cik);
    const filings = await getCompanyFilings(cik, formTypes);

    console.log(`[Company Filings] Found ${filings.length} filings`);

    return NextResponse.json({
      cik: cik.padStart(10, "0"),
      companyName: submissions.name,
      tickers: submissions.tickers,
      formTypes,
      filingCount: filings.length,
      filings,
    });
  } catch (error) {
    console.error("[Company Filings] Error:", error);

    const message =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    if (message.includes("404")) {
      return NextResponse.json(
        {
          error: "Company not found",
          message: `Inget bolag hittades med CIK ${cik}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: "Filings fetch failed",
        message,
      },
      { status: 500 }
    );
  }
}

