import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const DEFAULT_API_URL = "https://api.useportal.co";
const DEFAULT_REALTIME_HOST = "realtime.useportal.co";

interface RealtimeContextValue {
  environmentId: string;
  userId: string;
  token: string | null;
  realtimeHost: string;
  apiUrl: string;
  refreshToken: () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

interface RealtimeProviderProps {
  children: ReactNode;
  /**
   * Present → BYOA mode.
   * The SDK will exchange the token returned by `authTokenProvider` at
   * POST {apiUrl}/channels/token and receive a signed chat token in return.
   *
   * Absent → Developer-backend mode.
   * `authTokenProvider` should return a pre-minted chat token directly.
   */
  apiKey?: string;
  /**
   * A static token string or a callback that returns either:
   *   - An external provider JWT (when `apiKey` is set — BYOA)
   *   - A pre-minted Portal chat token (Developer-backend mode)
   *
   * When a callback is provided, the SDK calls it automatically and
   * proactively refreshes before the token expires. Use `useCallback` at
   * the call site to keep it stable.
   */
  authTokenProvider?: string | (() => Promise<string>);
  /** Base URL of the Portal API. Defaults to "https://api.useportal.co". */
  apiUrl?: string;
  /** Hostname of the realtime server. Defaults to "realtime.useportal.co". */
  realtimeHost?: string;
}

function getOrCreateAnonId(apiKey: string): string {
  if (typeof window === "undefined") return `anon_${crypto.randomUUID()}`;
  const storageKey = `portal_anon_${apiKey}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const id = `anon_${crypto.randomUUID()}`;
  localStorage.setItem(storageKey, id);
  return id;
}

/** Decode exp/environmentId/userId from a base64url JWT payload. */
function decodeJwtPayload(token: string): {
  exp?: number;
  environmentId?: string;
  userId?: string;
} {
  try {
    return JSON.parse(atob(token.split(".")[1])) as {
      exp?: number;
      environmentId?: string;
      userId?: string;
    };
  } catch {
    return {};
  }
}

export function RealtimeProvider({
  children,
  apiKey,
  authTokenProvider,
  apiUrl = DEFAULT_API_URL,
  realtimeHost = DEFAULT_REALTIME_HOST,
}: RealtimeProviderProps) {
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const isRefreshingRef = useRef(false);

  const refreshToken = useCallback(() => {
    if (isRefreshingRef.current) return;
    setRefreshKey((k) => k + 1);
    // Note: if authTokenProvider deterministically returns an already-expired
    // token, each successful refresh will still yield a 4001, triggering
    // another refresh indefinitely. That's the app's bug to fix, but a
    // max-retries-per-window counter could be added here if it becomes a
    // problem in practice.
  }, []);

  // Keep a stable ref to the latest provider so the inner async loop always
  // calls the most-recent version without it being a useEffect dependency.
  const providerRef = useRef(authTokenProvider);
  useEffect(() => {
    providerRef.current = authTokenProvider;
  });

  const fetchToken = useCallback(async (): Promise<string | null> => {
    const provider = providerRef.current;

    if (apiKey && !provider) {
      // Anonymous mode — mint a token using a stable browser-scoped ID
      const anonId = getOrCreateAnonId(apiKey);
      const res = await fetch(`${apiUrl}/channels/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, userId: anonId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Token exchange failed (${res.status})`);
      }
      const data = (await res.json()) as { token: string };
      return data.token;
    }

    if (!provider) return null;

    const rawToken = typeof provider === "string" ? provider : await provider();

    if (apiKey) {
      // BYOA — exchange external JWT for a Portal chat token
      const res = await fetch(`${apiUrl}/channels/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, externalToken: rawToken }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Token exchange failed (${res.status})`);
      }
      const data = (await res.json()) as { token: string };
      return data.token;
    }

    // Developer-backend mode — the caller already minted the chat token
    return rawToken;
  }, [apiKey, apiUrl]);

  useEffect(() => {
    if (!authTokenProvider && !apiKey) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      isRefreshingRef.current = true;
      try {
        const chatToken = await fetchToken();
        if (cancelled || !chatToken) return;

        setToken(chatToken);

        const {
          exp,
          environmentId: envId,
          userId: uid,
        } = decodeJwtPayload(chatToken);
        if (envId) setEnvironmentId(envId);
        if (uid) setUserId(uid);

        if (exp && typeof providerRef.current !== "string") {
          // Refresh 5 minutes before expiry (minimum 0ms delay).
          // Skipped for static string providers — they always return the same
          // token, so scheduling a refresh would busy-loop once the token
          // is near or past expiry.
          const delay = Math.max(exp * 1000 - Date.now() - 5 * 60 * 1000, 0);
          timer = setTimeout(() => {
            if (!cancelled) run();
          }, delay);
        }
      } catch (err) {
        console.error("[RealtimeProvider] Failed to obtain chat token:", err);
      } finally {
        // Only clear the flag if this run() instance wasn't superseded by a
        // cleanup + new effect. A cancelled instance must not clear the flag
        // because the new effect's run() has already set it to true.
        if (!cancelled) isRefreshingRef.current = false;
      }
    };

    run();

    return () => {
      cancelled = true;
      isRefreshingRef.current = false;
      if (timer) clearTimeout(timer);
    };
    // Re-run when apiKey/apiUrl/provider changes, or when refreshToken() is called.
    // The providerRef keeps the inner loop up-to-date without causing re-runs.
  }, [apiKey, apiUrl, authTokenProvider, fetchToken, refreshKey]);

  return (
    <RealtimeContext.Provider value={{ environmentId, userId, token, realtimeHost, apiUrl, refreshToken }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeContext() {
  const context = useContext(RealtimeContext);
  if (context === undefined) {
    throw new Error("useRealtimeContext must be used within a RealtimeProvider");
  }
  return context;
}
