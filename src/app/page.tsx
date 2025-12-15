"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";

interface LatestTableRow {
  id: string;
  name: string;
  unit: string;
  latest: number | null;
  latestDate: string | null;
  chg20d: number | null;
}

interface AnalyzeData {
  profile: string;
  asOf: string;
  cached: boolean;
  regime: {
    risk: string;
    riskLabel: string;
    riskColor: string;
    conditions: string[];
    explanation: string;
  };
  features: {
    slope10y2y: number | null;
    latest: Record<string, number | null>;
    latestDates: Record<string, string | null>;
    chg20d: Record<string, number | null>;
  };
  latestTable: LatestTableRow[];
}

interface HistorySnapshot {
  id: string;
  createdAt: string;
  asOf: string;
  profile: string;
  regime: {
    risk: string;
    conditions: string;
  };
  features: {
    slope10y2y: number | null;
  };
}

interface HistoryDetail {
  id: string;
  createdAt: string;
  profile: string;
  asOf: string;
  regime: {
    risk: string;
    conditions: string;
    explanation: string;
  };
  features: {
    slope10y2y: number | null;
  };
  latest: {
    dgs10: number | null;
    dgs2: number | null;
    cpi: number | null;
    hy: number | null;
    vix: number | null;
  };
  chg20d: {
    dgs10: number | null;
    dgs2: number | null;
    cpi: number | null;
    hy: number | null;
    vix: number | null;
  };
}

interface HistoryResponse {
  count: number;
  limit: number;
  snapshots: HistorySnapshot[];
}

interface ErrorData {
  error: string;
  message: string;
  hint?: string;
}

