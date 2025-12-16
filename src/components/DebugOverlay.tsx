"use client";

import { useCallback } from "react";

// ============================================
// TYPES
// ============================================

export interface DebugError {
  at: string;
  context: string;
  message: string;
  status?: number;
  details?: string;
}

export interface DebugOverlayProps {
  errors: DebugError[];
  visible: boolean;
  onClear: () => void;
  onClose: () => void;
}

// ============================================
// COMPONENT
// ============================================

export function DebugOverlay({ errors, visible, onClear, onClose }: DebugOverlayProps) {
  // Copy error text to clipboard
  const handleCopy = useCallback(async () => {
    const text = errors
      .map((e) => {
        let line = `[${e.at}] [${e.context}] ${e.message}`;
        if (e.status) line += ` (HTTP ${e.status})`;
        if (e.details) line += `\n  Details: ${e.details}`;
        return line;
      })
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      alert("Felloggen kopierad till urklipp!");
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      alert("Felloggen kopierad till urklipp!");
    }
  }, [errors]);

  // Don't render if hidden or no errors
  if (!visible || errors.length === 0) {
    return null;
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span style={styles.icon}>🐛</span>
          <span style={styles.title}>Debug ({errors.length} fel)</span>
        </div>
        <div style={styles.buttonRow}>
          <button onClick={handleCopy} style={styles.button} title="Kopiera till urklipp">
            📋 Kopiera
          </button>
          <button onClick={onClear} style={styles.button} title="Rensa alla fel">
            🗑️ Rensa
          </button>
          <button onClick={onClose} style={styles.closeButton} title="Göm panelen">
            ✕
          </button>
        </div>
      </div>

      <div style={styles.errorList}>
        {errors.map((error, idx) => (
          <div key={`${error.at}-${idx}`} style={styles.errorItem}>
            <div style={styles.errorHeader}>
              <span style={styles.errorContext}>[{error.context}]</span>
              {error.status && (
                <span style={styles.errorStatus}>HTTP {error.status}</span>
              )}
              <span style={styles.errorTime}>
                {new Date(error.at).toLocaleTimeString("sv-SE")}
              </span>
            </div>
            <div style={styles.errorMessage}>{error.message}</div>
            {error.details && (
              <details style={styles.errorDetails}>
                <summary style={styles.detailsSummary}>Visa detaljer</summary>
                <pre style={styles.detailsContent}>{error.details}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// STYLES
// ============================================

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: "rgba(127, 29, 29, 0.97)",
    borderBottom: "3px solid #ef4444",
    color: "#fecaca",
    fontFamily: "'JetBrains Mono', 'Consolas', monospace",
    fontSize: "0.8rem",
    maxHeight: "40vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.5rem 1rem",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
    flexShrink: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  icon: {
    fontSize: "1.1rem",
  },
  title: {
    fontWeight: 700,
    color: "#fca5a5",
    letterSpacing: "0.02em",
  },
  buttonRow: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },
  button: {
    padding: "0.35rem 0.75rem",
    fontSize: "0.75rem",
    fontFamily: "inherit",
    fontWeight: 500,
    color: "#fecaca",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: "4px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  closeButton: {
    padding: "0.35rem 0.6rem",
    fontSize: "0.9rem",
    fontFamily: "inherit",
    fontWeight: 600,
    color: "#fecaca",
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    marginLeft: "0.5rem",
  },
  errorList: {
    overflowY: "auto",
    flex: 1,
    padding: "0.5rem",
  },
  errorItem: {
    padding: "0.75rem",
    marginBottom: "0.5rem",
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    borderRadius: "6px",
    borderLeft: "3px solid #ef4444",
  },
  errorHeader: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "0.375rem",
    flexWrap: "wrap",
  },
  errorContext: {
    fontWeight: 700,
    color: "#fbbf24",
    textTransform: "uppercase",
    fontSize: "0.7rem",
    letterSpacing: "0.05em",
  },
  errorStatus: {
    padding: "0.125rem 0.375rem",
    fontSize: "0.65rem",
    fontWeight: 600,
    backgroundColor: "rgba(239, 68, 68, 0.4)",
    color: "#fecaca",
    borderRadius: "3px",
  },
  errorTime: {
    marginLeft: "auto",
    fontSize: "0.7rem",
    color: "#fca5a5",
    opacity: 0.7,
  },
  errorMessage: {
    color: "#ffffff",
    lineHeight: 1.4,
    wordBreak: "break-word",
  },
  errorDetails: {
    marginTop: "0.5rem",
  },
  detailsSummary: {
    fontSize: "0.7rem",
    color: "#fca5a5",
    cursor: "pointer",
    userSelect: "none",
  },
  detailsContent: {
    marginTop: "0.375rem",
    padding: "0.5rem",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    borderRadius: "4px",
    fontSize: "0.7rem",
    color: "#d4d4d8",
    overflow: "auto",
    maxHeight: "150px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};

export default DebugOverlay;
