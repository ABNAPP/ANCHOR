/**
 * Firestore Sanitization
 * 
 * Tar bort eller ersätter undefined-värden innan Firestore write/update.
 * Firestore tillåter inte undefined-värden.
 */

/**
 * Saniterar ett objekt/array för Firestore genom att ta bort alla undefined-värden.
 * Rekursivt genomgång av objekt och arrays.
 * 
 * @param input - Objekt, array, eller primitivt värde att sanitera
 * @returns Saniterat värde utan undefined
 */
export function sanitizeForFirestore<T>(input: T): T {
  // Primitiva värden (string, number, boolean, null) - returnera som de är
  if (input === null || typeof input !== "object") {
    return input;
  }

  // Date-objekt - behåll som de är
  if (input instanceof Date) {
    return input;
  }

  // Array - sanitera varje element
  if (Array.isArray(input)) {
    return input
      .map((item) => sanitizeForFirestore(item))
      .filter((item) => item !== undefined) as T;
  }

  // Objekt - skapa nytt objekt utan undefined-värden
  const sanitized: any = {};
  for (const [key, value] of Object.entries(input)) {
    // Hoppa över undefined-värden
    if (value === undefined) {
      continue;
    }
    
    // Rekursivt sanitera nested objekt/arrays
    sanitized[key] = sanitizeForFirestore(value);
  }

  return sanitized as T;
}

/**
 * Saniterar promises-array specifikt för att säkerställa att verification och score
 * alltid är null (inte undefined) om de saknas.
 */
export function sanitizePromisesForFirestore<T extends { verification?: any; score?: any }>(
  promises: T[]
): T[] {
  return promises.map((promise) => {
    const sanitized = { ...promise };
    
    // Sätt verification till null om den är undefined
    if (sanitized.verification === undefined) {
      sanitized.verification = null;
    }
    
    // Sätt score till null om den är undefined
    if (sanitized.score === undefined) {
      sanitized.score = null;
    }
    
    // Sanitera nested objekt
    if (sanitized.verification && typeof sanitized.verification === "object") {
      sanitized.verification = sanitizeForFirestore(sanitized.verification);
    }
    
    if (sanitized.score && typeof sanitized.score === "object") {
      sanitized.score = sanitizeForFirestore(sanitized.score);
    }
    
    return sanitizeForFirestore(sanitized) as T;
  });
}