type Status = "idle" | "loading" | "success" | "error";
type HistoryStatus = "idle" | "loading" | "success" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<AnalyzeData | null>(null);
  const [error, setError] = useState<ErrorData | null>(null);

  // History state
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("idle");
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<HistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const runAnalysis = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/macro/analyze");
      const result = await response.json();

      if (!response.ok) {
        setError(result as ErrorData);
        setStatus("error");
        return;
      }

      setData(result as AnalyzeData);
      setStatus("success");
      
      // Uppdatera historik efter lyckad analys
      fetchHistory();
    } catch (err) {
      setError({
        error: "Nätverksfel",
        message: err instanceof Error ? err.message : "Kunde inte nå servern",
      });
      setStatus("error");
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryStatus("loading");
    setHistoryError(null);

    try {
      const response = await fetch("/api/macro/history?limit=10");
      const result = await response.json();

      if (!response.ok) {
        setHistoryError(result.message || "Kunde inte hämta historik");
        setHistoryStatus("error");
        return;
      }

      setHistory((result as HistoryResponse).snapshots || []);
      setHistoryStatus("success");
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Kunde inte hämta historik");
      setHistoryStatus("error");
    }
  }, []);

  const fetchSnapshotDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/macro/history/${id}`);
      const result = await response.json();

      if (!response.ok) {
        console.error("Could not fetch snapshot:", result);
        return;
      }

      setSelectedSnapshot(result as HistoryDetail);
    } catch (err) {
      console.error("Error fetching snapshot:", err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Hämta historik vid sidladdning
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const formatValue = (value: number | null, decimals: number = 2): string => {
    if (value === null) return "—";
    return value.toFixed(decimals);
  };

  const formatChange = (value: number | null, decimals: number = 2): string => {
    if (value === null) return "—";
    const prefix = value >= 0 ? "+" : "";
    return `${prefix}${value.toFixed(decimals)}`;
  };

  const getChangeColor = (value: number | null): string => {
    if (value === null) return "var(--text-muted)";
    if (value > 0) return "var(--accent-red)";
    if (value < 0) return "var(--accent-green)";
    return "var(--text-secondary)";
  };

  const formatDateTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString("sv-SE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  const getRiskColor = (risk: string): string => {
    switch (risk) {
      case "risk_off":
        return "var(--accent-red)";
      case "tightening":
        return "var(--accent-orange)";
      case "risk_on":
        return "var(--accent-green)";
      default:
        return "var(--text-muted)";
    }
  };

  const getRiskLabel = (risk: string): string => {
    switch (risk) {
      case "risk_off":
        return "RISK OFF";
      case "tightening":
        return "TIGHTENING";
      case "risk_on":
        return "RISK ON";
      default:
        return "NEUTRAL";
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.titleGroup}>
            <h1 style={styles.title}>
              <span style={styles.titleAccent}>▲</span> Macro Relationship Engine
            </h1>
            <span style={styles.badge}>MVP</span>
          </div>
          <p style={styles.subtitle}>
            Real-time makroekonomisk analys och regime-detektion
          </p>
          <nav style={styles.nav}>
            <Link href="/company" style={styles.navLink}>
              ◆ Company Engine (SEC EDGAR) →
            </Link>
          </nav>
        </header>

        {/* Action Button */}
        <div style={styles.actionArea}>
          <button
            onClick={runAnalysis}
            disabled={status === "loading"}
            style={{
              ...styles.button,
              ...(status === "loading" ? styles.buttonDisabled : {}),
            }}
          >
            {status === "loading" ? (
              <>
                <span style={styles.spinner}></span>
                Analyserar...
              </>
            ) : (
              <>
                <span style={styles.buttonIcon}>◉</span>
                Kör analys
              </>
            )}
          </button>
          {data?.cached && (
            <span style={styles.cacheIndicator}>⚡ Cachad respons</span>
          )}
        </div>

        {/* Error State */}
        {status === "error" && error && (
          <div style={styles.errorBox} className="animate-fade-in">
            <div style={styles.errorHeader}>
              <span style={styles.errorIcon}>⚠</span>
              <strong>{error.error}</strong>
            </div>
            <p style={styles.errorMessage}>{error.message}</p>
            {error.hint && <p style={styles.errorHint}>💡 {error.hint}</p>}
          </div>
        )}

        {/* Results */}
        {status === "success" && data && (
          <div style={styles.results} className="animate-fade-in">
            {/* Regime Box */}
            <section style={styles.regimeSection}>
              <div
                style={{
                  ...styles.regimeBox,
                  borderColor: data.regime.riskColor,
                  boxShadow: `0 0 30px ${data.regime.riskColor}20`,
                }}
              >
                <div style={styles.regimeHeader}>
                  <span
                    style={{
                      ...styles.regimeIndicator,
                      backgroundColor: data.regime.riskColor,
                    }}
                  ></span>
                  <span
                    style={{
                      ...styles.regimeLabel,
                      color: data.regime.riskColor,
                    }}
                  >
                    {data.regime.riskLabel}
                  </span>
                </div>
                <p style={styles.regimeExplanation}>{data.regime.explanation}</p>
                {data.regime.conditions.length > 0 && (
                  <div style={styles.conditionsList}>
                    {data.regime.conditions.map((condition, idx) => (
                      <span key={idx} style={styles.conditionTag}>
                        {condition}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Key Metrics */}
            <section style={styles.metricsSection}>
              <div style={styles.metricCard}>
                <span style={styles.metricLabel}>Yield Curve Slope (10Y-2Y)</span>
                <span
                  style={{
                    ...styles.metricValue,
                    color:
                      data.features.slope10y2y !== null &&
                      data.features.slope10y2y < 0
                        ? "var(--accent-red)"
                        : "var(--accent-green)",
                  }}
                >
                  {formatValue(data.features.slope10y2y)} %
                </span>
                {data.features.slope10y2y !== null &&
                  data.features.slope10y2y < 0 && (
                    <span style={styles.metricWarning}>⚠ Inverterad kurva</span>
                  )}
              </div>
              <div style={styles.metricCard}>
                <span style={styles.metricLabel}>Profil</span>
                <span style={styles.metricValueSmall}>{data.profile}</span>
              </div>
            </section>

            {/* Data Table */}
            <section style={styles.tableSection}>
              <h2 style={styles.sectionTitle}>Senaste makrodata</h2>
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Serie</th>
                      <th style={styles.thRight}>Senaste</th>
                      <th style={styles.thRight}>Datum</th>
                      <th style={styles.thRight}>Δ 20d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.latestTable.map((row, idx) => (
                      <tr
                        key={row.id}
                        style={{
                          ...styles.tr,
                          animationDelay: `${idx * 50}ms`,
                        }}
                        className="animate-fade-in"
                      >
                        <td style={styles.td}>
                          <div style={styles.seriesCell}>
                            <span style={styles.seriesId}>{row.id}</span>
                            <span style={styles.seriesName}>{row.name}</span>
                          </div>
                        </td>
                        <td style={styles.tdRight}>
                          <span style={styles.valueWithUnit}>
                            {formatValue(row.latest)}
                            <span style={styles.unit}>{row.unit}</span>
                          </span>
                        </td>
                        <td style={{ ...styles.tdRight, ...styles.dateValue }}>
                          {row.latestDate || "—"}
                        </td>
                        <td
                          style={{
                            ...styles.tdRight,
                            color: getChangeColor(row.chg20d),
                          }}
                        >
                          {formatChange(row.chg20d)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* Idle State */}
        {status === "idle" && (
          <div style={styles.idleState}>
            <div style={styles.idleIcon}>◈</div>
            <p style={styles.idleText}>
              Klicka på &quot;Kör analys&quot; för att hämta makrodata från FRED och
              analysera aktuellt marknadsregime.
            </p>
          </div>
        )}

        {/* History Section */}
        <section style={styles.historySection}>
          <div style={styles.historyHeader}>
            <h2 style={styles.sectionTitle}>Historik</h2>
            <button
              onClick={fetchHistory}
              style={styles.refreshButton}
              disabled={historyStatus === "loading"}
            >
              {historyStatus === "loading" ? "Laddar..." : "↻ Uppdatera"}
            </button>
          </div>

          {historyStatus === "error" && historyError && (
            <div style={styles.historyError}>
              <span>⚠ {historyError}</span>
            </div>
          )}

          {historyStatus === "success" && history.length === 0 && (
            <div style={styles.historyEmpty}>
              <p>Ingen historik ännu. Kör en analys för att spara första snapshot.</p>
            </div>
          )}

          {history.length > 0 && (
            <div style={styles.historyList}>
              {history.map((snapshot) => (
                <div
                  key={snapshot.id}
                  style={{
                    ...styles.historyItem,
                    ...(selectedSnapshot?.id === snapshot.id ? styles.historyItemSelected : {}),
                  }}
                  onClick={() => fetchSnapshotDetail(snapshot.id)}
                >
                  <div style={styles.historyItemHeader}>
                    <span
                      style={{
                        ...styles.historyRiskBadge,
                        backgroundColor: getRiskColor(snapshot.regime.risk),
                      }}
                    >
                      {getRiskLabel(snapshot.regime.risk)}
                    </span>
                    <span style={styles.historyDate}>
                      {formatDateTime(snapshot.createdAt)}
                    </span>
                  </div>
                  <div style={styles.historyItemBody}>
                    <span style={styles.historySlope}>
                      Slope: {formatValue(snapshot.features.slope10y2y)}%
                    </span>
                    {snapshot.regime.conditions && (
                      <span style={styles.historyConditions}>
                        {snapshot.regime.conditions}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Snapshot Detail Modal */}
          {selectedSnapshot && (
            <div style={styles.detailOverlay} onClick={() => setSelectedSnapshot(null)}>
              <div style={styles.detailModal} onClick={(e) => e.stopPropagation()}>
                <div style={styles.detailHeader}>
                  <h3 style={styles.detailTitle}>Snapshot Detaljer</h3>
                  <button
                    style={styles.detailClose}
                    onClick={() => setSelectedSnapshot(null)}
                  >
                    ✕
                  </button>
                </div>

                {detailLoading ? (
                  <div style={styles.detailLoading}>Laddar...</div>
                ) : (
                  <div style={styles.detailContent}>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Skapad</span>
                      <span>{formatDateTime(selectedSnapshot.createdAt)}</span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>As Of</span>
                      <span>{selectedSnapshot.asOf}</span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Regime</span>
                      <span style={{ color: getRiskColor(selectedSnapshot.regime.risk) }}>
                        {getRiskLabel(selectedSnapshot.regime.risk)}
                      </span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>Slope 10Y-2Y</span>
                      <span>{formatValue(selectedSnapshot.features.slope10y2y)}%</span>
                    </div>

                    <div style={styles.detailDivider}></div>

                    <p style={styles.detailExplanation}>
                      {selectedSnapshot.regime.explanation}
                    </p>

                    <div style={styles.detailDivider}></div>

                    <h4 style={styles.detailSubtitle}>Senaste värden</h4>
                    <div style={styles.detailGrid}>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>10Y</span>
                        <span>{formatValue(selectedSnapshot.latest.dgs10)}%</span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>2Y</span>
                        <span>{formatValue(selectedSnapshot.latest.dgs2)}%</span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>CPI</span>
                        <span>{formatValue(selectedSnapshot.latest.cpi)}</span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>HY</span>
                        <span>{formatValue(selectedSnapshot.latest.hy)}%</span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>VIX</span>
                        <span>{formatValue(selectedSnapshot.latest.vix)}</span>
                      </div>
                    </div>

                    <h4 style={styles.detailSubtitle}>20-dagars förändring</h4>
                    <div style={styles.detailGrid}>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>10Y</span>
                        <span style={{ color: getChangeColor(selectedSnapshot.chg20d.dgs10) }}>
                          {formatChange(selectedSnapshot.chg20d.dgs10)}
                        </span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>2Y</span>
                        <span style={{ color: getChangeColor(selectedSnapshot.chg20d.dgs2) }}>
                          {formatChange(selectedSnapshot.chg20d.dgs2)}
                        </span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>CPI</span>
                        <span style={{ color: getChangeColor(selectedSnapshot.chg20d.cpi) }}>
                          {formatChange(selectedSnapshot.chg20d.cpi)}
                        </span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>HY</span>
                        <span style={{ color: getChangeColor(selectedSnapshot.chg20d.hy) }}>
                          {formatChange(selectedSnapshot.chg20d.hy)}
                        </span>
                      </div>
                      <div style={styles.detailGridItem}>
                        <span style={styles.detailGridLabel}>VIX</span>
                        <span style={{ color: getChangeColor(selectedSnapshot.chg20d.vix) }}>
                          {formatChange(selectedSnapshot.chg20d.vix)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer style={styles.footer}>
          <p>
            Data från{" "}
            <a
              href="https://fred.stlouisfed.org/"
              target="_blank"
              rel="noopener noreferrer"
            >
              FRED API
            </a>{" "}
            | Historik: Firebase Firestore | Cache TTL: 15 min
          </p>
        </footer>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    padding: "2rem 1rem",
  },
  container: {
    maxWidth: "900px",
    margin: "0 auto",
  },
  header: {
    marginBottom: "2rem",
    textAlign: "center",
  },
  titleGroup: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    marginBottom: "0.5rem",
  },
  title: {
    fontSize: "1.75rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  titleAccent: {
    color: "var(--accent-blue)",
  },
  badge: {
    padding: "0.25rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 600,
    backgroundColor: "var(--accent-purple)",
    color: "white",
    borderRadius: "4px",
    letterSpacing: "0.05em",
  },
  subtitle: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
  },
  nav: {
    marginTop: "1rem",
  },
  navLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    color: "var(--accent-purple)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    textDecoration: "none",
    transition: "all 0.2s ease",
  },
  actionArea: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    marginBottom: "2rem",
  },
  button: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.875rem 1.5rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    fontFamily: "inherit",
    color: "white",
    backgroundColor: "var(--accent-blue)",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  buttonDisabled: {
    opacity: 0.7,
    cursor: "not-allowed",
  },
  buttonIcon: {
    fontSize: "1.1rem",
  },
  spinner: {
    width: "16px",
    height: "16px",
    border: "2px solid rgba(255,255,255,0.3)",
    borderTopColor: "white",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  cacheIndicator: {
    fontSize: "0.8rem",
    color: "var(--accent-green)",
  },
  errorBox: {
    padding: "1.25rem",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    borderRadius: "8px",
    marginBottom: "2rem",
  },
  errorHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    color: "var(--accent-red)",
    marginBottom: "0.5rem",
  },
  errorIcon: {
    fontSize: "1.2rem",
  },
  errorMessage: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    marginBottom: "0.5rem",
  },
  errorHint: {
    color: "var(--accent-orange)",
    fontSize: "0.85rem",
  },
  results: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
  },
  regimeSection: {
    marginBottom: "0.5rem",
  },
  regimeBox: {
    padding: "1.5rem",
    backgroundColor: "var(--bg-secondary)",
    border: "2px solid",
    borderRadius: "12px",
    transition: "all 0.3s ease",
  },
  regimeHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  regimeIndicator: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    animation: "pulse 2s ease-in-out infinite",
  },
  regimeLabel: {
    fontSize: "1.25rem",
    fontWeight: 700,
    letterSpacing: "0.05em",
  },
  regimeExplanation: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    lineHeight: 1.6,
    marginBottom: "1rem",
  },
  conditionsList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  conditionTag: {
    padding: "0.375rem 0.75rem",
    fontSize: "0.75rem",
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid var(--border-color)",
    borderRadius: "100px",
    color: "var(--text-secondary)",
  },
  metricsSection: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1rem",
  },
  metricCard: {
    padding: "1.25rem",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  metricLabel: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  metricValue: {
    fontSize: "1.5rem",
    fontWeight: 700,
  },
  metricValueSmall: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  metricWarning: {
    fontSize: "0.75rem",
    color: "var(--accent-orange)",
  },
  tableSection: {},
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "1rem",
  },
  tableWrapper: {
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.875rem",
  },
  th: {
    padding: "1rem",
    textAlign: "left",
    fontWeight: 600,
    color: "var(--text-muted)",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid var(--border-color)",
    backgroundColor: "var(--bg-tertiary)",
  },
  thRight: {
    padding: "1rem",
    textAlign: "right",
    fontWeight: 600,
    color: "var(--text-muted)",
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid var(--border-color)",
    backgroundColor: "var(--bg-tertiary)",
  },
  tr: {
    borderBottom: "1px solid var(--border-color)",
  },
  td: {
    padding: "1rem",
  },
  tdRight: {
    padding: "1rem",
    textAlign: "right",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 500,
  },
  seriesCell: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  seriesId: {
    fontWeight: 600,
    color: "var(--accent-blue)",
    fontSize: "0.8rem",
  },
  seriesName: {
    color: "var(--text-secondary)",
    fontSize: "0.8rem",
  },
  valueWithUnit: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "flex-end",
    gap: "0.25rem",
  },
  unit: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
  },
  dateValue: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    fontFamily: "'JetBrains Mono', monospace",
  },
  idleState: {
    textAlign: "center",
    padding: "3rem 2rem",
    backgroundColor: "var(--bg-secondary)",
    border: "1px dashed var(--border-color)",
    borderRadius: "12px",
  },
  idleIcon: {
    fontSize: "3rem",
    color: "var(--accent-purple)",
    marginBottom: "1rem",
    animation: "pulse 3s ease-in-out infinite",
  },
  idleText: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
    maxWidth: "400px",
    margin: "0 auto",
    lineHeight: 1.6,
  },

  // History styles
  historySection: {
    marginTop: "2rem",
    paddingTop: "2rem",
    borderTop: "1px solid var(--border-color)",
  },
  historyHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem",
  },
  refreshButton: {
    padding: "0.5rem 1rem",
    fontSize: "0.8rem",
    fontFamily: "inherit",
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  historyError: {
    padding: "1rem",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    borderRadius: "8px",
    color: "var(--accent-red)",
    fontSize: "0.85rem",
  },
  historyEmpty: {
    padding: "2rem",
    textAlign: "center",
    backgroundColor: "var(--bg-secondary)",
    border: "1px dashed var(--border-color)",
    borderRadius: "8px",
    color: "var(--text-muted)",
    fontSize: "0.9rem",
  },
  historyList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  historyItem: {
    padding: "1rem",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  historyItemSelected: {
    borderColor: "var(--accent-blue)",
    boxShadow: "0 0 0 1px var(--accent-blue)",
  },
  historyItemHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.5rem",
  },
  historyRiskBadge: {
    padding: "0.25rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "white",
    borderRadius: "4px",
    letterSpacing: "0.03em",
  },
  historyDate: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    fontFamily: "'JetBrains Mono', monospace",
  },
  historyItemBody: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  historySlope: {
    fontSize: "0.85rem",
    color: "var(--text-primary)",
  },
  historyConditions: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
  },

  // Detail Modal styles
  detailOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "1rem",
  },
  detailModal: {
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "12px",
    maxWidth: "500px",
    width: "100%",
    maxHeight: "80vh",
    overflow: "auto",
  },
  detailHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "1rem 1.25rem",
    borderBottom: "1px solid var(--border-color)",
  },
  detailTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  detailClose: {
    padding: "0.25rem 0.5rem",
    fontSize: "1rem",
    color: "var(--text-muted)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
  },
  detailLoading: {
    padding: "2rem",
    textAlign: "center",
    color: "var(--text-muted)",
  },
  detailContent: {
    padding: "1.25rem",
  },
  detailRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "0.75rem",
    fontSize: "0.9rem",
  },
  detailLabel: {
    color: "var(--text-muted)",
  },
  detailDivider: {
    height: "1px",
    backgroundColor: "var(--border-color)",
    margin: "1rem 0",
  },
  detailExplanation: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  },
  detailSubtitle: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-muted)",
    marginBottom: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  detailGridItem: {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    padding: "0.5rem",
    backgroundColor: "var(--bg-tertiary)",
    borderRadius: "6px",
    textAlign: "center",
  },
  detailGridLabel: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  },

  footer: {
    marginTop: "3rem",
    paddingTop: "1.5rem",
    borderTop: "1px solid var(--border-color)",
    textAlign: "center",
    fontSize: "0.8rem",
    color: "var(--text-muted)",
  },
};

// Add keyframes via style tag for spinner
if (typeof document !== "undefined") {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}
