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
}

const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

interface ChatProviderProps {
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
   * Callback that returns either:
   *   - An external provider JWT (when `apiKey` is set — BYOA)
   *   - A pre-minted Portal chat token (Developer-backend mode)
   *
   * The SDK calls this automatically and proactively refreshes before the
   * token expires. Use `useCallback` at the call site to keep it stable.
   */
  authTokenProvider?: () => Promise<string>;
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
}: ChatProviderProps) {
  const [environmentId, setEnvironmentId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [token, setToken] = useState<string | null>(null);

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

    const rawToken = await provider();

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

        if (exp) {
          // Refresh 5 minutes before expiry (minimum 0ms delay)
          const delay = Math.max(exp * 1000 - Date.now() - 5 * 60 * 1000, 0);
          timer = setTimeout(() => {
            if (!cancelled) run();
          }, delay);
        }
      } catch (err) {
        console.error("[RealtimeProvider] Failed to obtain chat token:", err);
      }
    };

    run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Re-run only when the apiKey/apiUrl or the provider identity changes.
    // The providerRef keeps the inner loop up-to-date without causing re-runs.
  }, [apiKey, apiUrl, authTokenProvider, fetchToken]);

  return (
    <RealtimeContext.Provider value={{ environmentId, userId, token, realtimeHost }}>
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
