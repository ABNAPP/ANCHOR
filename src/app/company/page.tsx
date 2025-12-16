"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { DebugOverlay, DebugError as DebugErrorType } from "@/components/DebugOverlay";

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

type PromiseType =
  | "REVENUE"
  | "MARGIN"
  | "COSTS"
  | "CAPEX"
  | "DEBT"
  | "STRATEGY"
  | "PRODUCT"
  | "MARKET"
  | "OTHER";

type TimeHorizon = "NEXT_Q" | "FY1" | "FY2PLUS" | "LONG_TERM" | "UNSPECIFIED";

interface ExtractedPromise {
  text: string;
  type: PromiseType;
  timeHorizon: TimeHorizon;
  measurable: boolean;
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  keywords: string[];
  source: string;
  score?: {
    score0to100: number;
    status: "HELD" | "MIXED" | "FAILED" | "UNCLEAR";
    reasons: string[];
    scoredAt?: string;
  };
}

interface ExtractionResult {
  totalSentences: number;
  extractedCount: number;
  promises: ExtractedPromise[];
  summary: {
    byType: Record<PromiseType, number>;
    byTimeHorizon: Record<TimeHorizon, number>;
    byConfidence: Record<string, number>;
    measurableCount: number;
  };
}

interface ExtractResponse {
  cik: string;
  accessionNumber: string;
  formType: string;
  companyName: string | null;
  ticker: string | null;
  documentUsed: string;
  usedFallback: boolean;
  textSource: string;
  textLength: number;
  extraction: ExtractionResult;
  savedToFirestore: boolean;
  firestoreId?: string;
}

// KPI Types
interface ExtractedKpi {
  key: string;
  label: string;
  period: string;
  periodType: "annual" | "quarterly" | "instant";
  value: number;
  unit: string;
  filedDate: string;
  fiscalYear: number;
  fiscalPeriod: string;
  form: string;
}

interface KpiResponse {
  cik: string;
  companyName: string;
  asOf: string;
  kpis: ExtractedKpi[];
  summary: {
    totalKpis: number;
    uniqueMetrics: number;
    latestFilingDate: string;
    coverageYears: number[];
  };
}

// Verification Types
type VerificationStatus = "SUPPORTED" | "CONTRADICTED" | "UNRESOLVED" | "PENDING";

interface KpiComparison {
  before: { period: string; value: number; unit: string; filedDate: string } | null;
  after: { period: string; value: number; unit: string; filedDate: string } | null;
  deltaAbs: number | null;
  deltaPct: number | null;
}

interface VerificationResult {
  status: VerificationStatus;
  confidence: "high" | "medium" | "low";
  kpiUsed: { key: string; label: string } | null;
  comparison: KpiComparison;
  notes: string;
  reasoning: string[];
}

interface VerificationResponse {
  success: boolean;
  verificationId?: string;
  savedToFirestore: boolean;
  verification: VerificationResult;
  kpiSummary: {
    totalKpis: number;
    uniqueMetrics: number;
    coverageYears: number[];
    asOf: string;
  };
}

type Step = "search" | "filings" | "extract" | "results";
type ActiveTab = "promises" | "kpis";

// ============================================
// CONSTANTS
// ============================================

const SUPPORTED_FORMS = ["10-K", "10-Q"];

// Promise types som kan verifieras mot KPI
const VERIFIABLE_TYPES: PromiseType[] = ["REVENUE", "MARGIN", "COSTS", "CAPEX", "DEBT", "PRODUCT", "MARKET"];

const TYPE_LABELS: Record<PromiseType, string> = {
  REVENUE: "Revenue",
  MARGIN: "Margin",
  COSTS: "Costs",
  CAPEX: "CapEx",
  DEBT: "Debt",
  STRATEGY: "Strategy",
  PRODUCT: "Product",
  MARKET: "Market",
  OTHER: "Other",
};

const TIME_LABELS: Record<TimeHorizon, string> = {
  NEXT_Q: "Next Quarter",
  FY1: "This Year",
  FY2PLUS: "2+ Years",
  LONG_TERM: "Long-term",
  UNSPECIFIED: "Unspecified",
};

const STATUS_CONFIG: Record<VerificationStatus, { label: string; emoji: string; color: string }> = {
  SUPPORTED: { label: "Stöds", emoji: "✅", color: "var(--accent-green)" },
  CONTRADICTED: { label: "Motsägs", emoji: "❌", color: "var(--accent-red)" },
  UNRESOLVED: { label: "Oklar", emoji: "❓", color: "var(--accent-orange)" },
  PENDING: { label: "Väntar", emoji: "⏳", color: "var(--text-muted)" },
};

const SCORE_STATUS_CONFIG: Record<"HELD" | "MIXED" | "FAILED" | "UNCLEAR", { label: string; emoji: string; color: string }> = {
  HELD: { label: "Held", emoji: "✅", color: "var(--accent-green)" },
  MIXED: { label: "Mixed", emoji: "⚠️", color: "var(--accent-orange)" },
  FAILED: { label: "Failed", emoji: "❌", color: "var(--accent-red)" },
  UNCLEAR: { label: "Unclear", emoji: "❓", color: "var(--text-muted)" },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function isSupportedForm(form: string): boolean {
  const upper = form.toUpperCase();
  return SUPPORTED_FORMS.some((f) => upper.includes(f));
}

function isVerifiableType(type: PromiseType): boolean {
  return VERIFIABLE_TYPES.includes(type);
}

function formatKpiValue(value: number, unit: string): string {
  if (unit === "shares") {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)}B`;
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    return value.toLocaleString();
  }
  
  if (unit === "USD/share") {
    return `$${value.toFixed(2)}`;
  }
  
  // USD
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${value.toLocaleString()}`;
}

// ============================================
// COMPONENT
// ============================================

