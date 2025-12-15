/**
 * SEC/EDGAR API Konfiguration
 * 
 * SEC kräver att alla API-anrop har en User-Agent header med kontaktinfo.
 * Se: https://www.sec.gov/os/webmaster-faq#code-support
 */

const DEFAULT_USER_AGENT = "ANCHOR (EDGAR client) admin@abnapp.com";

let hasWarnedAboutMissingEnv = false;

/**
 * Hämtar User-Agent-strängen för SEC/EDGAR API-anrop.
 * 
 * Läser från miljövariabeln SEC_USER_AGENT.
 * Om den saknas, returneras en fallback och en varning loggas (endast en gång).
 * 
 * @returns User-Agent sträng i format: "AppName (Version) email@domain.com"
 */
export function getSecUserAgent(): string {
  const userAgent = process.env.SEC_USER_AGENT;
  
  if (userAgent && userAgent.trim().length > 0) {
    return userAgent.trim();
  }
  
  // Logga varning endast en gång per serverstart
  if (!hasWarnedAboutMissingEnv) {
    console.warn(
      "[SEC] SEC_USER_AGENT saknas. Använder fallback. " +
      "Sätt SEC_USER_AGENT i .env.local och i Vercel env."
    );
    hasWarnedAboutMissingEnv = true;
  }
  
  return DEFAULT_USER_AGENT;
}

/**
 * Kontrollerar om SEC_USER_AGENT är konfigurerad i miljövariabler.
 * 
 * @returns true om miljövariabeln är satt, false annars
 */
export function isSecUserAgentConfigured(): boolean {
  const userAgent = process.env.SEC_USER_AGENT;
  return !!(userAgent && userAgent.trim().length > 0);
}

/**
 * SEC API-basadresser
 */
export const SEC_API = {
  /** Huvud-API för filings, submissions, etc. */
  DATA: "https://data.sec.gov",
  
  /** WWW för statiska filer som company_tickers.json */
  WWW: "https://www.sec.gov",
  
  /** Arkiv för fullständiga filings */
  ARCHIVES: "https://www.sec.gov/cgi-bin/browse-edgar",
  
  /** EFTS - Full Text Search */
  EFTS: "https://efts.sec.gov",
} as const;

