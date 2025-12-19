import { FredSeriesResult } from "../fred/client";
import { 
  getLatestValidValue, 
  calculateChangeFromNBack,
  getLatestCommonDate,
  calculateYearOverYearChange
} from "./align";

export interface MacroFeatures {
  asOf: string;
  latest: Record<string, number | null>;
  latestDates: Record<string, string | null>;
  chg20d: Record<string, number | null>;
  slope10y2y: number | null;
  cpiStale?: boolean; // Flagga om CPI är stale (>45 dagar)
}

/**
 * Beräknar macro-features från FRED-serier
 * 
 * Features:
 * - latest: Senaste värdet för varje serie
 * - chg20d: Förändring från 20 datapunkter bakåt (approximativt 20 handelsdagar)
 *   EXCEPT för CPI som använder YoY (Year-over-Year)
 * - slope10y2y: DGS10 - DGS2 (yield curve slope)
 * - cpiStale: true om CPI är äldre än 45 dagar
 * 
 * CONTRACT: Förändringsfönster per serie:
 * - Dagliga serier (DGS10, DGS2, VIX, BAMLH0A0HYM2): 20 trading days
 * - CPI (CPIAUCSL): YoY (Year-over-Year)
 */
export function calculateFeatures(
  seriesMap: Map<string, FredSeriesResult>
): MacroFeatures {
  const latest: Record<string, number | null> = {};
  const latestDates: Record<string, string | null> = {};
  const chg20d: Record<string, number | null> = {};

  // Beräkna senaste värden och förändring för varje serie
  for (const [seriesId, series] of seriesMap.entries()) {
    const latestVal = getLatestValidValue(series.observations);
    latest[seriesId] = latestVal?.value ?? null;
    latestDates[seriesId] = latestVal?.date ?? null;

    // CONTRACT: CPI använder YoY, alla andra använder 20-dagars förändring
    if (seriesId === "CPIAUCSL") {
      // CPI: Year-over-Year förändring
      chg20d[seriesId] = calculateYearOverYearChange(series.observations);
    } else {
      // Dagliga serier: 20-dagars förändring (20 datapunkter med giltiga värden)
      chg20d[seriesId] = calculateChangeFromNBack(series.observations, 20);
    }
  }

  // Beräkna yield curve slope (10Y - 2Y)
  let slope10y2y: number | null = null;
  const dgs10 = latest["DGS10"];
  const dgs2 = latest["DGS2"];

  if (dgs10 !== null && dgs2 !== null) {
    slope10y2y = dgs10 - dgs2;
  }

  // CONTRACT: asOf = senaste gemensamma datum där alla dagliga serier finns
  // CPI tillåts vara stale
  let asOf = getLatestCommonDate(seriesMap);
  
  if (!asOf) {
    // Fallback: hitta det senaste datumet från någon serie
    for (const series of seriesMap.values()) {
      const latestVal = getLatestValidValue(series.observations);
      if (latestVal && (!asOf || latestVal.date > asOf)) {
        asOf = latestVal.date;
      }
    }
  }

  // CONTRACT: Flagga CPI som stale om äldre än 45 dagar
  const cpiDate = latestDates["CPIAUCSL"];
  let cpiStale = false;
  if (cpiDate && asOf) {
    const cpiDateObj = new Date(cpiDate);
    const asOfDateObj = new Date(asOf);
    const daysDiff = Math.floor((asOfDateObj.getTime() - cpiDateObj.getTime()) / (1000 * 60 * 60 * 24));
    cpiStale = daysDiff > 45;
  }

  return {
    asOf: asOf || new Date().toISOString().split("T")[0],
    latest,
    latestDates,
    chg20d,
    slope10y2y,
    cpiStale,
  };
}

/**
 * Formaterar ett tal till läsbart format
 */
export function formatValue(value: number | null, decimals: number = 2): string {
  if (value === null) {
    return "N/A";
  }
  return value.toFixed(decimals);
}

/**
 * Formaterar förändring med + eller - prefix
 */
export function formatChange(value: number | null, decimals: number = 2): string {
  if (value === null) {
    return "N/A";
  }
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}`;
}
