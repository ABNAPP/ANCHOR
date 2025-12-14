export const MVP_CONFIG = {
  profile: "MVP",
  windows: {
    macroYears: 5,
    microQuarters: 8,
    managementPromisesYears: 5,
    nowLookbackMonths: 3,
  },
  fred: {
    series: [
      { id: "DGS10", name: "US 10Y Treasury", unit: "%" },
      { id: "DGS2", name: "US 2Y Treasury", unit: "%" },
      { id: "CPIAUCSL", name: "US CPI (SA)", unit: "index" },
      { id: "BAMLH0A0HYM2", name: "US High Yield Spread", unit: "%" },
      { id: "VIXCLS", name: "VIX", unit: "index" },
    ],
  },
} as const;

export type FredSeriesConfig = (typeof MVP_CONFIG.fred.series)[number];
export type SeriesId = FredSeriesConfig["id"];

