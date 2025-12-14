"use client";

import { useState, useCallback } from "react";

interface LatestTableRow {
  id: string;
  name: string;
  unit: string;
  latest: number | null;
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
    chg20d: Record<string, number | null>;
  };
  latestTable: LatestTableRow[];
}

interface ErrorData {
  error: string;
  message: string;
  hint?: string;
}

type Status = "idle" | "loading" | "success" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<AnalyzeData | null>(null);
  const [error, setError] = useState<ErrorData | null>(null);

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
    } catch (err) {
      setError({
        error: "Nätverksfel",
        message: err instanceof Error ? err.message : "Kunde inte nå servern",
      });
      setStatus("error");
    }
  }, []);

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
                <span style={styles.metricLabel}>Data as of</span>
                <span style={styles.metricValueSmall}>{data.asOf}</span>
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
            | Cache TTL: 15 min
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

