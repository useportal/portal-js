import usePartySocket from "partysocket/react";
import { useCallback, useState } from "react";
import type { Message } from "./lib/types";
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

type ReplayEnvelope = { type: "replay"; messages: Message[] };

const isReplayEnvelope = (value: unknown): value is ReplayEnvelope =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "replay" &&
  Array.isArray((value as { messages?: unknown }).messages);

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
  const { token, environmentId, realtimeHost } = useRealtimeContext();
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<string, Message[]>
  >({});

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
    (message: Message) => {
      socket.send(JSON.stringify(message));
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: [...(prev[channelId] ?? []), message],
      }));
    },
    [socket, channelId],
  );

  return {
    messages: messagesByChannel[channelId] ?? [],
    sendMessage,
  };
};
