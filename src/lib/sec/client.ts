/**
 * SEC/EDGAR API Client
 * 
 * Klient för att hämta data från SEC EDGAR.
 * Alla anrop använder User-Agent header enligt SEC:s krav.
 * 
 * SEC Rate Limits:
 * - Max 10 requests per sekund
 * - Rekommenderat att vänta 100ms mellan anrop
 */

import { getSecUserAgent, SEC_API } from "./config";

/**
 * Interface för SEC Company info från submissions endpoint
 */
export interface SecCompanyInfo {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  ein: string;
  fiscalYearEnd: string;
  stateOfIncorporation: string;
  stateOfIncorporationDescription: string;
  addresses: {
    mailing: SecAddress;
    business: SecAddress;
  };
  filings: {
    recent: SecRecentFilings;
  };
}

export interface SecAddress {
  street1: string;
  street2: string | null;
  city: string;
  stateOrCountry: string;
  zipCode: string;
  stateOrCountryDescription: string;
}

export interface SecRecentFilings {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[];
  fileNumber: string[];
  filmNumber: string[];
  items: string[];
  size: number[];
  isXBRL: number[];
  isInlineXBRL: number[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

/**
 * Request timeout i millisekunder
 */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Skapar fetch-options med SEC-kompatibla headers.
 * 
 * @param additionalHeaders Extra headers att inkludera
 * @returns RequestInit objekt med korrekta headers
 */
function createSecFetchOptions(additionalHeaders: Record<string, string> = {}): RequestInit {
  const userAgent = getSecUserAgent();
  
  return {
    method: "GET",
    headers: {
      "User-Agent": userAgent,
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate",
      ...additionalHeaders,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

/**
 * Gör ett API-anrop till SEC/EDGAR med korrekt User-Agent.
 * 
 * @param url Full URL till SEC-endpointen
 * @returns JSON-response från SEC
 * @throws Error vid nätverksfel, timeout eller icke-2xx status
 */
export async function fetchFromSec<T>(url: string): Promise<T> {
  const options = createSecFetchOptions();
  
  console.log(`[SEC] Fetching: ${url}`);
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(
      `SEC API error: ${response.status} ${response.statusText} for ${url}`
    );
  }
  
  const data = await response.json();
  return data as T;
}

/**
 * Hämtar företagsinformation och filings från SEC EDGAR submissions.
 * 
 * @param cik CIK-nummer (med eller utan ledande nollor)
 * @returns Företagsinformation med recent filings
 */
export async function getCompanySubmissions(cik: string): Promise<SecCompanyInfo> {
  // CIK ska vara 10 siffror med ledande nollor
  const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
  
  const url = `${SEC_API.DATA}/submissions/CIK${paddedCik}.json`;
  
  return fetchFromSec<SecCompanyInfo>(url);
}

/**
 * Hämtar company facts (XBRL data) för ett företag.
 * 
 * @param cik CIK-nummer
 * @returns Company facts med finansiell data
 */
export async function getCompanyFacts(cik: string): Promise<Record<string, unknown>> {
  const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
  
  const url = `${SEC_API.DATA}/api/xbrl/companyfacts/CIK${paddedCik}.json`;
  
  return fetchFromSec<Record<string, unknown>>(url);
}

/**
 * Söker efter CIK baserat på ticker symbol.
 * 
 * @param ticker Aktiesymbol (t.ex. "AAPL")
 * @returns CIK-nummer eller null om inte hittat
 */
export async function getCikByTicker(ticker: string): Promise<string | null> {
  const url = `${SEC_API.DATA}/submissions/CIK0000000000.json`;
  
  // SEC har en company_tickers.json som mappar ticker -> CIK
  const tickerMapUrl = `${SEC_API.DATA}/files/company_tickers.json`;
  
  try {
    const data = await fetchFromSec<Record<string, { cik_str: number; ticker: string; title: string }>>(
      tickerMapUrl
    );
    
    const upperTicker = ticker.toUpperCase();
    
    for (const entry of Object.values(data)) {
      if (entry.ticker === upperTicker) {
        return entry.cik_str.toString().padStart(10, "0");
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[SEC] Could not fetch ticker map:`, error);
    return null;
  }
}

/**
 * Väntar en specificerad tid (för rate limiting).
 * 
 * @param ms Millisekunder att vänta
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gör flera SEC-anrop med rate limiting (100ms mellan varje).
 * 
 * @param urls Lista med URLs att hämta
 * @returns Array med responses
 */
export async function fetchMultipleFromSec<T>(urls: string[]): Promise<T[]> {
  const results: T[] = [];
  
  for (let i = 0; i < urls.length; i++) {
    if (i > 0) {
      // SEC rekommenderar 100ms mellan anrop
      await sleep(100);
    }
    
    const result = await fetchFromSec<T>(urls[i]);
    results.push(result);
  }
  
  return results;
}

