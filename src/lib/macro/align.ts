import { FredObservation, FredSeriesResult } from "../fred/client";

/**
 * Hittar det senaste giltiga (icke-null) värdet i en serie
 */
export function getLatestValidValue(
  observations: FredObservation[]
): { date: string; value: number } | null {
  // Iterera bakifrån för att hitta senaste giltiga värde
  for (let i = observations.length - 1; i >= 0; i--) {
    const obs = observations[i];
    if (obs.value !== null) {
      return { date: obs.date, value: obs.value };
    }
  }
  return null;
}

/**
 * Hittar det senaste gemensamma datumet där alla serier har giltiga värden
 */
export function getLatestCommonDate(
  seriesMap: Map<string, FredSeriesResult>
): string | null {
  const seriesArray = Array.from(seriesMap.values());
  
  if (seriesArray.length === 0) {
    return null;
  }

  // Samla alla unika datum där alla serier har data
  const dateValueCounts = new Map<string, number>();
  const seriesCount = seriesArray.length;

  for (const series of seriesArray) {
    const seenDates = new Set<string>();
    for (const obs of series.observations) {
      if (obs.value !== null && !seenDates.has(obs.date)) {
        seenDates.add(obs.date);
        dateValueCounts.set(
          obs.date,
          (dateValueCounts.get(obs.date) || 0) + 1
        );
      }
    }
  }

  // Hitta det senaste datumet där alla serier har värden
  let latestCommonDate: string | null = null;
  
  for (const [date, count] of dateValueCounts.entries()) {
    if (count === seriesCount) {
      if (!latestCommonDate || date > latestCommonDate) {
        latestCommonDate = date;
      }
    }
  }

  return latestCommonDate;
}

/**
 * Hämtar värdet för ett specifikt datum (eller närmast föregående)
 */
export function getValueAtDate(
  observations: FredObservation[],
  targetDate: string
): number | null {
  // Hitta exakt match eller närmast föregående datum med värde
  let result: number | null = null;
  
  for (const obs of observations) {
    if (obs.date <= targetDate && obs.value !== null) {
      result = obs.value;
    }
    if (obs.date > targetDate) {
      break;
    }
  }

  return result;
}

/**
 * Hittar värdet N datapunkter bakåt (med giltiga värden)
 * Returnerar null om det inte finns tillräckligt med data
 */
export function getValueNPointsBack(
  observations: FredObservation[],
  fromIndex: number,
  n: number
): { date: string; value: number; index: number } | null {
  let count = 0;
  
  for (let i = fromIndex - 1; i >= 0; i--) {
    const obs = observations[i];
    if (obs.value !== null) {
      count++;
      if (count === n) {
        return { date: obs.date, value: obs.value, index: i };
      }
    }
  }

  return null;
}

/**
 * Beräknar förändring från N datapunkter bakåt till nuvarande
 */
export function calculateChangeFromNBack(
  observations: FredObservation[],
  n: number
): number | null {
  // Hitta senaste giltiga värde
  let latestIndex = -1;
  let latestValue: number | null = null;

  for (let i = observations.length - 1; i >= 0; i--) {
    if (observations[i].value !== null) {
      latestIndex = i;
      latestValue = observations[i].value;
      break;
    }
  }

  if (latestIndex === -1 || latestValue === null) {
    return null;
  }

  // Hitta värdet N datapunkter bakåt
  const backValue = getValueNPointsBack(observations, latestIndex, n);
  
  if (!backValue) {
    return null;
  }

  return latestValue - backValue.value;
}

/**
 * Alignar serier till ett gemensamt datum med interpolering av saknade värden
 */
export function alignSeriesToDate(
  seriesMap: Map<string, FredSeriesResult>,
  targetDate: string
): Map<string, number | null> {
  const aligned = new Map<string, number | null>();

  for (const [seriesId, series] of seriesMap.entries()) {
    aligned.set(seriesId, getValueAtDate(series.observations, targetDate));
  }

  return aligned;
}

/**
 * Beräknar Year-over-Year (YoY) förändring för CPI
 * 
 * CONTRACT: CPI använder YoY istället för dagbaserade fönster
 * 
 * @param observations - CPI observations
 * @returns YoY förändring i procent, eller null om data saknas
 */
export function calculateYearOverYearChange(
  observations: FredObservation[]
): number | null {
  const latestVal = getLatestValidValue(observations);
  if (!latestVal) {
    return null;
  }

  // Hitta datum ett år tidigare (ungefär)
  const latestDate = new Date(latestVal.date);
  const oneYearAgo = new Date(latestDate);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().split("T")[0];

  // Hitta närmaste observation ett år tidigare
  const yearAgoVal = getValueAtDate(observations, oneYearAgoStr);
  
  if (yearAgoVal === null) {
    return null;
  }

  // Beräkna YoY förändring i procent
  if (yearAgoVal === 0) {
    return null; // Undvik division med noll
  }

  const yoyChange = ((latestVal.value - yearAgoVal) / yearAgoVal) * 100;
  return yoyChange;
}