export default function CompanyPage() {
  // State
  const [step, setStep] = useState<Step>("search");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Debug error state
  const [debugErrors, setDebugErrors] = useState<DebugErrorType[]>([]);
  const [debugVisible, setDebugVisible] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Selected company
  const [selectedCompany, setSelectedCompany] = useState<SearchResult | null>(null);
  const [filingsData, setFilingsData] = useState<FilingsData | null>(null);

  // Selected filing
  const [selectedFiling, setSelectedFiling] = useState<Filing | null>(null);

  // Extraction results
  const [extractResponse, setExtractResponse] = useState<ExtractResponse | null>(null);
  
  // Filter state for results
  const [typeFilter, setTypeFilter] = useState<PromiseType | "ALL">("ALL");
  const [confidenceFilter, setConfidenceFilter] = useState<"high" | "medium" | "low" | "ALL">("ALL");

  // KPI State
  const [kpiResponse, setKpiResponse] = useState<KpiResponse | null>(null);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [kpiFilter, setKpiFilter] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState<ActiveTab>("promises");

  // Verification State
  const [verificationResults, setVerificationResults] = useState<Map<number, VerificationResult>>(new Map());
  const [verifyingIndices, setVerifyingIndices] = useState<Set<number>>(new Set());
  const [selectedVerification, setSelectedVerification] = useState<{ index: number; result: VerificationResult } | null>(null);
  const [selectedPromiseIndices, setSelectedPromiseIndices] = useState<Set<number>>(new Set());
  const [batchVerifying, setBatchVerifying] = useState(false);

  // Scoring State
  const [companyScore, setCompanyScore] = useState<number | null>(null);
  const [scoringLoading, setScoringLoading] = useState(false);

  // ============================================
  // DERIVED STATE
  // ============================================

  const supportedFilings = useMemo(() => {
    if (!filingsData?.filings) return [];
    return filingsData.filings.filter((f) => f && isSupportedForm(f.form));
  }, [filingsData]);

  const filteredPromises = useMemo(() => {
    if (!extractResponse?.extraction?.promises) return [];
    let promises = extractResponse.extraction.promises;

    if (typeFilter !== "ALL") {
      promises = promises.filter((p) => p?.type === typeFilter);
    }

    if (confidenceFilter !== "ALL") {
      promises = promises.filter((p) => p?.confidence === confidenceFilter);
    }

    return promises;
  }, [extractResponse, typeFilter, confidenceFilter]);

  const filteredKpis = useMemo(() => {
    if (!kpiResponse?.kpis) return [];
    if (kpiFilter === "ALL") return kpiResponse.kpis;
    return kpiResponse.kpis.filter((k) => k?.key === kpiFilter);
  }, [kpiResponse, kpiFilter]);

  const uniqueKpiKeys = useMemo(() => {
    if (!kpiResponse?.kpis) return [];
    const keys = new Set(kpiResponse.kpis.map((k) => k?.key).filter(Boolean));
    return Array.from(keys).sort();
  }, [kpiResponse]);

  // Score statistics
  const scoreStats = useMemo(() => {
    const promises = extractResponse?.extraction?.promises || [];
    
    const scoredPromises = promises.filter((p) => {
      if (!p?.score) return false;
      const score = typeof p.score.score0to100 === "string" 
        ? parseFloat(p.score.score0to100) 
        : typeof p.score.score0to100 === "number"
        ? p.score.score0to100
        : null;
      return score !== null && !isNaN(score);
    });

    if (scoredPromises.length === 0) {
      return {
        hasScoring: false,
        counts: { HELD: 0, MIXED: 0, FAILED: 0, UNCLEAR: 0 },
        scoredCount: 0,
        top5: [],
        bottom5: [],
      };
    }

    const counts = { HELD: 0, MIXED: 0, FAILED: 0, UNCLEAR: 0 };
    scoredPromises.forEach((p) => {
      const status = p.score?.status;
      if (status && (status === "HELD" || status === "MIXED" || status === "FAILED" || status === "UNCLEAR")) {
        counts[status]++;
      }
    });

    const scoredCount = scoredPromises.filter((p) => p.score?.status !== "UNCLEAR").length;

    // Sort by score (normalize to number)
    const sorted = [...scoredPromises].sort((a, b) => {
      const scoreA = typeof a.score?.score0to100 === "string" 
        ? parseFloat(a.score.score0to100) 
        : typeof a.score?.score0to100 === "number"
        ? a.score.score0to100
        : 0;
      const scoreB = typeof b.score?.score0to100 === "string" 
        ? parseFloat(b.score.score0to100) 
        : typeof b.score?.score0to100 === "number"
        ? b.score.score0to100
        : 0;
      return scoreB - scoreA;
    });

    const top5 = sorted.slice(0, 5);
    const bottom5 = sorted.slice(-5).reverse();

    return {
      hasScoring: true,
      counts,
      scoredCount,
      top5,
      bottom5,
    };
  }, [extractResponse]);

  // ============================================
  // DEBUG HELPERS
  // ============================================

  const addDebugError = useCallback((context: string, err: unknown, status?: number, details?: string) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorDetails = details || (err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : undefined);
    
    const newError: DebugErrorType = {
      at: new Date().toISOString(),
      context,
      message: errorMessage,
      status,
      details: errorDetails,
    };
    
    setDebugErrors((prev) => {
      const updated = [newError, ...prev].slice(0, 10); // Keep last 10
      return updated;
    });
    
    // Show overlay when new error is added
    setDebugVisible(true);
    
    console.error(`[${context}]`, err);
  }, []);

  const clearDebugErrors = useCallback(() => {
    setDebugErrors([]);
  }, []);

  const closeDebugOverlay = useCallback(() => {
    setDebugVisible(false);
  }, []);

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

      if (!res.ok || data.ok === false) {
        const errorMsg = data.error?.message || data.message || "Sökningen misslyckades";
        const errorDetails = data.error?.details ? JSON.stringify(data.error.details, null, 2) : undefined;
        addDebugError("search", new Error(errorMsg), res.status, errorDetails);
        throw new Error(errorMsg);
      }

      // Handle normalized response format
      const results = data.data?.results || data.results || [];
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Ett fel uppstod";
      setError(errorMsg);
      if (!(err instanceof Error && err.message)) {
        addDebugError("search", err);
      }
    } finally {
      setLoading(false);
    }
  }, [searchQuery, addDebugError]);

  const handleSelectCompany = useCallback(async (company: SearchResult) => {
    setSelectedCompany(company);
    setLoading(true);
    setError(null);
    setKpiResponse(null);
    setKpiError(null);
    setVerificationResults(new Map());

    try {
      const res = await fetch(`/api/company/filings?cik=${company.cik}`);
      const data = await res.json().catch(() => ({ ok: false, error: { message: "Failed to parse JSON response" } }));

      if (!res.ok || data.ok === false) {
        const errorMsg = data.error?.message || data.message || "Kunde inte hämta filings";
        const errorDetails = data.error?.details ? JSON.stringify(data.error.details, null, 2) : undefined;
        addDebugError("filings", new Error(errorMsg), res.status, errorDetails);
        throw new Error(errorMsg);
      }

      // Handle normalized response format
      const responseData = data.data || data;
      
      // Validate response structure
      if (!responseData || typeof responseData !== 'object' || !responseData.filings) {
        throw new Error("Ogiltigt svar från API");
      }

      setFilingsData(responseData);
      setStep("filings");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Ett fel uppstod";
      setError(errorMsg);
      if (!(err instanceof Error && err.message)) {
        addDebugError("filings", err);
      }
    } finally {
      setLoading(false);
    }
  }, [addDebugError]);

  const handleSelectFiling = useCallback((filing: Filing) => {
    if (!isSupportedForm(filing.form)) {
      setError("Endast 10-K och 10-Q stöds för promise extraction.");
      return;
    }
    setSelectedFiling(filing);
    setError(null);
    setStep("extract");
  }, []);

  const handleExtractPromises = useCallback(async () => {
    if (!selectedCompany || !selectedFiling) return;

    if (!isSupportedForm(selectedFiling.form)) {
      setError("Endast 10-K och 10-Q stöds för promise extraction.");
      return;
    }

    setLoading(true);
    setError(null);
    setVerificationResults(new Map());

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

      const data = await res.json().catch(() => ({ ok: false, error: { message: "Failed to parse JSON response" } }));

      if (!res.ok || data.ok === false) {
        const errorMsg = data.error?.message || data.message || data.suggestion || "Extraction misslyckades";
        const errorDetails = data.error?.details ? JSON.stringify(data.error.details, null, 2) : data.suggestion;
        addDebugError("extract", new Error(errorMsg), res.status, errorDetails);
        throw new Error(errorMsg);
      }

      // Handle normalized response format
      const responseData = data.data || data;

      // Validate response structure
      if (!responseData || !responseData.extraction || !Array.isArray(responseData.extraction.promises)) {
        throw new Error("Ogiltigt svar från extraction API");
      }

      setExtractResponse(responseData);
      setTypeFilter("ALL");
      setConfidenceFilter("ALL");
      setActiveTab("promises");
      setStep("results");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Ett fel uppstod";
      setError(errorMsg);
      if (!(err instanceof Error && err.message)) {
        addDebugError("extract", err);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedCompany, selectedFiling, filingsData, addDebugError]);

  const handleFetchKpis = useCallback(async () => {
    if (!selectedCompany) return;

    setKpiLoading(true);
    setKpiError(null);

    try {
      const res = await fetch(`/api/company/facts?cik=${selectedCompany.cik}`);
      const data = await res.json().catch(() => ({ ok: false, error: { message: "Failed to parse JSON response" } }));

      if (!res.ok || data.ok === false) {
        const errorMsg = data.error?.message || data.message || "Kunde inte hämta KPI:er";
        const errorDetails = data.error?.details ? JSON.stringify(data.error.details, null, 2) : undefined;
        addDebugError("facts", new Error(errorMsg), res.status, errorDetails);
        throw new Error(errorMsg);
      }

      // Handle normalized response format
      const responseData = data.data || data;

      // Validate response structure
      if (!responseData || !Array.isArray(responseData.kpis)) {
        throw new Error("Ogiltigt svar från KPI API");
      }

      setKpiResponse(responseData);
      setKpiFilter("ALL");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Ett fel uppstod";
      setKpiError(errorMsg);
      if (!(err instanceof Error && err.message)) {
        addDebugError("facts", err);
      }
    } finally {
      setKpiLoading(false);
    }
  }, [selectedCompany, addDebugError]);

  const handleVerifyPromise = useCallback(async (promiseIndex: number, promise: ExtractedPromise) => {
    if (!selectedCompany || !selectedFiling || !extractResponse) return;

    // Validate promiseIndex is within bounds
    if (promiseIndex < 0 || promiseIndex >= (extractResponse.extraction.promises?.length || 0)) {
      addDebugError("verify", new Error(`Invalid promiseIndex: ${promiseIndex}`));
      return;
    }

    // Markera som verifierar
    setVerifyingIndices((prev) => new Set(prev).add(promiseIndex));

    try {
      const res = await fetch("/api/company/verify-promise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cik10: selectedCompany.cik,
          companyName: filingsData?.companyName || extractResponse.companyName,
          ticker: selectedCompany.ticker,
          filingAccession: selectedFiling.accessionNumber,
          filingDate: selectedFiling.filingDate,
          promiseIndex,
          promise: {
            text: promise.text,
            type: promise.type,
            timeHorizon: promise.timeHorizon,
            measurable: promise.measurable,
            confidence: promise.confidence,
          },
        }),
      });

      const data = await res.json().catch(() => ({ ok: false, error: { message: "Failed to parse JSON response" } }));

      // Handle normalized response format
      if (!res.ok || (data.ok === false)) {
        const errorMsg = data.error?.message || data.message || "Verifiering misslyckades";
        const errorDetails = data.error?.details ? JSON.stringify(data.error.details, null, 2) : undefined;
        addDebugError("verify", new Error(errorMsg), res.status, errorDetails);
        
        // Set error result
        setVerificationResults((prev) => {
          const newMap = new Map(prev);
          newMap.set(promiseIndex, {
            status: "UNRESOLVED",
            confidence: "low",
            kpiUsed: null,
            comparison: { before: null, after: null, deltaAbs: null, deltaPct: null },
            notes: errorMsg,
            reasoning: ["Ett fel uppstod vid verifieringen"],
          });
          return newMap;
        });
        return;
      }

      // Handle success response (normalized format: data.ok === true || old format)
      const verification = data.data?.verification || data.verification;
      if (!verification) {
        throw new Error("Saknar verification data i response");
      }

      // Validate verification structure
      if (!verification.status || !verification.confidence) {
        throw new Error("Ogiltig verification struktur");
      }

      // Spara resultat
      setVerificationResults((prev) => {
        const newMap = new Map(prev);
        newMap.set(promiseIndex, verification);
        return newMap;
      });
    } catch (err) {
      addDebugError("verify", err);
      // Lägg till ett felsvar
      setVerificationResults((prev) => {
        const newMap = new Map(prev);
        newMap.set(promiseIndex, {
          status: "UNRESOLVED",
          confidence: "low",
          kpiUsed: null,
          comparison: { before: null, after: null, deltaAbs: null, deltaPct: null },
          notes: err instanceof Error ? err.message : "Verifiering misslyckades",
          reasoning: ["Ett fel uppstod vid verifieringen"],
        });
        return newMap;
      });
    } finally {
      setVerifyingIndices((prev) => {
        const newSet = new Set(prev);
        newSet.delete(promiseIndex);
        return newSet;
      });
    }
  }, [selectedCompany, selectedFiling, filingsData, extractResponse, addDebugError]);

  const handleBatchVerify = useCallback(async (promiseIndexes?: number[]) => {
    if (!selectedCompany || !selectedFiling || !extractResponse) return;

    const promises = extractResponse.extraction.promises || [];
    if (promises.length === 0) return;

    // Bestäm vilka promises som ska verifieras
    let indexesToVerify: number[];
    if (promiseIndexes && promiseIndexes.length > 0) {
      // Verifiera valda promises
      indexesToVerify = promiseIndexes.filter((idx) => 
        idx >= 0 && idx < promises.length && isVerifiableType(promises[idx].type)
      );
    } else {
      // Verifiera alla verifierbara promises
      indexesToVerify = promises
        .map((p, idx) => ({ idx, promise: p }))
        .filter(({ promise }) => isVerifiableType(promise.type))
        .map(({ idx }) => idx);
    }

    if (indexesToVerify.length === 0) {
      addDebugError("verify", new Error("Inga verifierbara promises att verifiera"));
      return;
    }

    // Markera som verifierar
    setBatchVerifying(true);
    setVerifyingIndices((prev) => {
      const newSet = new Set(prev);
      indexesToVerify.forEach((idx) => newSet.add(idx));
      return newSet;
    });

    try {
      const res = await fetch("/api/company/verify-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cik10: selectedCompany.cik,
          companyName: filingsData?.companyName || extractResponse.companyName,
          ticker: selectedCompany.ticker,
          filingAccession: selectedFiling.accessionNumber,
          filingDate: selectedFiling.filingDate,
          promiseDocId: extractResponse.firestoreId || `temp-${selectedFiling.accessionNumber}`,
          promiseIndexes: indexesToVerify,
          promises: promises.map((p) => ({
            text: p.text,
            type: p.type,
            timeHorizon: p.timeHorizon,
            measurable: p.measurable,
            confidence: p.confidence,
          })),
        }),
      });

      const data = await res.json().catch(() => ({ ok: false, error: { message: "Failed to parse JSON response" } }));

      // Handle normalized response format
      if (!res.ok || !data.ok) {
        const errorMsg = data.error?.message || data.message || "Batch verifiering misslyckades";
        addDebugError("verify", new Error(errorMsg), res.status);
        return;
      }

      // Handle success response
      const results = data.data?.results || [];
      if (!Array.isArray(results)) {
        throw new Error("Ogiltigt svar från batch verify API");
      }

      // Uppdatera verification results
      setVerificationResults((prev) => {
        const newMap = new Map(prev);
        results.forEach((result: any) => {
          if (result.promiseIndex !== undefined && result.status) {
            newMap.set(result.promiseIndex, {
              status: result.status,
              confidence: result.confidence,
              kpiUsed: result.kpiUsed,
              comparison: result.comparison,
              notes: result.notes,
              reasoning: result.reasoning || [],
            });
          }
        });
        return newMap;
      });

      // Rensa valda promises
      setSelectedPromiseIndices(new Set());
    } catch (err) {
      addDebugError("verify", err);
    } finally {
      setBatchVerifying(false);
      setVerifyingIndices((prev) => {
        const newSet = new Set(prev);
        indexesToVerify.forEach((idx) => newSet.delete(idx));
        return newSet;
      });
    }
  }, [selectedCompany, selectedFiling, filingsData, extractResponse, addDebugError]);

  const handleTogglePromiseSelection = useCallback((index: number) => {
    setSelectedPromiseIndices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  const handleSelectAllVerifiable = useCallback(() => {
    if (!extractResponse?.extraction?.promises) return;
    const verifiableIndices = extractResponse.extraction.promises
      .map((p, idx) => ({ idx, promise: p }))
      .filter(({ promise }) => isVerifiableType(promise.type))
      .map(({ idx }) => idx);
    setSelectedPromiseIndices(new Set(verifiableIndices));
  }, [extractResponse]);

  const handleDeselectAll = useCallback(() => {
    setSelectedPromiseIndices(new Set());
  }, []);

  const handleScorePromises = useCallback(async () => {
    if (!extractResponse?.firestoreId) {
      addDebugError("score", new Error("Saknar firestoreId. Extrahera promises först och spara till Firestore."));
      return;
    }

    setScoringLoading(true);

    try {
      const endpoint = "/api/company/score-doc";
      const requestBody = {
        promiseDocId: extractResponse.firestoreId,
      };

      console.log("[score] Calling", endpoint, "with body:", requestBody);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      // Läs text först för att hantera icke-JSON responses
      const responseText = await res.text();
      console.log("[score] Response status:", res.status, "Content-Type:", res.headers.get("content-type"));

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        // Om JSON parse failar, visa texten i debug overlay
        const errorMsg = `Failed to parse JSON response from ${endpoint} (HTTP ${res.status})`;
        const errorDetails = `Response was not valid JSON:\n\n${responseText.substring(0, 500)}${responseText.length > 500 ? '...' : ''}`;
        addDebugError("score", new Error(errorMsg), res.status, errorDetails);
        return;
      }

      // Hantera response
      if (!res.ok || !data.ok) {
        const errorCode = data.error?.code || "UNKNOWN_ERROR";
        const errorMsg = data.error?.message || data.message || "Scoring misslyckades";
        const errorDetails = data.error?.details 
          ? `Code: ${errorCode}\nDetails: ${data.error.details}` 
          : undefined;
        
        const fullErrorMsg = `${endpoint} returned ${res.status}: ${errorMsg}`;
        addDebugError("score", new Error(fullErrorMsg), res.status, errorDetails);
        return;
      }

      // Success
      const result = data.data;
      if (result) {
        console.log("[score] Success:", result);
        setCompanyScore(result.companyScore ?? null);
        
        // Uppdatera promises med scores från response
        if (result.promises && Array.isArray(result.promises)) {
          setExtractResponse((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              extraction: {
                ...prev.extraction,
                promises: prev.extraction.promises.map((p, idx) => {
                  const scoredPromise = result.promises[idx];
                  if (scoredPromise?.score) {
                    return {
                      ...p,
                      score: scoredPromise.score,
                    };
                  }
                  return p;
                }),
              },
            };
          });
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      addDebugError("score", new Error(`Network or unexpected error: ${errorMsg}`));
    } finally {
      setScoringLoading(false);
    }
  }, [extractResponse, addDebugError]);

  const handleReset = useCallback(() => {
    setStep("search");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedCompany(null);
    setFilingsData(null);
    setSelectedFiling(null);
    setExtractResponse(null);
    setTypeFilter("ALL");
    setConfidenceFilter("ALL");
    setKpiResponse(null);
    setKpiError(null);
    setKpiFilter("ALL");
    setActiveTab("promises");
    setError(null);
    setVerificationResults(new Map());
    setVerifyingIndices(new Set());
    setSelectedVerification(null);
    setSelectedPromiseIndices(new Set());
    setBatchVerifying(false);
    setCompanyScore(null);
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

  const getConfidenceBadge = (conf: string) => {
    switch (conf) {
      case "high": return "🟢";
      case "medium": return "🟡";
      case "low": return "🔴";
      default: return "⚪";
    }
  };

  const getTypeColor = (type: PromiseType) => {
    const colors: Record<PromiseType, string> = {
      REVENUE: "#22c55e",
      MARGIN: "#3b82f6",
      COSTS: "#f97316",
      CAPEX: "#8b5cf6",
      DEBT: "#ef4444",
      STRATEGY: "#06b6d4",
      PRODUCT: "#ec4899",
      MARKET: "#eab308",
      OTHER: "#6b7280",
    };
    return colors[type];
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
        {/* Debug Overlay */}
        <DebugOverlay
          errors={debugErrors}
          visible={debugVisible}
          onClear={clearDebugErrors}
          onClose={closeDebugOverlay}
        />
        
        {/* Header */}
        <header style={styles.header}>
          <Link href="/" style={styles.backLink}>← Tillbaka till Macro</Link>
          <div style={styles.titleGroup}>
            <h1 style={styles.title}>
              <span style={styles.titleAccent}>◆</span> Company Engine
            </h1>
            <span style={styles.badge}>V2</span>
            <span style={styles.badgeVerify}>+Verify</span>
          </div>
          <p style={styles.subtitle}>
            Sök bolag → Välj 10-K/10-Q → Extrahera promises → Verifiera mot KPI
          </p>
        </header>

        {/* Progress */}
        <div style={styles.progress}>
          <div style={{...styles.progressStep, ...(step === "search" ? styles.progressStepActive : {})}}>
            1. Sök
          </div>
          <div style={styles.progressArrow}>→</div>
          <div style={{...styles.progressStep, ...(step === "filings" ? styles.progressStepActive : {})}}>
            2. Filing
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
                placeholder="Ange ticker (t.ex. AAPL, MSFT) eller bolagsnamn..."
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
              <h2 style={styles.companyName}>{filingsData?.companyName ?? "Okänt bolag"}</h2>
              <div style={styles.companyTickers}>
                {filingsData?.tickers?.map((t) => (
                  <span key={t} style={styles.tickerBadge}>{t}</span>
                ))}
              </div>
            </div>

            {/* KPI Section */}
            <div style={styles.kpiSection}>
              <h3 style={styles.sectionTitle}>📊 KPI (XBRL Data)</h3>
              <p style={styles.kpiDescription}>
                Hämta numeriska KPI:er direkt från SEC XBRL Company Facts.
              </p>
              <button
                onClick={handleFetchKpis}
                disabled={kpiLoading}
                style={{
                  ...styles.button,
                  ...styles.buttonKpi,
                  ...(kpiLoading ? styles.buttonDisabled : {}),
                }}
              >
                {kpiLoading ? "Hämtar..." : "📈 Hämta KPI (XBRL)"}
              </button>

              {kpiError && (
                <div style={styles.kpiErrorBox}>
                  <span>⚠</span> {kpiError}
                </div>
              )}

              {kpiResponse && (
                <div style={styles.kpiResults}>
                  <div style={styles.kpiSummary}>
                    <span>✓ {kpiResponse?.summary?.totalKpis ?? 0} KPIs</span>
                    <span>|</span>
                    <span>{kpiResponse?.summary?.uniqueMetrics ?? 0} metrics</span>
                    <span>|</span>
                    <span>År: {kpiResponse?.summary?.coverageYears?.slice(0, 3).join(", ") ?? "N/A"}</span>
                  </div>
                </div>
              )}
            </div>

            <hr style={styles.divider} />

            <h3 style={styles.sectionTitle}>📄 Välj 10-K eller 10-Q för Promise Extraction</h3>
            
            <div style={styles.infoBox}>
              <span style={styles.infoIcon}>💡</span>
              <span>
                Endast <strong>10-K</strong> (årsredovisning) och <strong>10-Q</strong> (kvartalsrapport) 
                visas. Dessa innehåller MD&A med framåtblickande uttalanden.
              </span>
            </div>

            {supportedFilings.length === 0 ? (
              <div style={styles.emptyState}>
                <p>Inga 10-K eller 10-Q filings hittades för detta bolag.</p>
              </div>
            ) : (
              <div style={styles.filingsGrid}>
                {supportedFilings.slice(0, 20).map((filing) => (
                  <div
                    key={filing.accessionNumber}
                    style={{
                      ...styles.filingCard,
                      borderColor: filing.form.includes("10-K") 
                        ? "var(--accent-blue)" 
                        : "var(--accent-purple)",
                    }}
                    onClick={() => handleSelectFiling(filing)}
                  >
                    <div style={{
                      ...styles.filingForm,
                      color: filing.form.includes("10-K") 
                        ? "var(--accent-blue)" 
                        : "var(--accent-purple)",
                    }}>
                      {filing.form}
                    </div>
                    <div style={styles.filingDate}>{filing.filingDate}</div>
                    <div style={styles.filingSize}>{formatFileSize(filing.size)}</div>
                  </div>
                ))}
              </div>
            )}

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
                disabled={loading || !isSupportedForm(selectedFiling.form)}
                style={{
                  ...styles.button, 
                  ...styles.buttonLarge, 
                  ...(loading || !isSupportedForm(selectedFiling.form) ? styles.buttonDisabled : {})
                }}
              >
                {loading ? "Extraherar..." : "🔍 Extrahera Promises"}
              </button>
              <p style={styles.actionHint}>
                Hämtar dokumentet, parsar MD&A-sektionen och extraherar framåtblickande uttalanden.
              </p>
            </div>

            <button onClick={() => setStep("filings")} style={styles.resetButton}>
              ← Tillbaka till filings
            </button>
          </section>
        )}

        {/* Step: Results */}
        {step === "results" && extractResponse && (
          <section style={styles.section}>
            {/* Tab Navigation */}
            <div style={styles.tabNav}>
              <button
                style={{
                  ...styles.tabButton,
                  ...(activeTab === "promises" ? styles.tabButtonActive : {}),
                }}
                onClick={() => setActiveTab("promises")}
              >
                📝 Promises ({extractResponse?.extraction?.extractedCount ?? 0})
              </button>
              <button
                style={{
                  ...styles.tabButton,
                  ...(activeTab === "kpis" ? styles.tabButtonActive : {}),
                }}
                onClick={() => {
                  setActiveTab("kpis");
                  if (!kpiResponse && !kpiLoading) {
                    handleFetchKpis();
                  }
                }}
              >
                📊 KPIs {kpiResponse ? `(${kpiResponse?.summary?.totalKpis ?? 0})` : ""}
              </button>
            </div>

            {/* Promises Tab */}
            {activeTab === "promises" && (
              <>
                <div style={styles.resultsSummary}>
                  <h3 style={styles.sectionTitle}>Extraktionsresultat</h3>
                  
                  <div style={styles.metaInfo}>
                    <span>📄 {extractResponse?.formType ?? "N/A"}</span>
                    <span>📍 {extractResponse?.textSource ?? "N/A"}</span>
                    <span>📝 {(extractResponse?.textLength ?? 0).toLocaleString()} tecken</span>
                  </div>

                  <div style={styles.statsGrid}>
                    {companyScore !== null && (
                      <div style={{
                        ...styles.statCard,
                        gridColumn: "1 / -1",
                        backgroundColor: companyScore >= 80 
                          ? "rgba(34, 197, 94, 0.1)" 
                          : companyScore >= 50 
                          ? "rgba(251, 146, 60, 0.1)" 
                          : "rgba(239, 68, 68, 0.1)",
                        border: `2px solid ${companyScore >= 80 
                          ? "var(--accent-green)" 
                          : companyScore >= 50 
                          ? "var(--accent-orange)" 
                          : "var(--accent-red)"}`,
                      }}>
                        <div style={{
                          ...styles.statValue,
                          color: companyScore >= 80 
                            ? "var(--accent-green)" 
                            : companyScore >= 50 
                            ? "var(--accent-orange)" 
                            : "var(--accent-red)",
                        }}>
                          {companyScore.toFixed(0)}
                        </div>
                        <div style={styles.statLabel}>Company Score</div>
                      </div>
                    )}
                    <div style={styles.statCard}>
                      <div style={styles.statValue}>{extractResponse?.extraction?.totalSentences ?? 0}</div>
                      <div style={styles.statLabel}>Meningar</div>
                    </div>
                    <div style={styles.statCard}>
                      <div style={styles.statValue}>{extractResponse?.extraction?.extractedCount ?? 0}</div>
                      <div style={styles.statLabel}>Promises</div>
                    </div>
                    <div style={styles.statCard}>
                      <div style={styles.statValue}>{extractResponse?.extraction?.summary?.byConfidence?.high ?? 0}</div>
                      <div style={styles.statLabel}>High conf.</div>
                    </div>
                    <div style={styles.statCard}>
                      <div style={styles.statValue}>{verificationResults.size}</div>
                      <div style={styles.statLabel}>Verifierade</div>
                    </div>
                  </div>
                </div>

                {/* Score Summary Panel */}
                {scoreStats.hasScoring ? (
                  <div style={styles.scoreSummaryPanel}>
                    <h3 style={styles.sectionTitle}>📊 Score Summary</h3>
                    
                    <div style={styles.scoreSummaryGrid}>
                      <div style={styles.scoreSummaryCard}>
                        <div style={styles.scoreSummaryValue}>
                          {companyScore !== null ? companyScore.toFixed(0) : "N/A"}
                        </div>
                        <div style={styles.scoreSummaryLabel}>Company Score</div>
                      </div>
                      
                      <div style={styles.scoreSummaryCard}>
                        <div style={styles.scoreSummaryValue}>{scoreStats.scoredCount}</div>
                        <div style={styles.scoreSummaryLabel}>Scored Promises</div>
                      </div>
                    </div>

                    <div style={styles.scoreCountsGrid}>
                      <div style={{...styles.scoreCountBadge, backgroundColor: "rgba(34, 197, 94, 0.1)", color: "var(--accent-green)"}}>
                        ✅ HELD: {scoreStats.counts.HELD}
                      </div>
                      <div style={{...styles.scoreCountBadge, backgroundColor: "rgba(251, 146, 60, 0.1)", color: "var(--accent-orange)"}}>
                        ⚠️ MIXED: {scoreStats.counts.MIXED}
                      </div>
                      <div style={{...styles.scoreCountBadge, backgroundColor: "rgba(239, 68, 68, 0.1)", color: "var(--accent-red)"}}>
                        ❌ FAILED: {scoreStats.counts.FAILED}
                      </div>
                      <div style={{...styles.scoreCountBadge, backgroundColor: "rgba(156, 163, 175, 0.1)", color: "var(--text-muted)"}}>
                        ❓ UNCLEAR: {scoreStats.counts.UNCLEAR}
                      </div>
                    </div>

                    {(scoreStats.top5.length > 0 || scoreStats.bottom5.length > 0) && (
                      <div style={styles.topBottomSection}>
                        {scoreStats.top5.length > 0 && (
                          <div style={styles.topBottomList}>
                            <h4 style={styles.topBottomTitle}>🏆 Top 5 Promises</h4>
                            {scoreStats.top5.map((promise, idx) => {
                              const score = typeof promise.score?.score0to100 === "string" 
                                ? parseFloat(promise.score.score0to100) 
                                : typeof promise.score?.score0to100 === "number"
                                ? promise.score.score0to100
                                : 0;
                              const status = promise.score?.status || "UNCLEAR";
                              const shortText = promise.text.length > 100 
                                ? promise.text.substring(0, 100) + "..." 
                                : promise.text;
                              return (
                                <div key={idx} style={styles.promiseSummaryItem}>
                                  <div style={styles.promiseSummaryHeader}>
                                    <span style={{
                                      ...styles.promiseSummaryScore,
                                      color: score >= 80 
                                        ? "var(--accent-green)" 
                                        : score >= 50 
                                        ? "var(--accent-orange)" 
                                        : "var(--accent-red)",
                                    }}>
                                      {score.toFixed(0)}
                                    </span>
                                    <span style={{
                                      ...styles.promiseSummaryStatus,
                                      backgroundColor: SCORE_STATUS_CONFIG[status]?.color + "20",
                                      color: SCORE_STATUS_CONFIG[status]?.color,
                                    }}>
                                      {SCORE_STATUS_CONFIG[status]?.emoji} {SCORE_STATUS_CONFIG[status]?.label}
                                    </span>
                                  </div>
                                  <div style={styles.promiseSummaryText}>{shortText}</div>
                                  {promise.score?.reasons && promise.score.reasons.length > 0 && (
                                    <details style={styles.promiseSummaryDetails}>
                                      <summary style={styles.promiseSummarySummary}>Visa reasons</summary>
                                      <ul style={styles.promiseSummaryReasons}>
                                        {promise.score.reasons.map((reason, rIdx) => (
                                          <li key={rIdx}>{reason}</li>
                                        ))}
                                      </ul>
                                    </details>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {scoreStats.bottom5.length > 0 && (
                          <div style={styles.topBottomList}>
                            <h4 style={styles.topBottomTitle}>📉 Bottom 5 Promises</h4>
                            {scoreStats.bottom5.map((promise, idx) => {
                              const score = typeof promise.score?.score0to100 === "string" 
                                ? parseFloat(promise.score.score0to100) 
                                : typeof promise.score?.score0to100 === "number"
                                ? promise.score.score0to100
                                : 0;
                              const status = promise.score?.status || "UNCLEAR";
                              const shortText = promise.text.length > 100 
                                ? promise.text.substring(0, 100) + "..." 
                                : promise.text;
                              return (
                                <div key={idx} style={styles.promiseSummaryItem}>
                                  <div style={styles.promiseSummaryHeader}>
                                    <span style={{
                                      ...styles.promiseSummaryScore,
                                      color: score >= 80 
                                        ? "var(--accent-green)" 
                                        : score >= 50 
                                        ? "var(--accent-orange)" 
                                        : "var(--accent-red)",
                                    }}>
                                      {score.toFixed(0)}
                                    </span>
                                    <span style={{
                                      ...styles.promiseSummaryStatus,
                                      backgroundColor: SCORE_STATUS_CONFIG[status]?.color + "20",
                                      color: SCORE_STATUS_CONFIG[status]?.color,
                                    }}>
                                      {SCORE_STATUS_CONFIG[status]?.emoji} {SCORE_STATUS_CONFIG[status]?.label}
                                    </span>
                                  </div>
                                  <div style={styles.promiseSummaryText}>{shortText}</div>
                                  {promise.score?.reasons && promise.score.reasons.length > 0 && (
                                    <details style={styles.promiseSummaryDetails}>
                                      <summary style={styles.promiseSummarySummary}>Visa reasons</summary>
                                      <ul style={styles.promiseSummaryReasons}>
                                        {promise.score.reasons.map((reason, rIdx) => (
                                          <li key={rIdx}>{reason}</li>
                                        ))}
                                      </ul>
                                    </details>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={styles.scoreSummaryPanel}>
                    <div style={styles.scoreSummaryHint}>
                      💡 Kör "Scorea promises" för att få scorecard och analys.
                    </div>
                  </div>
                )}

                <div style={styles.filtersSection}>
                  <h4 style={styles.subTitle}>Filter</h4>
                  <div style={styles.filtersRow}>
                    <div style={styles.filterGroup}>
                      <label style={styles.filterLabel}>Typ</label>
                      <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value as PromiseType | "ALL")}
                        style={styles.select}
                      >
                        <option value="ALL">Alla typer</option>
                        {(Object.keys(TYPE_LABELS) as PromiseType[]).map((type) => (
                          <option key={type} value={type}>
                            {TYPE_LABELS[type]} ({extractResponse?.extraction?.summary?.byType?.[type] || 0})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={styles.filterGroup}>
                      <label style={styles.filterLabel}>Confidence</label>
                      <select
                        value={confidenceFilter}
                        onChange={(e) => setConfidenceFilter(e.target.value as "high" | "medium" | "low" | "ALL")}
                        style={styles.select}
                      >
                        <option value="ALL">Alla</option>
                        <option value="high">🟢 High</option>
                        <option value="medium">🟡 Medium</option>
                        <option value="low">🔴 Low</option>
                      </select>
                    </div>

                    <div style={styles.filterCount}>
                      {filteredPromises.length} av {extractResponse?.extraction?.extractedCount ?? 0} promises
                    </div>
                  </div>
                </div>

                {/* Verification Details Panel */}
                {selectedVerification && (
                  <div style={styles.verificationPanel}>
                    <div style={styles.verificationHeader}>
                      <h4 style={styles.verificationTitle}>
                        {STATUS_CONFIG[selectedVerification.result.status].emoji} Verifieringsdetaljer
                      </h4>
                      <button 
                        onClick={() => setSelectedVerification(null)}
                        style={styles.closeButton}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={styles.verificationContent}>
                      <div style={styles.verificationRow}>
                        <span style={styles.verificationLabel}>Status:</span>
                        <span style={{ color: STATUS_CONFIG[selectedVerification.result.status].color, fontWeight: 600 }}>
                          {STATUS_CONFIG[selectedVerification.result.status].label}
                        </span>
                      </div>
                      {selectedVerification.result.kpiUsed && (
                        <div style={styles.verificationRow}>
                          <span style={styles.verificationLabel}>KPI använd:</span>
                          <span>{selectedVerification.result.kpiUsed.label}</span>
                        </div>
                      )}
                      {selectedVerification.result.comparison.before && selectedVerification.result.comparison.after && (
                        <div style={styles.comparisonGrid}>
                          <div style={styles.comparisonCard}>
                            <div style={styles.comparisonLabel}>Före ({selectedVerification.result.comparison.before.period})</div>
                            <div style={styles.comparisonValue}>
                              {formatKpiValue(selectedVerification.result.comparison.before.value, selectedVerification.result.comparison.before.unit)}
                            </div>
                          </div>
                          <div style={styles.comparisonArrow}>→</div>
                          <div style={styles.comparisonCard}>
                            <div style={styles.comparisonLabel}>Efter ({selectedVerification.result.comparison.after.period})</div>
                            <div style={styles.comparisonValue}>
                              {formatKpiValue(selectedVerification.result.comparison.after.value, selectedVerification.result.comparison.after.unit)}
                            </div>
                          </div>
                          {selectedVerification.result.comparison.deltaPct !== null && (
                            <div style={{
                              ...styles.deltaCard,
                              backgroundColor: selectedVerification.result.comparison.deltaPct >= 0 
                                ? "rgba(34, 197, 94, 0.1)" 
                                : "rgba(239, 68, 68, 0.1)",
                              color: selectedVerification.result.comparison.deltaPct >= 0 
                                ? "var(--accent-green)" 
                                : "var(--accent-red)",
                            }}>
                              <div style={styles.deltaLabel}>Δ%</div>
                              <div style={styles.deltaValue}>
                                {selectedVerification.result.comparison.deltaPct > 0 ? "+" : ""}
                                {selectedVerification.result.comparison.deltaPct.toFixed(1)}%
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div style={styles.verificationNotes}>
                        <strong>Notering:</strong> {selectedVerification.result.notes}
                      </div>
                    </div>
                  </div>
                )}

                {/* Batch Verification Controls */}
                {extractResponse && extractResponse.extraction.promises && extractResponse.extraction.promises.length > 0 && (
                  <div style={{
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "center",
                    marginBottom: "1rem",
                    padding: "0.75rem",
                    backgroundColor: "var(--surface-secondary)",
                    borderRadius: "0.5rem",
                  }}>
                    <button
                      onClick={() => handleBatchVerify()}
                      disabled={batchVerifying}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: batchVerifying ? "var(--text-muted)" : "var(--accent-blue)",
                        color: "white",
                        border: "none",
                        borderRadius: "0.375rem",
                        cursor: batchVerifying ? "not-allowed" : "pointer",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                      }}
                    >
                      {batchVerifying ? "Verifierar..." : "Verifiera alla (KPI)"}
                    </button>
                    <button
                      onClick={() => handleBatchVerify(Array.from(selectedPromiseIndices))}
                      disabled={batchVerifying || selectedPromiseIndices.size === 0}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: (batchVerifying || selectedPromiseIndices.size === 0) ? "var(--text-muted)" : "var(--accent-green)",
                        color: "white",
                        border: "none",
                        borderRadius: "0.375rem",
                        cursor: (batchVerifying || selectedPromiseIndices.size === 0) ? "not-allowed" : "pointer",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                      }}
                    >
                      {batchVerifying ? "Verifierar..." : `Verifiera valda (${selectedPromiseIndices.size})`}
                    </button>
                    <button
                      onClick={handleSelectAllVerifiable}
                      disabled={batchVerifying}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "transparent",
                        color: "var(--accent-blue)",
                        border: "1px solid var(--accent-blue)",
                        borderRadius: "0.375rem",
                        cursor: batchVerifying ? "not-allowed" : "pointer",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                      }}
                    >
                      Välj alla
                    </button>
                    <button
                      onClick={handleDeselectAll}
                      disabled={batchVerifying}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "transparent",
                        color: "var(--text-muted)",
                        border: "1px solid var(--text-muted)",
                        borderRadius: "0.375rem",
                        cursor: batchVerifying ? "not-allowed" : "pointer",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                      }}
                    >
                      Rensa val
                    </button>
                    {selectedPromiseIndices.size > 0 && (
                      <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>
                        {selectedPromiseIndices.size} valda
                      </span>
                    )}
                    <div style={{ marginLeft: "auto" }}>
                      <button
                        onClick={handleScorePromises}
                        disabled={scoringLoading || !extractResponse?.firestoreId}
                        style={{
                          padding: "0.5rem 1rem",
                          backgroundColor: (scoringLoading || !extractResponse?.firestoreId) ? "var(--text-muted)" : "var(--accent-purple)",
                          color: "white",
                          border: "none",
                          borderRadius: "0.375rem",
                          cursor: (scoringLoading || !extractResponse?.firestoreId) ? "not-allowed" : "pointer",
                          fontWeight: 600,
                          fontSize: "0.875rem",
                        }}
                        title={!extractResponse?.firestoreId ? "Spara promises till Firestore först" : ""}
                      >
                        {scoringLoading ? "Scorear..." : "Scorea promises"}
                      </button>
                    </div>
                  </div>
                )}

                <div style={styles.tableContainer}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={{...styles.th, width: "40px"}}>
                          <input
                            type="checkbox"
                            checked={
                              (() => {
                                if (!extractResponse?.extraction?.promises) return false;
                                const verifiablePromises = extractResponse.extraction.promises.filter((p) => isVerifiableType(p.type));
                                if (verifiablePromises.length === 0) return false;
                                const verifiableIndices = extractResponse.extraction.promises
                                  .map((p, idx) => ({ idx, promise: p }))
                                  .filter(({ promise }) => isVerifiableType(promise.type))
                                  .map(({ idx }) => idx);
                                return verifiableIndices.every((idx) => selectedPromiseIndices.has(idx));
                              })()
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                handleSelectAllVerifiable();
                              } else {
                                handleDeselectAll();
                              }
                            }}
                            disabled={batchVerifying}
                            style={{ cursor: batchVerifying ? "not-allowed" : "pointer" }}
                          />
                        </th>
                        <th style={styles.th}>Typ</th>
                        <th style={styles.th}>Conf.</th>
                        <th style={{...styles.th, width: "40%"}}>Claim</th>
                        <th style={styles.th}>Verifiering</th>
                        <th style={styles.th}>Score</th>
                        <th style={styles.th}>Åtgärd</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPromises.map((promise, idx) => {
                        const globalIndex = extractResponse?.extraction?.promises?.indexOf(promise) ?? -1;
                        const verification = globalIndex >= 0 ? verificationResults.get(globalIndex) : undefined;
                        const isVerifying = globalIndex >= 0 ? verifyingIndices.has(globalIndex) : false;
                        const canVerify = isVerifiableType(promise.type);

                        // Skip if globalIndex is invalid
                        if (globalIndex < 0) {
                          return null;
                        }

                        return (
                          <tr key={idx} style={styles.tr}>
                            <td style={styles.td}>
                              {canVerify ? (
                                <input
                                  type="checkbox"
                                  checked={selectedPromiseIndices.has(globalIndex)}
                                  onChange={() => handleTogglePromiseSelection(globalIndex)}
                                  disabled={batchVerifying || isVerifying}
                                  style={{ cursor: (batchVerifying || isVerifying) ? "not-allowed" : "pointer" }}
                                />
                              ) : (
                                <span style={{ color: "var(--text-muted)" }}>—</span>
                              )}
                            </td>
                            <td style={styles.td}>
                              <span style={{
                                ...styles.typeBadge,
                                backgroundColor: getTypeColor(promise.type) + "20",
                                color: getTypeColor(promise.type),
                              }}>
                                {TYPE_LABELS[promise.type] || promise.type}
                              </span>
                            </td>
                            <td style={styles.td}>
                              <span style={{ color: getConfidenceColor(promise.confidence) }}>
                                {getConfidenceBadge(promise.confidence)} {promise.confidenceScore ?? 0}
                              </span>
                            </td>
                            <td style={styles.tdText}>
                              <p style={styles.promiseText}>{promise.text || ""}</p>
                              {promise.keywords && promise.keywords.length > 0 && (
                                <div style={styles.keywordRow}>
                                  {promise.keywords.slice(0, 3).map((kw, i) => (
                                    <span key={i} style={styles.keywordTag}>{kw}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={styles.td}>
                              {verification ? (
                                <div 
                                  style={{ 
                                    ...styles.verificationStatus, 
                                    cursor: "pointer",
                                    color: STATUS_CONFIG[verification.status]?.color || "var(--text-muted)"
                                  }}
                                  onClick={() => setSelectedVerification({ index: globalIndex, result: verification })}
                                  title={
                                    verification.status === "UNRESOLVED" 
                                      ? `Varför kunde denna inte verifieras? ${verification.notes || "Klicka för detaljer"}`
                                      : "Klicka för detaljer"
                                  }
                                >
                                  <span>{STATUS_CONFIG[verification.status]?.emoji || "❓"}</span>
                                  <span>{STATUS_CONFIG[verification.status]?.label || verification.status}</span>
                                  {verification.comparison?.deltaPct !== null && verification.comparison?.deltaPct !== undefined && (
                                    <span style={styles.deltaBadge}>
                                      {verification.comparison.deltaPct > 0 ? "+" : ""}
                                      {verification.comparison.deltaPct.toFixed(1)}%
                                    </span>
                                  )}
                                  {verification.status === "UNRESOLVED" && (
                                    <span style={{ fontSize: "0.7rem", marginLeft: "0.25rem", opacity: 0.7 }} title={verification.notes}>
                                      ℹ️
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={styles.notVerified}>—</span>
                              )}
                            </td>
                            <td style={styles.td}>
                              {promise.score ? (
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-start" }}>
                                  <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.375rem",
                                    fontSize: "0.8rem",
                                  }}>
                                    <span style={{
                                      fontWeight: 700,
                                      fontFamily: "'JetBrains Mono', monospace",
                                      color: promise.score.score0to100 >= 80 
                                        ? "var(--accent-green)" 
                                        : promise.score.score0to100 >= 50 
                                        ? "var(--accent-orange)" 
                                        : "var(--accent-red)",
                                    }}>
                                      {promise.score.score0to100.toFixed(0)}
                                    </span>
                                    <span style={{
                                      ...styles.typeBadge,
                                      backgroundColor: SCORE_STATUS_CONFIG[promise.score.status]?.color + "20",
                                      color: SCORE_STATUS_CONFIG[promise.score.status]?.color,
                                    }}>
                                      {SCORE_STATUS_CONFIG[promise.score.status]?.emoji} {SCORE_STATUS_CONFIG[promise.score.status]?.label}
                                    </span>
                                  </div>
                                  {promise.score.reasons && promise.score.reasons.length > 0 && (
                                    <span 
                                      style={{ 
                                        fontSize: "0.65rem", 
                                        color: "var(--text-muted)",
                                        maxWidth: "200px",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                      title={promise.score.reasons.join("; ")}
                                    >
                                      {promise.score.reasons[0]}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={styles.notVerified}>—</span>
                              )}
                            </td>
                            <td style={styles.td}>
                              {canVerify ? (
                                <button
                                  onClick={() => handleVerifyPromise(globalIndex, promise)}
                                  disabled={isVerifying || !!verification}
                                  style={{
                                    ...styles.verifyButton,
                                    ...(isVerifying || verification ? styles.verifyButtonDisabled : {}),
                                  }}
                                >
                                  {isVerifying ? "..." : verification ? "✓" : "Verifiera"}
                                </button>
                              ) : (
                                <span style={styles.notVerifiable} title="Denna typ kan inte verifieras mot KPI">
                                  N/A
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filteredPromises.length === 0 && (
                    <div style={styles.emptyTable}>
                      Inga promises matchar valda filter.
                    </div>
                  )}
                </div>
              </>
            )}

            {/* KPIs Tab */}
            {activeTab === "kpis" && (
              <div style={styles.kpiTabContent}>
                {kpiLoading && (
                  <div style={styles.loadingState}>
                    <p>Hämtar KPI:er från SEC XBRL...</p>
                  </div>
                )}

                {kpiError && (
                  <div style={styles.kpiErrorBox}>
                    <span>⚠</span> {kpiError}
                  </div>
                )}

                {kpiResponse && (
                  <>
                    <div style={styles.kpiSummaryLarge}>
                      <div style={styles.statCard}>
                        <div style={styles.statValue}>{kpiResponse?.summary?.totalKpis ?? 0}</div>
                        <div style={styles.statLabel}>Total KPIs</div>
                      </div>
                      <div style={styles.statCard}>
                        <div style={styles.statValue}>{kpiResponse?.summary?.uniqueMetrics ?? 0}</div>
                        <div style={styles.statLabel}>Unika metrics</div>
                      </div>
                      <div style={styles.statCard}>
                        <div style={styles.statValue}>{kpiResponse?.summary?.coverageYears?.[0] ?? "N/A"}</div>
                        <div style={styles.statLabel}>Senaste FY</div>
                      </div>
                    </div>

                    <div style={styles.kpiFilterRow}>
                      <select
                        value={kpiFilter}
                        onChange={(e) => setKpiFilter(e.target.value)}
                        style={styles.select}
                      >
                        <option value="ALL">Alla KPIs</option>
                        {uniqueKpiKeys.map((key) => (
                          <option key={key} value={key}>
                            {kpiResponse?.kpis?.find((k) => k?.key === key)?.label || key}
                          </option>
                        ))}
                      </select>
                      <span style={styles.kpiCount}>
                        {filteredKpis.length} visas
                      </span>
                    </div>

                    <div style={styles.kpiTableContainer}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>KPI</th>
                            <th style={styles.th}>Period</th>
                            <th style={{...styles.th, textAlign: "right"}}>Värde</th>
                            <th style={styles.th}>Form</th>
                            <th style={styles.th}>Filed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredKpis.map((kpi, idx) => (
                            <tr key={`${kpi.key}-${kpi.period}-${idx}`} style={styles.tr}>
                              <td style={styles.td}>
                                <span style={styles.kpiLabel}>{kpi.label}</span>
                              </td>
                              <td style={styles.td}>
                                <span style={{
                                  ...styles.periodBadge,
                                  backgroundColor: kpi.periodType === "annual" 
                                    ? "rgba(34, 197, 94, 0.15)" 
                                    : "rgba(59, 130, 246, 0.15)",
                                  color: kpi.periodType === "annual"
                                    ? "var(--accent-green)"
                                    : "var(--accent-blue)",
                                }}>
                                  {kpi.period}
                                </span>
                              </td>
                              <td style={{...styles.td, textAlign: "right", fontFamily: "'JetBrains Mono', monospace"}}>
                                {formatKpiValue(kpi.value, kpi.unit)}
                              </td>
                              <td style={styles.td}>
                                <span style={styles.formBadge}>{kpi.form}</span>
                              </td>
                              <td style={{...styles.td, color: "var(--text-muted)", fontSize: "0.8rem"}}>
                                {kpi.filedDate}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {!kpiLoading && !kpiResponse && !kpiError && (
                  <div style={styles.emptyState}>
                    <p>Klicka på knappen ovan för att hämta KPI:er.</p>
                  </div>
                )}
              </div>
            )}

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
            | KPI via XBRL | Promise Verification
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
    maxWidth: "1200px",
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
    backgroundColor: "var(--accent-green)",
    color: "white",
    borderRadius: "4px",
    letterSpacing: "0.05em",
  },
  badgeVerify: {
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
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--border-color)",
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
  infoBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
    padding: "1rem",
    backgroundColor: "rgba(59, 130, 246, 0.08)",
    border: "1px solid rgba(59, 130, 246, 0.2)",
    borderRadius: "8px",
    marginBottom: "1rem",
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
  },
  infoIcon: {
    fontSize: "1rem",
    flexShrink: 0,
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
    opacity: 0.5,
    cursor: "not-allowed",
  },
  buttonLarge: {
    padding: "1rem 2rem",
    fontSize: "1rem",
  },
  buttonKpi: {
    backgroundColor: "var(--accent-purple)",
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
  emptyState: {
    padding: "2rem",
    textAlign: "center",
    color: "var(--text-muted)",
  },
  loadingState: {
    padding: "2rem",
    textAlign: "center",
    color: "var(--text-muted)",
  },
  filingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: "0.75rem",
    marginBottom: "1rem",
  },
  filingCard: {
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: "var(--border-color)",
    borderRadius: "8px",
    cursor: "pointer",
    textAlign: "center",
    transition: "all 0.2s ease",
  },
  filingForm: {
    fontWeight: 700,
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
  metaInfo: {
    display: "flex",
    gap: "1.5rem",
    marginBottom: "1rem",
    fontSize: "0.85rem",
    color: "var(--text-muted)",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
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
  subTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.75rem",
  },
  filtersSection: {
    marginBottom: "1.5rem",
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    borderRadius: "8px",
    border: "1px solid var(--border-color)",
  },
  filtersRow: {
    display: "flex",
    gap: "1.5rem",
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  filterGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
  },
  filterLabel: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  select: {
    padding: "0.5rem 0.75rem",
    fontSize: "0.85rem",
    fontFamily: "inherit",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
    color: "var(--text-primary)",
    cursor: "pointer",
    minWidth: "150px",
  },
  filterCount: {
    fontSize: "0.85rem",
    color: "var(--text-muted)",
    marginLeft: "auto",
  },
  tableContainer: {
    overflowX: "auto",
    borderRadius: "8px",
    border: "1px solid var(--border-color)",
  },
  kpiTableContainer: {
    overflowX: "auto",
    borderRadius: "8px",
    border: "1px solid var(--border-color)",
    maxHeight: "400px",
    overflowY: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.85rem",
  },
  th: {
    padding: "0.75rem 1rem",
    textAlign: "left",
    fontWeight: 600,
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-primary)",
    borderBottom: "1px solid var(--border-color)",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
  },
  tr: {
    borderBottom: "1px solid var(--border-color)",
  },
  td: {
    padding: "0.75rem 1rem",
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  tdText: {
    padding: "0.75rem 1rem",
    verticalAlign: "top",
  },
  typeBadge: {
    display: "inline-block",
    padding: "0.25rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 600,
    borderRadius: "4px",
  },
  promiseText: {
    margin: 0,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    fontSize: "0.85rem",
    maxWidth: "400px",
  },
  keywordRow: {
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
  emptyTable: {
    padding: "2rem",
    textAlign: "center",
    color: "var(--text-muted)",
  },
  footer: {
    marginTop: "2rem",
    paddingTop: "1.5rem",
    borderTop: "1px solid var(--border-color)",
    textAlign: "center",
    fontSize: "0.8rem",
    color: "var(--text-muted)",
  },
  kpiSection: {
    marginBottom: "1.5rem",
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    borderRadius: "8px",
    border: "1px solid var(--border-color)",
  },
  kpiDescription: {
    fontSize: "0.85rem",
    color: "var(--text-muted)",
    marginBottom: "1rem",
  },
  kpiErrorBox: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.75rem 1rem",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    borderRadius: "6px",
    color: "var(--accent-red)",
    marginTop: "1rem",
    fontSize: "0.85rem",
  },
  kpiResults: {
    marginTop: "1rem",
  },
  kpiSummary: {
    display: "flex",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    backgroundColor: "rgba(34, 197, 94, 0.1)",
    borderRadius: "6px",
    fontSize: "0.85rem",
    color: "var(--accent-green)",
    marginBottom: "1rem",
  },
  kpiSummaryLarge: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "1rem",
    marginBottom: "1.5rem",
  },
  kpiFilterRow: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1rem",
  },
  kpiCount: {
    fontSize: "0.85rem",
    color: "var(--text-muted)",
  },
  kpiLabel: {
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  periodBadge: {
    display: "inline-block",
    padding: "0.2rem 0.5rem",
    fontSize: "0.75rem",
    fontWeight: 600,
    borderRadius: "4px",
  },
  formBadge: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
  },
  divider: {
    border: "none",
    borderTop: "1px solid var(--border-color)",
    margin: "1.5rem 0",
  },
  tabNav: {
    display: "flex",
    gap: "0.5rem",
    marginBottom: "1.5rem",
    borderBottom: "1px solid var(--border-color)",
    paddingBottom: "0.5rem",
  },
  tabButton: {
    padding: "0.75rem 1.5rem",
    fontSize: "0.9rem",
    fontWeight: 500,
    fontFamily: "inherit",
    color: "var(--text-secondary)",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "6px 6px 0 0",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  tabButtonActive: {
    color: "var(--accent-blue)",
    backgroundColor: "var(--bg-primary)",
    fontWeight: 600,
  },
  kpiTabContent: {
    minHeight: "300px",
  },
  // Verification styles
  verifyButton: {
    padding: "0.375rem 0.75rem",
    fontSize: "0.75rem",
    fontWeight: 500,
    fontFamily: "inherit",
    color: "white",
    backgroundColor: "var(--accent-purple)",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  verifyButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
    backgroundColor: "var(--text-muted)",
  },
  verificationStatus: {
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    fontSize: "0.8rem",
  },
  deltaBadge: {
    fontSize: "0.7rem",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
  },
  notVerified: {
    color: "var(--text-muted)",
    fontSize: "0.8rem",
  },
  notVerifiable: {
    color: "var(--text-muted)",
    fontSize: "0.75rem",
    fontStyle: "italic",
  },
  verificationPanel: {
    marginBottom: "1.5rem",
    padding: "1rem",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--accent-blue)",
    borderRadius: "8px",
  },
  verificationHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem",
  },
  verificationTitle: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    margin: 0,
  },
  closeButton: {
    padding: "0.25rem 0.5rem",
    fontSize: "0.85rem",
    fontFamily: "inherit",
    color: "var(--text-muted)",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
  },
  verificationContent: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  verificationRow: {
    display: "flex",
    gap: "0.5rem",
    fontSize: "0.85rem",
  },
  verificationLabel: {
    color: "var(--text-muted)",
    minWidth: "100px",
  },
  comparisonGrid: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "0.75rem",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "6px",
    flexWrap: "wrap",
  },
  comparisonCard: {
    textAlign: "center",
  },
  comparisonLabel: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    marginBottom: "0.25rem",
  },
  comparisonValue: {
    fontSize: "1rem",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    color: "var(--text-primary)",
  },
  comparisonArrow: {
    fontSize: "1.25rem",
    color: "var(--text-muted)",
  },
  deltaCard: {
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    textAlign: "center",
  },
  deltaLabel: {
    fontSize: "0.65rem",
    fontWeight: 600,
    marginBottom: "0.125rem",
  },
  deltaValue: {
    fontSize: "1rem",
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
  },
  verificationNotes: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    padding: "0.75rem",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "6px",
    lineHeight: 1.5,
  },
  scoreSummaryPanel: {
    marginBottom: "1.5rem",
    padding: "1.5rem",
    backgroundColor: "var(--bg-primary)",
    borderRadius: "8px",
    border: "1px solid var(--border-color)",
  },
  scoreSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1rem",
    marginBottom: "1rem",
  },
  scoreSummaryCard: {
    padding: "1rem",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
    textAlign: "center",
  },
  scoreSummaryValue: {
    fontSize: "2rem",
    fontWeight: 700,
    color: "var(--accent-blue)",
    marginBottom: "0.25rem",
  },
  scoreSummaryLabel: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  scoreCountsGrid: {
    display: "flex",
    gap: "0.75rem",
    flexWrap: "wrap",
    marginBottom: "1.5rem",
  },
  scoreCountBadge: {
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    fontSize: "0.85rem",
    fontWeight: 600,
  },
  topBottomSection: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1.5rem",
    marginTop: "1.5rem",
  },
  topBottomList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  topBottomTitle: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.5rem",
  },
  promiseSummaryItem: {
    padding: "0.75rem",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "6px",
  },
  promiseSummaryHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginBottom: "0.5rem",
  },
  promiseSummaryScore: {
    fontSize: "1.1rem",
    fontWeight: 700,
  },
  promiseSummaryStatus: {
    padding: "0.25rem 0.5rem",
    fontSize: "0.7rem",
    fontWeight: 600,
    borderRadius: "4px",
  },
  promiseSummaryText: {
    fontSize: "0.8rem",
    color: "var(--text-primary)",
    lineHeight: 1.4,
    marginBottom: "0.5rem",
  },
  promiseSummaryDetails: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
  },
  promiseSummarySummary: {
    cursor: "pointer",
    fontWeight: 600,
    color: "var(--accent-blue)",
  },
  promiseSummaryReasons: {
    marginTop: "0.5rem",
    paddingLeft: "1.25rem",
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
  scoreSummaryHint: {
    padding: "1rem",
    textAlign: "center",
    color: "var(--text-muted)",
    fontSize: "0.9rem",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "6px",
    border: "1px dashed var(--border-color)",
  },
};
