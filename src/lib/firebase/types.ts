import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Snapshot-dokument som sparas i Firestore
 */
export interface MacroSnapshot {
  createdAt: FieldValue | Timestamp;
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

/**
 * Snapshot med ID för läsning
 */
export interface MacroSnapshotWithId extends Omit<MacroSnapshot, "createdAt"> {
  id: string;
  createdAt: string; // ISO string för JSON
}

/**
 * Sammanfattning för historiklistan
 */
export interface MacroSnapshotSummary {
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

// ============================================
// PROMISE VERIFICATION
// ============================================

export type VerificationStatus = 
  | "SUPPORTED"
  | "CONTRADICTED"
  | "UNRESOLVED"
  | "PENDING";

export type VerificationConfidence = "high" | "medium" | "low";

export interface KpiComparisonData {
  before: {
    period: string;
    value: number;
    unit: string;
    filedDate: string;
  } | null;
  after: {
    period: string;
    value: number;
    unit: string;
    filedDate: string;
  } | null;
  deltaAbs: number | null;
  deltaPct: number | null;
}

export interface PromiseVerification {
  createdAt: FieldValue | Timestamp;
  company: {
    cik10: string;
    name: string;
    ticker?: string;
  };
  promiseRef: {
    promiseDocId?: string;
    promiseIndex: number;
    filingAccession: string;
    filingDate: string;
  };
  promise: {
    claim: string;
    type: string;
    timeHorizon: string;
    measurable: boolean;
    confidence: string;
  };
  kpiUsed: {
    key: string;
    label: string;
  } | null;
  comparison: KpiComparisonData;
  status: VerificationStatus;
  verificationConfidence: VerificationConfidence;
  notes: string;
  reasoning: string[];
  source: {
    method: "XBRL_FACTS";
    asOf: string;
  };
}

export interface PromiseVerificationWithId extends Omit<PromiseVerification, "createdAt"> {
  id: string;
  createdAt: string;
}
