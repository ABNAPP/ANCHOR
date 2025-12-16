/**
 * Company Facts API (KPI via XBRL)
 * 
 * GET /api/company/facts?cik=CIK10
 * 
 * Hämtar numeriska KPI:er från SEC XBRL Company Facts.
 * Gratis API som bara kräver SEC_USER_AGENT.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchCompanyFacts, formatCikPadded } from "@/lib/sec/client";
import { extractKpisFromCompanyFacts, KpiExtractionResult } from "@/lib/company/kpis";

// ============================================
// TYPES
// ============================================

export interface FactsSuccessResponse {
  ok: true;
  data: KpiExtractionResult & { cached: boolean };
}

export interface FactsErrorResponse {
  ok: false;
  error: {
    message: string;
    code: string;
    details?: string;
  };
}

type FactsResponse = FactsSuccessResponse | FactsErrorResponse;

// ============================================
// HANDLER
// ============================================

export async function GET(
  request: NextRequest
): Promise<NextResponse<FactsResponse & Partial<KpiExtractionResult>>> {
  const { searchParams } = new URL(request.url);
  const cik = searchParams.get("cik");

  // Validera CIK
  if (!cik) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          message: "CIK-parameter krävs. Ange cik=XXXXXXXXXX",
          code: "MISSING_CIK",
        },
      },
      { status: 400 }
    );
  }

  // Normalisera CIK
  const cik10 = formatCikPadded(cik);

  try {
    console.log(`[Facts API] Fetching company facts for CIK ${cik10}`);

    // Hämta company facts från SEC (cachas i 24h)
    const factsJson = await fetchCompanyFacts(cik10);

    // Extrahera KPIs
    const result = extractKpisFromCompanyFacts(factsJson);

    console.log(
      `[Facts API] Extracted ${result.summary.totalKpis} KPIs ` +
      `(${result.summary.uniqueMetrics} unique metrics) for ${result.companyName}`
    );

    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        cached: false, // Cached status handled internally
      },
      // Bakåtkompatibilitet
      ...result,
      cached: false,
    });

  } catch (error) {
    console.error("[Facts API] Error:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Kategorisera felet
    let httpStatus = 500;
    let errorCode = "FACTS_FETCH_FAILED";
    let userMessage = "Kunde inte hämta KPI-data. Försök igen.";
    let details: string | undefined = errorMessage;

    // SEC returnerade 404 - bolaget har inte XBRL-rapportering
    if (errorMessage.includes("404")) {
      httpStatus = 404;
      errorCode = "COMPANY_NOT_FOUND";
      userMessage = `Inga XBRL facts hittades för CIK ${cik10}. Bolaget kanske inte har XBRL-rapportering.`;
      details = `CIK: ${cik10}. SEC returnerade 404 för companyfacts endpoint.`;
    }
    
    // Nätverksfel / SEC ej nåbar
    else if (
      errorMessage.includes("fetch failed") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ETIMEDOUT") ||
      errorMessage.includes("network") ||
      errorMessage.includes("Network")
    ) {
      httpStatus = 502;
      errorCode = "SEC_UNREACHABLE";
      userMessage = "Kunde inte nå SEC EDGAR. Kontrollera din internetanslutning eller VPN.";
      details = `SEC API är inte tillgänglig. Original error: ${errorMessage}`;
    }
    
    // Timeout
    else if (
      errorMessage.includes("timeout") ||
      errorMessage.includes("Timeout") ||
      errorMessage.includes("AbortError")
    ) {
      httpStatus = 504;
      errorCode = "REQUEST_TIMEOUT";
      userMessage = "SEC EDGAR svarade inte i tid. Försök igen senare.";
      details = "Request timeout efter 15 sekunder";
    }
    
    // SEC returnerade annat fel
    else if (errorMessage.includes("SEC API error")) {
      const statusMatch = errorMessage.match(/(\d{3})/);
      if (statusMatch) {
        const secStatus = parseInt(statusMatch[1]);
        if (secStatus === 403) {
          httpStatus = 403;
          errorCode = "SEC_FORBIDDEN";
          userMessage = "SEC blockerade anropet. Kontrollera att SEC_USER_AGENT är korrekt konfigurerad.";
        } else if (secStatus === 429) {
          httpStatus = 429;
          errorCode = "RATE_LIMITED";
          userMessage = "För många anrop till SEC. Vänta en minut och försök igen.";
        } else {
          httpStatus = 502;
          errorCode = "SEC_ERROR";
          userMessage = `SEC returnerade fel (${secStatus}). Försök igen senare.`;
        }
      }
    }
    
    // JSON parse-fel
    else if (
      errorMessage.includes("JSON") ||
      errorMessage.includes("Unexpected token")
    ) {
      httpStatus = 502;
      errorCode = "INVALID_RESPONSE";
      userMessage = "SEC returnerade ogiltigt svar. Försök igen senare.";
    }

    console.error(`[Facts API] Categorized error: ${errorCode} (${httpStatus})`);
    if (errorStack) {
      console.error(`[Facts API] Stack: ${errorStack.split('\n').slice(0, 3).join('\n')}`);
    }

    return NextResponse.json(
      {
        ok: false,
        error: {
          message: userMessage,
          code: errorCode,
          details,
        },
      },
      { status: httpStatus }
    );
  }
}
