"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

// ============================================
// TYPES
// ============================================

interface SearchResult {
  cik: string;
  ticker: string;
  name: string;
}

interface Filing {
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form: string;
  primaryDocument: string;
  size: number;
}

interface FilingsData {
  cik: string;
  companyName: string;
  tickers: string[];
  filings: Filing[];
}

interface ExtractedPromise {
  text: string;
  category: string;
  confidence: "high" | "medium" | "low";
  source: string;
  keywords: string[];
}

interface ExtractionResult {
  totalSentences: number;
  extractedCount: number;
  promises: ExtractedPromise[];
  summary: {
    byCategory: Record<string, number>;
    byConfidence: Record<string, number>;
  };
}

type Step = "search" | "filings" | "extract" | "results";

// ============================================
// COMPONENT
// ============================================

export default function CompanyPage() {
  // State
  const [step, setStep] = useState<Step>("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Selected company
  const [selectedCompany, setSelectedCompany] = useState<SearchResult | null>(null);
  const [filingsData, setFilingsData] = useState<FilingsData | null>(null);

  // Selected filing
  const [selectedFiling, setSelectedFiling] = useState<Filing | null>(null);

  // Extraction results
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [savedToFirestore, setSavedToFirestore] = useState(false);

  // ============================================
  // HANDLERS
  // ============================================

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    setSearchResults([]);

    try {
      const res = await fetch(`/api/company/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Sökningen misslyckades");
      }

      setSearchResults(data.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ett fel uppstod");
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const handleSelectCompany = useCallback(async (company: SearchResult) => {
    setSelectedCompany(company);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/company/filings?cik=${company.cik}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Kunde inte hämta filings");
      }

      setFilingsData(data);
      setStep("filings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ett fel uppstod");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectFiling = useCallback((filing: Filing) => {
    setSelectedFiling(filing);
    setStep("extract");
  }, []);

  const handleExtractPromises = useCallback(async () => {
    if (!selectedCompany || !selectedFiling) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/company/extract-promises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cik: selectedCompany.cik,
          accessionNumber: selectedFiling.accessionNumber,
          document: selectedFiling.primaryDocument,
          formType: selectedFiling.form,
          companyName: filingsData?.companyName,
          ticker: selectedCompany.ticker,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Extraction misslyckades");
      }

      setExtraction(data.extraction);
      setSavedToFirestore(data.savedToFirestore);
      setStep("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ett fel uppstod");
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, selectedFiling, filingsData]);

  const handleReset = useCallback(() => {
    setStep("search");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedCompany(null);
    setFilingsData(null);
    setSelectedFiling(null);
    setExtraction(null);
    setSavedToFirestore(false);
    setError(null);
  }, []);

  // ============================================
  // RENDER HELPERS
  // ============================================

  const getConfidenceColor = (conf: string) => {
    switch (conf) {
      case "high": return "var(--accent-green)";
      case "medium": return "var(--accent-orange)";
      case "low": return "var(--accent-red)";
      default: return "var(--text-muted)";
    }
  };

  const getConfidenceEmoji = (conf: string) => {
    switch (conf) {
      case "high": return "🟢";
      case "medium": return "🟡";
      case "low": return "🔴";
      default: return "⚪";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Header */}
        <header style={styles.header}>
          <Link href="/" style={styles.backLink}>← Tillbaka till Macro</Link>
          <div style={styles.titleGroup}>
            <h1 style={styles.title}>
              <span style={styles.titleAccent}>◆</span> Company Engine
            </h1>
            <span style={styles.badge}>SEC EDGAR</span>
          </div>
          <p style={styles.subtitle}>
            Sök bolag → Välj filing → Extrahera promises/claims
          </p>
        </header>

        {/* Progress */}
        <div style={styles.progress}>
          <div style={{...styles.progressStep, ...(step === "search" ? styles.progressStepActive : {})}}>
            1. Sök
          </div>
          <div style={styles.progressArrow}>→</div>
          <div style={{...styles.progressStep, ...(step === "filings" ? styles.progressStepActive : {})}}>
            2. Filings
          </div>
          <div style={styles.progressArrow}>→</div>
          <div style={{...styles.progressStep, ...(step === "extract" ? styles.progressStepActive : {})}}>
            3. Extrahera
          </div>
          <div style={styles.progressArrow}>→</div>
          <div style={{...styles.progressStep, ...(step === "results" ? styles.progressStepActive : {})}}>
            4. Resultat
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={styles.errorBox}>
            <span style={styles.errorIcon}>⚠</span>
            {error}
          </div>
        )}

        {/* Step: Search */}
        {step === "search" && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Sök bolag</h2>
            <div style={styles.searchBox}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Ange ticker (t.ex. AAPL) eller bolagsnamn..."
                style={styles.input}
              />
              <button
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                style={{...styles.button, ...(loading ? styles.buttonDisabled : {})}}
              >
                {loading ? "Söker..." : "Sök"}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div style={styles.resultsList}>
                <p style={styles.resultsCount}>{searchResults.length} resultat</p>
                {searchResults.map((result) => (
                  <div
                    key={result.cik}
                    style={styles.resultItem}
                    onClick={() => handleSelectCompany(result)}
                  >
                    <div style={styles.resultTicker}>{result.ticker}</div>
                    <div style={styles.resultName}>{result.name}</div>
                    <div style={styles.resultCik}>CIK: {result.cik}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Step: Filings */}
        {step === "filings" && filingsData && (
          <section style={styles.section}>
            <div style={styles.companyHeader}>
              <h2 style={styles.companyName}>{filingsData.companyName}</h2>
              <div style={styles.companyTickers}>
                {filingsData.tickers.map((t) => (
                  <span key={t} style={styles.tickerBadge}>{t}</span>
                ))}
              </div>
            </div>

            <h3 style={styles.sectionTitle}>Välj filing att analysera</h3>
            
            <div style={styles.filingsGrid}>
              {filingsData.filings.slice(0, 20).map((filing) => (
                <div
                  key={filing.accessionNumber}
                  style={styles.filingCard}
                  onClick={() => handleSelectFiling(filing)}
                >
                  <div style={styles.filingForm}>{filing.form}</div>
                  <div style={styles.filingDate}>{filing.filingDate}</div>
                  <div style={styles.filingSize}>{formatFileSize(filing.size)}</div>
                </div>
              ))}
            </div>

            <button onClick={handleReset} style={styles.resetButton}>
              ← Ny sökning
            </button>
          </section>
        )}

        {/* Step: Extract */}
        {step === "extract" && selectedFiling && (
          <section style={styles.section}>
            <div style={styles.extractPreview}>
              <h3 style={styles.sectionTitle}>Vald filing</h3>
              <div style={styles.filingDetails}>
                <p><strong>Bolag:</strong> {filingsData?.companyName}</p>
                <p><strong>Form:</strong> {selectedFiling.form}</p>
                <p><strong>Datum:</strong> {selectedFiling.filingDate}</p>
                <p><strong>Dokument:</strong> {selectedFiling.primaryDocument}</p>
              </div>
            </div>

            <div style={styles.actionArea}>
              <button
                onClick={handleExtractPromises}
                disabled={loading}
                style={{...styles.button, ...styles.buttonLarge, ...(loading ? styles.buttonDisabled : {})}}
              >
                {loading ? "Extraherar..." : "🔍 Extrahera Promises"}
              </button>
              <p style={styles.actionHint}>
                Hämtar dokumentet, parsar sektioner och extraherar framåtblickande uttalanden.
              </p>
            </div>

            <button onClick={() => setStep("filings")} style={styles.resetButton}>
              ← Tillbaka till filings
            </button>
          </section>
        )}

        {/* Step: Results */}
        {step === "results" && extraction && (
          <section style={styles.section}>
            <div style={styles.resultsSummary}>
              <h3 style={styles.sectionTitle}>Extraktionsresultat</h3>
              
              <div style={styles.statsGrid}>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{extraction.totalSentences}</div>
                  <div style={styles.statLabel}>Meningar analyserade</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{extraction.extractedCount}</div>
                  <div style={styles.statLabel}>Promises hittade</div>
                </div>
                <div style={styles.statCard}>
                  <div style={styles.statValue}>{extraction.summary.byConfidence.high || 0}</div>
                  <div style={styles.statLabel}>High confidence</div>
                </div>
              </div>

              {savedToFirestore && (
                <div style={styles.savedBadge}>✓ Sparad i Firestore</div>
              )}
            </div>

            <div style={styles.categoryBreakdown}>
              <h4 style={styles.subTitle}>Per kategori</h4>
              <div style={styles.categoryGrid}>
                {Object.entries(extraction.summary.byCategory)
                  .filter(([, count]) => count > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([category, count]) => (
                    <div key={category} style={styles.categoryItem}>
                      <span style={styles.categoryName}>{category}</span>
                      <span style={styles.categoryCount}>{count}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div style={styles.promisesList}>
              <h4 style={styles.subTitle}>Extraherade promises ({extraction.promises.length})</h4>
              {extraction.promises.slice(0, 30).map((promise, idx) => (
                <div key={idx} style={styles.promiseCard}>
                  <div style={styles.promiseHeader}>
                    <span style={styles.promiseConfidence}>
                      {getConfidenceEmoji(promise.confidence)}
                    </span>
                    <span style={{...styles.promiseCategory, backgroundColor: getConfidenceColor(promise.confidence) + "20", color: getConfidenceColor(promise.confidence)}}>
                      {promise.category}
                    </span>
                    <span style={styles.promiseSource}>{promise.source}</span>
                  </div>
                  <p style={styles.promiseText}>{promise.text}</p>
                  {promise.keywords.length > 0 && (
                    <div style={styles.promiseKeywords}>
                      {promise.keywords.map((kw, i) => (
                        <span key={i} style={styles.keywordTag}>{kw}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button onClick={handleReset} style={{...styles.button, ...styles.buttonLarge, marginTop: "2rem"}}>
              🔄 Ny analys
            </button>
          </section>
        )}

        {/* Footer */}
        <footer style={styles.footer}>
          <p>
            Data från{" "}
            <a href="https://www.sec.gov/edgar" target="_blank" rel="noopener noreferrer">
              SEC EDGAR
            </a>{" "}
            | Caching: 24h | Rate limit: 5 req/s
          </p>
        </footer>
      </div>
    </main>
  );
}

// ============================================
// STYLES
// ============================================

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    padding: "2rem 1rem",
  },
  container: {
    maxWidth: "1000px",
    margin: "0 auto",
  },
  header: {
    marginBottom: "2rem",
    textAlign: "center",
  },
  backLink: {
    display: "inline-block",
    marginBottom: "1rem",
    color: "var(--accent-blue)",
    textDecoration: "none",
    fontSize: "0.9rem",
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
    color: "var(--accent-purple)",
  },
  badge: {
    padding: "0.25rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 600,
    backgroundColor: "var(--accent-blue)",
    color: "white",
    borderRadius: "4px",
    letterSpacing: "0.05em",
  },
  subtitle: {
    color: "var(--text-secondary)",
    fontSize: "0.9rem",
  },
  progress: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    marginBottom: "2rem",
    flexWrap: "wrap",
  },
  progressStep: {
    padding: "0.5rem 1rem",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
    fontSize: "0.8rem",
    color: "var(--text-muted)",
  },
  progressStepActive: {
    backgroundColor: "var(--accent-blue)",
    borderColor: "var(--accent-blue)",
    color: "white",
  },
  progressArrow: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
  },
  errorBox: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "1rem",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    borderRadius: "8px",
    color: "var(--accent-red)",
    marginBottom: "1.5rem",
  },
  errorIcon: {
    fontSize: "1.2rem",
  },
  section: {
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "12px",
    padding: "1.5rem",
    marginBottom: "1.5rem",
  },
  sectionTitle: {
    fontSize: "1rem",
    fontWeight: 600,
    marginBottom: "1rem",
    color: "var(--text-primary)",
  },
  searchBox: {
    display: "flex",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  input: {
    flex: 1,
    padding: "0.875rem 1rem",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    color: "var(--text-primary)",
    outline: "none",
  },
  button: {
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
    opacity: 0.6,
    cursor: "not-allowed",
  },
  buttonLarge: {
    padding: "1rem 2rem",
    fontSize: "1rem",
  },
  resetButton: {
    padding: "0.5rem 1rem",
    fontSize: "0.85rem",
    fontFamily: "inherit",
    color: "var(--text-secondary)",
    backgroundColor: "transparent",
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
    cursor: "pointer",
    marginTop: "1rem",
  },
  resultsList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  resultsCount: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    marginBottom: "0.5rem",
  },
  resultItem: {
    display: "grid",
    gridTemplateColumns: "80px 1fr auto",
    gap: "1rem",
    alignItems: "center",
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  resultTicker: {
    fontWeight: 700,
    color: "var(--accent-blue)",
    fontSize: "0.9rem",
  },
  resultName: {
    color: "var(--text-primary)",
    fontSize: "0.9rem",
  },
  resultCik: {
    color: "var(--text-muted)",
    fontSize: "0.75rem",
    fontFamily: "'JetBrains Mono', monospace",
  },
  companyHeader: {
    marginBottom: "1.5rem",
  },
  companyName: {
    fontSize: "1.25rem",
    fontWeight: 700,
    marginBottom: "0.5rem",
  },
  companyTickers: {
    display: "flex",
    gap: "0.5rem",
  },
  tickerBadge: {
    padding: "0.25rem 0.5rem",
    fontSize: "0.75rem",
    fontWeight: 600,
    backgroundColor: "var(--accent-purple)",
    color: "white",
    borderRadius: "4px",
  },
  filingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  filingCard: {
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    cursor: "pointer",
    textAlign: "center",
    transition: "all 0.2s ease",
  },
  filingForm: {
    fontWeight: 700,
    color: "var(--accent-blue)",
    fontSize: "1rem",
    marginBottom: "0.25rem",
  },
  filingDate: {
    fontSize: "0.8rem",
    color: "var(--text-primary)",
    marginBottom: "0.25rem",
  },
  filingSize: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
  },
  extractPreview: {
    marginBottom: "1.5rem",
  },
  filingDetails: {
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    fontSize: "0.9rem",
    lineHeight: 1.8,
  },
  actionArea: {
    textAlign: "center",
    padding: "1.5rem 0",
  },
  actionHint: {
    fontSize: "0.8rem",
    color: "var(--text-muted)",
    marginTop: "0.75rem",
  },
  resultsSummary: {
    marginBottom: "1.5rem",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "1rem",
    marginBottom: "1rem",
  },
  statCard: {
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    textAlign: "center",
  },
  statValue: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "var(--accent-blue)",
  },
  statLabel: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    marginTop: "0.25rem",
  },
  savedBadge: {
    display: "inline-block",
    padding: "0.5rem 1rem",
    backgroundColor: "rgba(34, 197, 94, 0.1)",
    color: "var(--accent-green)",
    borderRadius: "100px",
    fontSize: "0.85rem",
  },
  categoryBreakdown: {
    marginBottom: "1.5rem",
  },
  subTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.75rem",
  },
  categoryGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  categoryItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.375rem 0.75rem",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "100px",
    fontSize: "0.8rem",
  },
  categoryName: {
    color: "var(--text-secondary)",
    textTransform: "capitalize",
  },
  categoryCount: {
    fontWeight: 600,
    color: "var(--accent-blue)",
  },
  promisesList: {
    maxHeight: "600px",
    overflowY: "auto",
  },
  promiseCard: {
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    marginBottom: "0.75rem",
  },
  promiseHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.5rem",
    flexWrap: "wrap",
  },
  promiseConfidence: {
    fontSize: "1rem",
  },
  promiseCategory: {
    padding: "0.25rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 600,
    borderRadius: "4px",
    textTransform: "uppercase",
  },
  promiseSource: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    marginLeft: "auto",
  },
  promiseText: {
    fontSize: "0.9rem",
    color: "var(--text-primary)",
    lineHeight: 1.6,
    margin: 0,
  },
  promiseKeywords: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.25rem",
    marginTop: "0.5rem",
  },
  keywordTag: {
    padding: "0.125rem 0.375rem",
    fontSize: "0.65rem",
    backgroundColor: "var(--bg-tertiary)",
    color: "var(--text-muted)",
    borderRadius: "4px",
  },
  footer: {
    marginTop: "2rem",
    paddingTop: "1.5rem",
    borderTop: "1px solid var(--border-color)",
    textAlign: "center",
    fontSize: "0.8rem",
    color: "var(--text-muted)",
  },
};

