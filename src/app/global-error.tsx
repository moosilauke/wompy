"use client";

/**
 * Root-level error boundary. Catches errors that escape the root layout, so it
 * must render its own <html>/<body> (it replaces the layout when active).
 *
 * Must be a Client Component; `metadata` exports are not supported here.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#f5f2ea",
          color: "#2c2a24",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>
            Something went wrong
          </h2>
          <p style={{ marginTop: ".5rem", color: "#6b6558" }}>
            Wompy hit an unexpected error.
            {error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1rem",
              borderRadius: "100px",
              border: "none",
              background: "#e2725a",
              color: "#fff",
              fontWeight: 700,
              padding: ".625rem 1.25rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
