/**
 * SEC/EDGAR API Client
 * 
 * Klient för att hämta data från SEC EDGAR.
 * Alla anrop använder User-Agent header enligt SEC:s krav.
 * 
 * SEC Rate Limits:
 * - Max 10 requests per sekund
 * - Vi använder max 5 rps för säkerhets skull (200ms delay)
 * 
 * Caching:
 * - company_tickers.json: 24h TTL
 * - submissions: 24h TTL
 */

import { getSecUserAgent, SEC_API } from "./config";

// ============================================
// TYPES
// ============================================

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

export interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

export interface SecSearchResult {
  cik: string;
  ticker: string;
  name: string;
}

export interface FilingInfo {
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form: string;
  primaryDocument: string;
  size: number;
}

// ============================================
// CACHING
// ============================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 timmar

// Cache för ticker map och submissions
let tickerMapCache: CacheEntry<Record<string, SecTickerEntry>> | null = null;
const submissionsCache = new Map<string, CacheEntry<SecCompanyInfo>>();

function isCacheValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

// ============================================
// THROTTLING (Max 5 rps)
// ============================================

const MIN_REQUEST_INTERVAL_MS = 200; // 5 rps max
let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest);
  }
  
  lastRequestTime = Date.now();
}

// ============================================
// FETCH UTILITIES
// ============================================

const REQUEST_TIMEOUT_MS = 15000;

