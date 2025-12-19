import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { 
  getFirestoreDb, 
  isFirebaseConfigured, 
  MACRO_SNAPSHOTS_COLLECTION 
} from "@/lib/firebase/admin";
import { MacroSnapshotWithId } from "@/lib/firebase/types";

// ============================================
// PRODUCTION HARDENING: REQUEST ID
// ============================================

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// TYPES
// ============================================

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

// ============================================
// MAIN API HANDLER
// ============================================

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const requestId = generateRequestId();
  console.log(`[history-detail] Request ${requestId} started`);

  try {
    const { id } = await params;

    // PRODUCTION HARDENING: Graceful Firebase degradation
    // Om Firebase inte är konfigurerat → returnera 404 (inte 500)
    if (!isFirebaseConfigured()) {
      console.log(`[history-detail] Firebase not configured for ${requestId}`);
      return NextResponse.json(
        {
          error: true,
          code: "FIREBASE_NOT_CONFIGURED",
          message: "Firebase inte konfigurerat",
          hint: "Snapshot-historik kräver Firebase. Konfigurera Firebase-miljövariabler för att använda denna funktion.",
          requestId,
        },
        { status: 404 }
      );
    }

    const db = getFirestoreDb();
    if (!db) {
      // PRODUCTION: Firebase konfigurerat men kunde inte initieras → returnera 404
      console.log(`[history-detail] Firestore not initialized for ${requestId}`);
      return NextResponse.json(
        {
          error: true,
          code: "FIRESTORE_NOT_INITIALIZED",
          message: "Kunde inte ansluta till Firestore",
          hint: "Firebase är konfigurerat men Firestore kunde inte initieras. Kontrollera att FIREBASE_PRIVATE_KEY är korrekt formaterad.",
          requestId,
        },
        { status: 404 }
      );
    }

    // PRODUCTION HARDENING: Input validation
    if (!id || typeof id !== "string" || id.trim() === "") {
      return NextResponse.json(
        {
          error: true,
          code: "INVALID_ID",
          message: "Ogiltigt snapshot-ID",
          hint: "Snapshot-ID måste anges och vara en giltig sträng.",
          requestId,
        },
        { status: 400 }
      );
    }

    // Hämta snapshot från Firestore
    // PRODUCTION: Try/catch-isolerat
    let doc;
    try {
      doc = await db.collection(MACRO_SNAPSHOTS_COLLECTION).doc(id).get();
    } catch (firestoreError) {
      // PRODUCTION: Firestore-fel ska ge 404 (inte 500)
      console.error(`[history-detail] Firestore error for ${requestId}:`, firestoreError);
      return NextResponse.json(
        {
          error: true,
          code: "FIRESTORE_ERROR",
          message: "Kunde inte hämta snapshot från Firestore",
          hint: "Ett fel uppstod vid hämtning från databasen.",
          requestId,
        },
        { status: 404 }
      );
    }

    if (!doc.exists) {
      // PRODUCTION: 404 är korrekt status för saknad resurs
      return NextResponse.json(
        {
          error: true,
          code: "SNAPSHOT_NOT_FOUND",
          message: "Snapshot hittades inte",
          hint: `Ingen snapshot med ID '${id}' kunde hittas.`,
          requestId,
        },
        { status: 404 }
      );
    }

    const data = doc.data();
    if (!data) {
      // PRODUCTION: Tom dokument → 404 (inte 500)
      return NextResponse.json(
        {
          error: true,
          code: "EMPTY_SNAPSHOT",
          message: "Snapshot-dokumentet är tomt",
          hint: "Snapshot finns men innehåller ingen data.",
          requestId,
        },
        { status: 404 }
      );
    }

    // Konvertera Timestamp till ISO string
    let createdAt = "";
    if (data.createdAt instanceof Timestamp) {
      createdAt = data.createdAt.toDate().toISOString();
    } else if (data.createdAt) {
      createdAt = new Date(data.createdAt).toISOString();
    }

    const snapshot: MacroSnapshotWithId = {
      id: doc.id,
      createdAt,
      profile: data.profile || "",
      asOf: data.asOf || "",
      regime: {
        risk: data.regime?.risk || "",
        conditions: data.regime?.conditions || "",
        explanation: data.regime?.explanation || "",
      },
      features: {
        slope10y2y: data.features?.slope10y2y ?? null,
      },
      latest: {
        dgs10: data.latest?.dgs10 ?? null,
        dgs2: data.latest?.dgs2 ?? null,
        cpi: data.latest?.cpi ?? null,
        hy: data.latest?.hy ?? null,
        vix: data.latest?.vix ?? null,
      },
      chg20d: {
        dgs10: data.chg20d?.dgs10 ?? null,
        dgs2: data.chg20d?.dgs2 ?? null,
        cpi: data.chg20d?.cpi ?? null,
        hy: data.chg20d?.hy ?? null,
        vix: data.chg20d?.vix ?? null,
      },
    };

    console.log(`[history-detail] Request ${requestId} completed successfully`);
    return NextResponse.json({
      ...snapshot,
      requestId,
    });
  } catch (error) {
    // PRODUCTION: Alla oväntade fel ska ge tydligt felmeddelande
    console.error(`[history-detail] Unexpected error for ${requestId}:`, error);
    
    const errorMessage =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    return NextResponse.json(
      {
        error: true,
        code: "INTERNAL_ERROR",
        message: "Kunde inte hämta snapshot",
        hint: errorMessage,
        requestId,
      },
      { status: 500 }
    );
  }
}
