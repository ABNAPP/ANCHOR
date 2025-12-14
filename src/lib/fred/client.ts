export interface FredObservation {
  date: string;
  value: number | null;
}

export interface FredSeriesResult {
  seriesId: string;
  observations: FredObservation[];
}

export interface FredApiResponse {
  observations?: Array<{
    date: string;
    value: string;
  }>;
  error_code?: number;
  error_message?: string;
}

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";
const FETCH_TIMEOUT_MS = 15000;

/**
 * Hämtar tidsseriedata från FRED API
 * @param seriesId - FRED serie-ID (t.ex. "DGS10")
 * @param apiKey - FRED API-nyckel
 * @param startDate - Startdatum i formatet YYYY-MM-DD
 * @returns Seriedata med observations
 */
export async function fetchFredSeries(
  seriesId: string,
  apiKey: string,
  startDate: string
): Promise<FredSeriesResult> {
  const url = new URL(FRED_BASE_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("observation_start", startDate);
  url.searchParams.set("sort_order", "asc");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `FRED API fel för ${seriesId}: HTTP ${response.status} ${response.statusText}`
      );
    }

    const data: FredApiResponse = await response.json();

    if (data.error_code || data.error_message) {
      throw new Error(
        `FRED API fel för ${seriesId}: ${data.error_message || "Okänt fel"}`
      );
    }

    if (!data.observations || !Array.isArray(data.observations)) {
      throw new Error(`FRED API returnerade inga observationer för ${seriesId}`);
    }

    // Konvertera och filtrera observationer
    const observations: FredObservation[] = data.observations
      .map((obs) => ({
        date: obs.date,
        value: parseObservationValue(obs.value),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      seriesId,
      observations,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error(`Timeout vid hämtning av ${seriesId} (${FETCH_TIMEOUT_MS}ms)`);
      }
      throw error;
    }

    throw new Error(`Okänt fel vid hämtning av ${seriesId}`);
  }
}

/**
 * Parsar ett observationsvärde från FRED
 * Hanterar ".", tomma strängar och ogiltiga värden
 */
function parseObservationValue(value: string): number | null {
  if (!value || value === "." || value.trim() === "") {
    return null;
  }

  const parsed = parseFloat(value);
  
  if (isNaN(parsed) || !isFinite(parsed)) {
    return null;
  }

  return parsed;
}

/**
 * Hämtar flera serier parallellt
 */
export async function fetchMultipleFredSeries(
  seriesIds: string[],
  apiKey: string,
  startDate: string
): Promise<Map<string, FredSeriesResult>> {
  const results = await Promise.all(
    seriesIds.map((id) => fetchFredSeries(id, apiKey, startDate))
  );

  const resultMap = new Map<string, FredSeriesResult>();
  for (const result of results) {
    resultMap.set(result.seriesId, result);
  }

  return resultMap;
}