function createSecFetchOptions(accept: string = "application/json"): RequestInit {
  const userAgent = getSecUserAgent();
  
  return {
    method: "GET",
    headers: {
      "User-Agent": userAgent,
      "Accept": accept,
      "Accept-Encoding": "gzip, deflate",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

/**
 * Gör ett API-anrop till SEC/EDGAR med korrekt User-Agent och throttling.
 */
export async function fetchFromSec<T>(url: string): Promise<T> {
  await throttle();
  
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
 * Hämtar text/HTML från SEC med korrekt User-Agent och throttling.
 */
export async function fetchTextFromSec(url: string): Promise<string> {
  await throttle();
  
  const options = createSecFetchOptions("text/html, text/plain, */*");
  
  console.log(`[SEC] Fetching text: ${url}`);
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(
      `SEC API error: ${response.status} ${response.statusText} for ${url}`
    );
  }
  
  return response.text();
}

/**
 * Väntar en specificerad tid.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// TICKER MAP (cached 24h)
// ============================================

async function getTickerMap(): Promise<Record<string, SecTickerEntry>> {
  if (isCacheValid(tickerMapCache)) {
    console.log("[SEC] Using cached ticker map");
    return tickerMapCache.data;
  }

  console.log("[SEC] Fetching fresh ticker map...");
  // company_tickers.json finns på www.sec.gov, inte data.sec.gov
  const url = `${SEC_API.WWW}/files/company_tickers.json`;
  const data = await fetchFromSec<Record<string, SecTickerEntry>>(url);
  
  tickerMapCache = {
    data,
    timestamp: Date.now(),
  };
  
  console.log(`[SEC] Ticker map cached with ${Object.keys(data).length} entries`);
  return data;
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Söker efter bolag baserat på ticker eller namn.
 * Returnerar max 50 resultat.
 */
export async function searchCompanies(query: string): Promise<SecSearchResult[]> {
  const tickerMap = await getTickerMap();
  const results: SecSearchResult[] = [];
  const upperQuery = query.toUpperCase();
  const lowerQuery = query.toLowerCase();
  
  for (const entry of Object.values(tickerMap)) {
    const tickerMatch = entry.ticker.toUpperCase().includes(upperQuery);
    const nameMatch = entry.title.toLowerCase().includes(lowerQuery);
    
    if (tickerMatch || nameMatch) {
      results.push({
        cik: entry.cik_str.toString().padStart(10, "0"),
        ticker: entry.ticker,
        name: entry.title,
      });
    }
    
    if (results.length >= 50) break;
  }
  
  // Sortera: exakt ticker-match först
  results.sort((a, b) => {
    const aExact = a.ticker.toUpperCase() === upperQuery;
    const bExact = b.ticker.toUpperCase() === upperQuery;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return a.ticker.localeCompare(b.ticker);
  });
  
  return results;
}

/**
 * Hämtar CIK baserat på ticker symbol.
 */
export async function getCikByTicker(ticker: string): Promise<string | null> {
  const tickerMap = await getTickerMap();
  const upperTicker = ticker.toUpperCase();
  
  for (const entry of Object.values(tickerMap)) {
    if (entry.ticker === upperTicker) {
      return entry.cik_str.toString().padStart(10, "0");
    }
  }
  
  return null;
}

/**
 * Hämtar företagsinformation och filings från SEC EDGAR submissions.
 * Cachas i 24h.
 */
export async function getCompanySubmissions(cik: string): Promise<SecCompanyInfo> {
  const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
  
  // Kolla cache
  const cached = submissionsCache.get(paddedCik);
  if (isCacheValid(cached)) {
    console.log(`[SEC] Using cached submissions for CIK ${paddedCik}`);
    return cached.data;
  }
  
  console.log(`[SEC] Fetching submissions for CIK ${paddedCik}...`);
  const url = `${SEC_API.DATA}/submissions/CIK${paddedCik}.json`;
  const data = await fetchFromSec<SecCompanyInfo>(url);
  
  // Cacha resultatet
  submissionsCache.set(paddedCik, {
    data,
    timestamp: Date.now(),
  });
  
  return data;
}

/**
 * Hämtar filings för ett bolag, filtrerat på form-typ.
 */
export async function getCompanyFilings(
  cik: string,
  formTypes: string[] = ["10-K", "10-Q", "8-K"]
): Promise<FilingInfo[]> {
  const submissions = await getCompanySubmissions(cik);
  const recent = submissions.filings.recent;
  
  const filings: FilingInfo[] = [];
  const formTypesUpper = formTypes.map(f => f.toUpperCase());
  
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i].toUpperCase();
    
    if (formTypesUpper.includes(form)) {
      filings.push({
        accessionNumber: recent.accessionNumber[i],
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate[i] || recent.filingDate[i],
        form: recent.form[i],
        primaryDocument: recent.primaryDocument[i],
        size: recent.size[i],
      });
    }
    
    if (filings.length >= 100) break;
  }
  
  return filings;
}

/**
 * Bygger URL till ett filing-dokument.
 */
export function buildFilingDocumentUrl(cik: string, accessionNumber: string, document: string): string {
  const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
  const accessionClean = accessionNumber.replace(/-/g, "");
  
  return `${SEC_API.DATA}/Archives/edgar/data/${paddedCik}/${accessionClean}/${document}`;
}

/**
 * Hämtar innehållet i ett filing-dokument.
 */
export async function getFilingDocument(cik: string, accessionNumber: string, document: string): Promise<string> {
  const url = buildFilingDocumentUrl(cik, accessionNumber, document);
  return fetchTextFromSec(url);
}

/**
 * Hämtar company facts (XBRL data) för ett företag.
 */
export async function getCompanyFacts(cik: string): Promise<Record<string, unknown>> {
  const paddedCik = cik.replace(/^0+/, "").padStart(10, "0");
  const url = `${SEC_API.DATA}/api/xbrl/companyfacts/CIK${paddedCik}.json`;
  return fetchFromSec<Record<string, unknown>>(url);
}

/**
 * Gör flera SEC-anrop med automatisk throttling.
 */
export async function fetchMultipleFromSec<T>(urls: string[]): Promise<T[]> {
  const results: T[] = [];
  
  for (const url of urls) {
    const result = await fetchFromSec<T>(url);
    results.push(result);
  }
  
  return results;
}
