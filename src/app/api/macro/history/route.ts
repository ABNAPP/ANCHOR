import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { 
  getFirestoreDb, 
  isFirebaseConfigured, 
  MACRO_SNAPSHOTS_COLLECTION 
} from "@/lib/firebase/admin";
import { MacroSnapshotSummary } from "@/lib/firebase/types";

// ============================================
// PRODUCTION HARDENING: REQUEST ID
// ============================================

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// CONSTANTS
// ============================================

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ============================================
// MAIN API HANDLER
// ============================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = generateRequestId();
  console.log(`[history] Request ${requestId} started`);

  try {
    // PRODUCTION HARDENING: Graceful Firebase degradation
    // Om Firebase inte är konfigurerat → returnera 200 med tom array
    if (!isFirebaseConfigured()) {
      console.log(`[history] Firebase not configured for ${requestId}, returning empty array`);
      return NextResponse.json({
        count: 0,
        limit: DEFAULT_LIMIT,
        snapshots: [],
        message: "Firebase inte konfigurerat. Historik är inte tillgänglig.",
        firebaseEnabled: false,
        requestId,
      });
    }

    const db = getFirestoreDb();
    if (!db) {
      // PRODUCTION: Firebase konfigurerat men kunde inte initieras → returnera 200 med tom array
      console.log(`[history] Firestore not initialized for ${requestId}, returning empty array`);
      return NextResponse.json({
        count: 0,
        limit: DEFAULT_LIMIT,
        snapshots: [],
        message: "Firestore kunde inte initieras. Historik är inte tillgänglig.",
        firebaseEnabled: false,
        requestId,
      });
    }

    // PRODUCTION HARDENING: Input validation (säkra defaults)
    const searchParams = request.nextUrl.searchParams;
    let limit = parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
    
    // Validera limit
    if (isNaN(limit) || limit < 1) {
      limit = DEFAULT_LIMIT;
    }
    if (limit > MAX_LIMIT) {
      limit = MAX_LIMIT;
    }

    // Hämta snapshots från Firestore
    // PRODUCTION: Try/catch-isolerat
    let snapshot;
    try {
      snapshot = await db
        .collection(MACRO_SNAPSHOTS_COLLECTION)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
    } catch (firestoreError) {
      // PRODUCTION: Firestore-fel ska inte ge 500, returnera tom array
      console.error(`[history] Firestore error for ${requestId}:`, firestoreError);
      return NextResponse.json({
        count: 0,
        limit,
        snapshots: [],
        message: "Kunde inte hämta historik från Firestore.",
        firebaseEnabled: true,
        requestId,
      });
    }

    const summaries: MacroSnapshotSummary[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // Konvertera Timestamp till ISO string
      let createdAt = "";
      if (data.createdAt instanceof Timestamp) {
        createdAt = data.createdAt.toDate().toISOString();
      } else if (data.createdAt) {
        createdAt = new Date(data.createdAt).toISOString();
      }

      summaries.push({
        id: doc.id,
        createdAt,
        asOf: data.asOf || "",
        profile: data.profile || "",
        regime: {
          risk: data.regime?.risk || "",
          conditions: data.regime?.conditions || "",
        },
        features: {
          slope10y2y: data.features?.slope10y2y ?? null,
        },
      });
    }

    console.log(`[history] Request ${requestId} completed, returning ${summaries.length} snapshots`);
    return NextResponse.json({
      count: summaries.length,
      limit,
      snapshots: summaries,
      firebaseEnabled: true,
      requestId,
    });
  } catch (error) {
    // PRODUCTION: Alla oväntade fel ska ge tydligt felmeddelande
    console.error(`[history] Unexpected error for ${requestId}:`, error);
    
    const errorMessage =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    return NextResponse.json(
      {
        error: true,
        code: "INTERNAL_ERROR",
        message: "Kunde inte hämta historik",
        hint: errorMessage,
        requestId,
      },
      { status: 500 }
    );
  }
}
