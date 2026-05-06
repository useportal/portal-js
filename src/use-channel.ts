import usePartySocket from "partysocket/react";
import { useCallback, useRef, useState } from "react";
import type {
  HistoryRow,
  Message,
  ReplayEnvelope,
  SendMessageInput,
} from "./lib/types";
import { useRealtimeContext } from "./provider/chat-provider";

interface UseChannelProps {
  channelId: string;
  replay?: "connect" | "request";
  replayLimit?: number;
  onOpen?: (event: WebSocketEventMap["open"]) => void;
  onMessage?: (event: WebSocketEventMap["message"]) => void;
  onClose?: (event: WebSocketEventMap["close"]) => void;
  onError?: (event: WebSocketEventMap["error"]) => void;
  onParseError?: (raw: string, error: unknown) => void;
}

const isReplayEnvelope = (value: unknown): value is ReplayEnvelope =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "replay" &&
  Array.isArray((value as { messages?: unknown }).messages);

const normalizeHistoryRow = (row: HistoryRow): Message => ({
  id: row.id,
  type: row.type,
  content: row.content,
  senderId: row.end_user_id,
  timestamp: row.created_at,
});

export const useChannel = ({
  channelId,
  replay,
  replayLimit,
  onMessage,
  onOpen,
  onClose,
  onError,
  onParseError,
}: UseChannelProps) => {
  const { token, userId, environmentId, realtimeHost, apiUrl } =
    useRealtimeContext();
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<string, Message[]>
  >({});
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const inFlightRef = useRef(false);
  const messagesRef = useRef(messagesByChannel);
  messagesRef.current = messagesByChannel;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const query: Record<string, string> = { token: token ?? "" };
  if (replay) query.replay = replay;
  if (replayLimit !== undefined) query.replayLimit = String(replayLimit);

  const socket = usePartySocket({
    host: realtimeHost,
    room: `${environmentId}:${channelId}`,
    query,
    startClosed: !token,
    onOpen: (event) => {
      onOpen?.(event);
    },
    onMessage: (event) => {
      try {
        const parsed: unknown = JSON.parse(event.data);

        if (isReplayEnvelope(parsed)) {
          const incoming = parsed.messages;
          setMessagesByChannel((prev) => {
            const existing = prev[channelId] ?? [];
            const incomingIds = new Set(incoming.map((m) => m.id));
            const merged = [
              ...incoming,
              ...existing.filter((m) => !incomingIds.has(m.id)),
            ];
            return { ...prev, [channelId]: merged };
          });
        } else {
          const message = parsed as Message;
          setMessagesByChannel((prev) => {
            const existing = prev[channelId] ?? [];
            if (existing.some((m) => m.id === message.id)) return prev;
            return { ...prev, [channelId]: [...existing, message] };
          });
        }

        onMessage?.(event);
      } catch (error) {
        if (onParseError) {
          onParseError(event.data as string, error);
        } else {
          console.error("[useChannel] Failed to parse message:", error);
        }
      }
    },
    onClose: (event) => {
      onClose?.(event);
    },
    onError: (err) => {
      onError?.(err);
    },
  });

  const sendMessage = useCallback(
    (input: SendMessageInput) => {
      const message: Message = {
        id: input.id ?? crypto.randomUUID(),
        type: input.type ?? "text",
        content: input.content,
        senderId: input.senderId ?? userId,
        timestamp: input.timestamp ?? new Date().toISOString(),
      };
      socket.send(JSON.stringify(message));
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: [...(prev[channelId] ?? []), message],
      }));
    },
    [socket, channelId, userId],
  );

  const loadMore = useCallback(
    async (opts?: { limit?: number }): Promise<void> => {
      if (inFlightRef.current) return;
      if (!hasMoreRef.current) return;
      const currentToken = tokenRef.current;
      if (!currentToken) return;

      const channelMessages = messagesRef.current[channelId] ?? [];
      const cursor = channelMessages[0]?.id;
      const limit = opts?.limit ?? 50;

      const url = new URL(`${apiUrl}/messages/${channelId}/history`);
      url.searchParams.set("limit", String(limit));
      if (cursor) url.searchParams.set("before", cursor);

      inFlightRef.current = true;
      setIsLoadingMore(true);
      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${currentToken}` },
        });

        if (res.status === 401) {
          console.error(
            "[useChannel] loadMore: 401 from /messages/.../history — Portal API auth middleware is not accepting end-user JWTs on this endpoint. Server-side fix required.",
          );
          return;
        }
        if (!res.ok) {
          console.error(
            `[useChannel] loadMore: history fetch failed (${res.status})`,
          );
          return;
        }

        const rows = (await res.json()) as HistoryRow[];

        if (rows.length === 0) {
          setHasMore(false);
          return;
        }

        const normalized = rows.map(normalizeHistoryRow);
        setMessagesByChannel((prev) => {
          const existing = prev[channelId] ?? [];
          const existingIds = new Set(existing.map((m) => m.id));
          const fresh = normalized.filter((m) => !existingIds.has(m.id));
          return { ...prev, [channelId]: [...fresh, ...existing] };
        });
      } catch (err) {
        console.error("[useChannel] loadMore failed:", err);
      } finally {
        inFlightRef.current = false;
        setIsLoadingMore(false);
      }
    },
    [apiUrl, channelId],
  );

  return {
    messages: messagesByChannel[channelId] ?? [],
    sendMessage,
    loadMore,
    hasMore,
    isLoadingMore,
  };
};
