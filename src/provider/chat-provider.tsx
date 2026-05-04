import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const API_URL = import.meta.env.VITE_API_URL;

interface ChatContextValue {
  environmentId: string;
  userId: string;
  token: string | null;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

interface ChatProviderProps {
  children: ReactNode;
  /**
   * Present → BYOA mode.
   * The SDK will exchange the token returned by `authTokenProvider` at
   * POST /channels/token and receive a signed chat token in return.
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
    if (!provider) return null;

    const rawToken = await provider();

    if (apiKey) {
      // BYOA — exchange external JWT for a Portal chat token
      const res = await fetch(`${API_URL}/channels/token`, {
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
  }, [apiKey]);

  useEffect(() => {
    if (!authTokenProvider) return;

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
    // Re-run only when the apiKey or the provider identity changes.
    // The providerRef keeps the inner loop up-to-date without causing re-runs.
  }, [apiKey, authTokenProvider, fetchToken]);

  return (
    <ChatContext.Provider value={{ environmentId, userId, token }}>
      {children}
    </ChatContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useChatContext() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChatContext must be used within a RealtimeProvider");
  }
  return context;
}
