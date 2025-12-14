import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { 
  getFirestoreDb, 
  isFirebaseConfigured, 
  getFirebaseConfigError,
  getMissingFirebaseEnvVars,
  MACRO_SNAPSHOTS_COLLECTION 
} from "@/lib/firebase/admin";
import { MacroSnapshotSummary } from "@/lib/firebase/types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Kontrollera Firebase-konfiguration
    if (!isFirebaseConfigured()) {
      const missingVars = getMissingFirebaseEnvVars();
      return NextResponse.json(
        {
          error: "Firebase inte konfigurerat",
          message: getFirebaseConfigError(),
          missingEnvVars: missingVars,
          hint: "Skapa .env.local med dessa variabler och starta om dev-servern.",
        },
        { status: 500 }
      );
    }

    const db = getFirestoreDb();
    if (!db) {
      return NextResponse.json(
        {
          error: "Kunde inte ansluta till Firestore",
          message: "Firebase är konfigurerat men Firestore kunde inte initieras. Kontrollera att FIREBASE_PRIVATE_KEY är korrekt formaterad.",
          hint: "Private key ska börja med '-----BEGIN PRIVATE KEY-----' och innehålla \\n för radbrytningar.",
        },
        { status: 500 }
      );
    }

    // Hämta limit från query params
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
    const snapshot = await db
      .collection(MACRO_SNAPSHOTS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

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

    return NextResponse.json({
      count: summaries.length,
      limit,
      snapshots: summaries,
    });
  } catch (error) {
    console.error("[History API] Error:", error);
    
    const errorMessage =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    return NextResponse.json(
      {
        error: "Kunde inte hämta historik",
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
