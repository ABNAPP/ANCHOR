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

export interface FilingIndexFile {
  name: string;
  type?: string;
  size?: number;
  lastModified?: string;
}

export interface FilingIndex {
  directory: {
    item: FilingIndexFile[];
    name: string;
    "parent-dir": string;
  };
}

export interface FetchedDocument {
  content: string;
  sourceUrl: string;
  documentName: string;
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
 * Returnerar null vid 404 istället för att kasta fel.
 */
export async function fetchTextFromSec(url: string): Promise<string | null> {
  await throttle();
  
  const options = createSecFetchOptions("text/html, text/plain, */*");
  
  console.log(`[SEC] Fetching text: ${url}`);
  
  const response = await fetch(url, options);
  
  if (response.status === 404) {
    console.warn(`[SEC] Document not found (404): ${url}`);
    return null;
  }
  
  if (!response.ok) {
    throw new Error(
      `SEC API error: ${response.status} ${response.statusText} for ${url}`
    );
  }
  
  return response.text();
}

/**
 * Hämtar JSON från SEC, returnerar null vid 404.
 */
export async function fetchJsonFromSecSafe<T>(url: string): Promise<T | null> {
  await throttle();
  
  const options = createSecFetchOptions();
  
  console.log(`[SEC] Fetching JSON: ${url}`);
  
  const response = await fetch(url, options);
  
  if (response.status === 404) {
    console.warn(`[SEC] Resource not found (404): ${url}`);
    return null;
  }
  
  if (!response.ok) {
    throw new Error(
      `SEC API error: ${response.status} ${response.statusText} for ${url}`
    );
  }
  
  const data = await response.json();
  return data as T;
}

/**
 * Väntar en specificerad tid.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// CIK & ACCESSION FORMATTING
// ============================================

/**
 * Normaliserar CIK till 10-siffrigt format med ledande nollor.
 */
export function formatCikPadded(cik: string): string {
  return cik.replace(/^0+/, "").padStart(10, "0");
}

/**
 * Konverterar CIK till format utan ledande nollor (för Archives-URL:er).
 */
export function formatCikNoZeros(cik: string): string {
  return parseInt(cik.replace(/^0+/, ""), 10).toString();
}

/**
 * Tar bort bindestreck från accession number.
 */
export function formatAccessionNoHyphens(accessionNumber: string): string {
  return accessionNumber.replace(/-/g, "");
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
  const paddedCik = formatCikPadded(cik);
  
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
 * Filtrerar bort framtida filings (som ännu inte är publicerade på EDGAR).
 */
export async function getCompanyFilings(
  cik: string,
  formTypes: string[] = ["10-K", "10-Q", "8-K"]
): Promise<FilingInfo[]> {
  const submissions = await getCompanySubmissions(cik);
  const recent = submissions.filings.recent;
  
  const filings: FilingInfo[] = [];
  const formTypesUpper = formTypes.map(f => f.toUpperCase());
  
  // Dagens datum för att filtrera bort framtida filings
  const today = new Date();
  today.setHours(23, 59, 59, 999); // Inkludera hela dagens filings
  
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i].toUpperCase();
    const filingDate = recent.filingDate[i];
    
    // Filtrera bort framtida filings
    const filingDateObj = new Date(filingDate);
    if (filingDateObj > today) {
      continue; // Hoppa över framtida filings
    }
    
    if (formTypesUpper.includes(form)) {
      filings.push({
        accessionNumber: recent.accessionNumber[i],
        filingDate: filingDate,
        reportDate: recent.reportDate[i] || filingDate,
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
 * Bygger bas-URL till ett filing-arkiv (utan dokumentnamn).
 * OBS: Använder www.sec.gov (inte data.sec.gov) för Archives.
 */
export function buildFilingArchiveUrl(cik: string, accessionNumber: string): string {
  const cikNoZeros = formatCikNoZeros(cik);
  const accessionNo = formatAccessionNoHyphens(accessionNumber);
  
  // Använd www.sec.gov för Archives - data.sec.gov ger ofta 404
  return `${SEC_API.WWW}/Archives/edgar/data/${cikNoZeros}/${accessionNo}`;
}

/**
 * Bygger URL till ett specifikt filing-dokument.
 */
export function buildFilingDocumentUrl(cik: string, accessionNumber: string, document: string): string {
  const archiveUrl = buildFilingArchiveUrl(cik, accessionNumber);
  return `${archiveUrl}/${document}`;
}

/**
 * Hämtar index.json för en filing (listar alla filer i arkivet).
 */
export async function getFilingIndex(cik: string, accessionNumber: string): Promise<FilingIndex | null> {
  const archiveUrl = buildFilingArchiveUrl(cik, accessionNumber);
  const indexUrl = `${archiveUrl}/index.json`;
  
  console.log(`[SEC] Fetching filing index: ${indexUrl}`);
  
  return fetchJsonFromSecSafe<FilingIndex>(indexUrl);
}

/**
 * Hittar det primära HTML-dokumentet från ett filing-index.
 * Prioriterar .htm/.html-filer, undviker *_def.htm och -index.htm.
 */
export function findPrimaryHtmlDocument(index: FilingIndex): string | null {
  const items = index.directory.item;
  
  // Filtrera till HTML-filer
  const htmlFiles = items.filter(item => {
    const name = item.name.toLowerCase();
    return (name.endsWith(".htm") || name.endsWith(".html")) &&
           !name.includes("_def.") &&
           !name.endsWith("-index.htm") &&
           !name.endsWith("-index.html") &&
           !name.startsWith("R") && // Undvik R1.htm, R2.htm etc (XBRL rendering)
           !name.includes("Financial_Report"); // Undvik XBRL Financial Report
  });
  
  if (htmlFiles.length === 0) {
    return null;
  }
  
  // Sortera: föredra filer utan siffror i början (vanligtvis huvuddokumentet)
  // och större filer (huvuddokument är ofta störst)
  htmlFiles.sort((a, b) => {
    // Prioritera filer som börjar med företagsnamn/ticker
    const aStartsWithLetter = /^[a-z]/i.test(a.name);
    const bStartsWithLetter = /^[a-z]/i.test(b.name);
    if (aStartsWithLetter && !bStartsWithLetter) return -1;
    if (!aStartsWithLetter && bStartsWithLetter) return 1;
    
    // Sedan efter storlek (större = troligare huvuddokument)
    const aSize = a.size || 0;
    const bSize = b.size || 0;
    return bSize - aSize;
  });
  
  return htmlFiles[0].name;
}

/**
 * Hämtar innehållet i ett filing-dokument med fallback via index.json.
 * 
 * Logik:
 * 1. Försök hämta primaryDocument direkt
 * 2. Om 404: hämta index.json och välj första .htm/.html-fil
 * 3. Om fortfarande 404: returnera null
 */
export async function fetchFilingDocument(
  cik: string, 
  accessionNumber: string, 
  primaryDocument: string
): Promise<FetchedDocument | null> {
  const cikNoZeros = formatCikNoZeros(cik);
  const accessionNo = formatAccessionNoHyphens(accessionNumber);
  
  // Steg 1: Försök med primaryDocument
  const primaryUrl = buildFilingDocumentUrl(cik, accessionNumber, primaryDocument);
  console.log(`[SEC] Attempting to fetch primary document: ${primaryUrl}`);
  
  const primaryContent = await fetchTextFromSec(primaryUrl);
  
  if (primaryContent !== null) {
    console.log(`[SEC] Successfully fetched primary document: ${primaryDocument}`);
    return {
      content: primaryContent,
      sourceUrl: primaryUrl,
      documentName: primaryDocument,
    };
  }
  
  // Steg 2: primaryDocument misslyckades, prova index.json fallback
  console.warn(`[SEC] Primary document not found, trying index.json fallback...`);
  
  const index = await getFilingIndex(cik, accessionNumber);
  
  if (!index) {
    console.error(`[SEC] Could not fetch index.json for CIK ${cikNoZeros}, Accession ${accessionNo}`);
    return null;
  }
  
  // Hitta alternativt HTML-dokument
  const fallbackDoc = findPrimaryHtmlDocument(index);
  
  if (!fallbackDoc) {
    console.error(`[SEC] No suitable HTML document found in index.json`);
    console.log(`[SEC] Available files: ${index.directory.item.map(i => i.name).join(", ")}`);
    return null;
  }
  
  console.info(`[SEC] Using fallback document: ${fallbackDoc}`);
  
  const fallbackUrl = buildFilingDocumentUrl(cik, accessionNumber, fallbackDoc);
  const fallbackContent = await fetchTextFromSec(fallbackUrl);
  
  if (fallbackContent !== null) {
    console.log(`[SEC] Successfully fetched fallback document: ${fallbackDoc}`);
    return {
      content: fallbackContent,
      sourceUrl: fallbackUrl,
      documentName: fallbackDoc,
    };
  }
  
  console.error(`[SEC] Failed to fetch fallback document: ${fallbackDoc}`);
  return null;
}

/**
 * Äldre funktion - behålls för bakåtkompatibilitet.
 * Använd fetchFilingDocument för robust hämtning med fallback.
 */
export async function getFilingDocument(
  cik: string, 
  accessionNumber: string, 
  document: string
): Promise<string> {
  const result = await fetchFilingDocument(cik, accessionNumber, document);
  
  if (!result) {
    throw new Error(`Could not fetch filing document: ${document}`);
  }
  
  return result.content;
}

// ============================================
// COMPANY FACTS (XBRL) - Cached 24h
// ============================================

const companyFactsCache = new Map<string, CacheEntry<CompanyFactsResponse>>();

/**
 * SEC Company Facts Response Type (förenklad)
 */
export interface CompanyFactsResponse {
  cik: number;
  entityName: string;
  facts: {
    "us-gaap"?: Record<string, FactData>;
    "dei"?: Record<string, FactData>;
    [key: string]: Record<string, FactData> | undefined;
  };
}

export interface FactData {
  label: string;
  description: string;
  units: Record<string, FactUnit[]>;
}

export interface FactUnit {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy: number;
  fp: string;
  form: string;
  filed: string;
  frame?: string;
}

/**
 * Hämtar company facts (XBRL data) för ett företag.
 * Cachas i 24 timmar.
 * 
 * @param cik - CIK-nummer (med eller utan ledande nollor)
 * @returns CompanyFactsResponse med alla XBRL facts
 */
export async function fetchCompanyFacts(cik: string): Promise<CompanyFactsResponse> {
  const paddedCik = formatCikPadded(cik);
  
  // Kolla cache
  const cached = companyFactsCache.get(paddedCik);
  if (isCacheValid(cached)) {
    console.log(`[SEC] Using cached company facts for CIK ${paddedCik}`);
    return cached.data;
  }
  
  console.log(`[SEC] Fetching company facts for CIK ${paddedCik}...`);
  const url = `${SEC_API.DATA}/api/xbrl/companyfacts/CIK${paddedCik}.json`;
  const data = await fetchFromSec<CompanyFactsResponse>(url);
  
  // Cacha resultatet
  companyFactsCache.set(paddedCik, {
    data,
    timestamp: Date.now(),
  });
  
  console.log(`[SEC] Company facts cached for ${data.entityName}`);
  return data;
}

/**
 * Äldre funktion - behålls för bakåtkompatibilitet.
 * Använd fetchCompanyFacts för typad respons.
 */
export async function getCompanyFacts(cik: string): Promise<Record<string, unknown>> {
  const result = await fetchCompanyFacts(cik);
  return result as unknown as Record<string, unknown>;
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
