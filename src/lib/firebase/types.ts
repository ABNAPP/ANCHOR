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

