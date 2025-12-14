import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { 
  getFirestoreDb, 
  isFirebaseConfigured, 
  getFirebaseConfigError,
  getMissingFirebaseEnvVars,
  MACRO_SNAPSHOTS_COLLECTION 
} from "@/lib/firebase/admin";
import { MacroSnapshotWithId } from "@/lib/firebase/types";

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id } = await params;

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

    // Validera ID
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        {
          error: "Ogiltigt ID",
          message: "Snapshot-ID måste anges.",
        },
        { status: 400 }
      );
    }

    // Hämta snapshot från Firestore
    const doc = await db.collection(MACRO_SNAPSHOTS_COLLECTION).doc(id).get();

    if (!doc.exists) {
      return NextResponse.json(
        {
          error: "Snapshot hittades inte",
          message: `Ingen snapshot med ID '${id}' kunde hittas.`,
        },
        { status: 404 }
      );
    }

    const data = doc.data();
    if (!data) {
      return NextResponse.json(
        {
          error: "Tom snapshot",
          message: "Snapshot-dokumentet är tomt.",
        },
        { status: 500 }
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

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("[History Detail API] Error:", error);
    
    const errorMessage =
      error instanceof Error ? error.message : "Ett oväntat fel uppstod";

    return NextResponse.json(
      {
        error: "Kunde inte hämta snapshot",
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
