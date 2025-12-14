import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

let firebaseApp: App | null = null;
let firestoreInstance: Firestore | null = null;

/**
 * Returnerar en lista med saknade Firebase-miljövariabler
 */
export function getMissingFirebaseEnvVars(): string[] {
  const missing: string[] = [];
  
  if (!process.env.FIREBASE_PROJECT_ID) {
    missing.push("FIREBASE_PROJECT_ID");
  }
  if (!process.env.FIREBASE_CLIENT_EMAIL) {
    missing.push("FIREBASE_CLIENT_EMAIL");
  }
  if (!process.env.FIREBASE_PRIVATE_KEY) {
    missing.push("FIREBASE_PRIVATE_KEY");
  }
  
  return missing;
}

/**
 * Kontrollerar om Firebase är konfigurerat
 */
export function isFirebaseConfigured(): boolean {
  return getMissingFirebaseEnvVars().length === 0;
}

/**
 * Genererar ett tydligt felmeddelande för saknad Firebase-konfiguration
 */
export function getFirebaseConfigError(): string {
  const missing = getMissingFirebaseEnvVars();
  
  if (missing.length === 0) {
    return "";
  }
  
  const missingList = missing.join(", ");
  
  return `Firebase är inte konfigurerat. Saknade miljövariabler: ${missingList}. ` +
    `Skapa eller uppdatera .env.local med dessa variabler och starta om dev-servern (stoppa npm run dev, kör npm run dev igen).`;
}

/**
 * Formaterar och validerar private key från miljövariabel
 * Hanterar:
 * - Escaped newlines (\\n -> \n)
 * - Omslutande citattecken
 * - Extra whitespace
 */
function formatPrivateKey(rawKey: string): string {
  let key = rawKey;
  
  // 1. Trimma whitespace
  key = key.trim();
  
  // 2. Ta bort omslutande citattecken om de finns
  if ((key.startsWith('"') && key.endsWith('"')) || 
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  
  // 3. Konvertera escaped newlines till riktiga newlines
  // Hantera både \\n (från env-fil) och literal \n
  key = key.replace(/\\n/g, "\n");
  
  // 4. Trimma igen efter konvertering
  key = key.trim();
  
  return key;
}

/**
 * Loggar diagnostik för private key (utan att logga själva nyckeln)
 */
function logPrivateKeyDiagnostics(key: string): void {
  const hasBegin = key.includes("-----BEGIN PRIVATE KEY-----");
  const hasEnd = key.includes("-----END PRIVATE KEY-----");
  const length = key.length;
  const lineCount = key.split("\n").length;
  
  console.log("[Firebase] Private key diagnostik:");
  console.log(`  - Längd: ${length} tecken`);
  console.log(`  - Antal rader: ${lineCount}`);
  console.log(`  - Innehåller 'BEGIN PRIVATE KEY': ${hasBegin ? "JA" : "NEJ"}`);
  console.log(`  - Innehåller 'END PRIVATE KEY': ${hasEnd ? "JA" : "NEJ"}`);
  
  if (!hasBegin || !hasEnd) {
    console.warn("[Firebase] VARNING: Private key verkar vara felformaterad!");
    console.warn("  Tips: Kontrollera att hela nyckeln är kopierad från Firebase JSON-filen.");
  }
}

/**
 * Initierar Firebase Admin SDK som singleton
 * Returnerar null om konfiguration saknas
 */
export function getFirebaseAdmin(): App | null {
  if (!isFirebaseConfigured()) {
    const missing = getMissingFirebaseEnvVars();
    console.warn(`[Firebase] Saknade miljövariabler: ${missing.join(", ")}`);
    console.warn("[Firebase] Tips: Skapa .env.local med dessa variabler och starta om dev-servern.");
    return null;
  }

  if (firebaseApp) {
    return firebaseApp;
  }

  // Kontrollera om redan initierad (t.ex. vid hot reload)
  const existingApps = getApps();
  if (existingApps.length > 0) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  try {
    // Hämta och formatera private key
    const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY || "";
    const privateKey = formatPrivateKey(rawPrivateKey);
    
    // Logga diagnostik (utan själva nyckeln)
    logPrivateKeyDiagnostics(privateKey);
    
    // Validera att private key ser korrekt ut
    if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
      console.error("[Firebase] FEL: FIREBASE_PRIVATE_KEY saknar '-----BEGIN PRIVATE KEY-----'");
      console.error("[Firebase] Tips: Kopiera hela private_key-värdet från din Firebase JSON-fil.");
      return null;
    }
    
    if (!privateKey.includes("-----END PRIVATE KEY-----")) {
      console.error("[Firebase] FEL: FIREBASE_PRIVATE_KEY saknar '-----END PRIVATE KEY-----'");
      console.error("[Firebase] Tips: Se till att hela nyckeln är kopierad, inklusive slutet.");
      return null;
    }

    console.log("[Firebase] Initierar Admin SDK...");
    console.log(`[Firebase] Project ID: ${process.env.FIREBASE_PROJECT_ID}`);
    console.log(`[Firebase] Client Email: ${process.env.FIREBASE_CLIENT_EMAIL}`);

    firebaseApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });

    console.log("[Firebase] ✓ Admin SDK initierad framgångsrikt!");
    return firebaseApp;
  } catch (error) {
    console.error("[Firebase] Kunde inte initiera Admin SDK:", error);
    
    // Ge mer specifik hjälp beroende på fel
    if (error instanceof Error) {
      if (error.message.includes("private_key") || error.message.includes("PEM")) {
        console.error("[Firebase] Tips för private key-fel:");
        console.error("  1. Kontrollera att FIREBASE_PRIVATE_KEY börjar med -----BEGIN PRIVATE KEY-----");
        console.error("  2. Kontrollera att escaped \\n finns för alla radbrytningar");
        console.error("  3. Om du kopierade från JSON, se till att \\n inte blev \\\\n");
        console.error("  4. Prova att omge hela värdet med citattecken i .env.local");
      }
      if (error.message.includes("project_id")) {
        console.error("[Firebase] Tips: Kontrollera att FIREBASE_PROJECT_ID matchar ditt Firebase-projekt.");
      }
      if (error.message.includes("client_email")) {
        console.error("[Firebase] Tips: Kontrollera att FIREBASE_CLIENT_EMAIL är korrekt.");
      }
    }
    
    return null;
  }
}

/**
 * Hämtar Firestore-instans
 * Returnerar null om Firebase inte är konfigurerat
 */
export function getFirestoreDb(): Firestore | null {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  const app = getFirebaseAdmin();
  if (!app) {
    return null;
  }

  try {
    firestoreInstance = getFirestore(app);
    console.log("[Firebase] ✓ Firestore-instans skapad");
    return firestoreInstance;
  } catch (error) {
    console.error("[Firebase] Kunde inte hämta Firestore:", error);
    return null;
  }
}

/**
 * Collection-namn för macro snapshots
 */
export const MACRO_SNAPSHOTS_COLLECTION = "macro_snapshots";
