import usePartySocket from "partysocket/react";
import { useCallback, useState } from "react";
import type { Message } from "./lib/types";
import { useChatContext } from "./provider/chat-provider";

interface UseChannelProps {
  channelId: string;
  onOpen?: (event: WebSocketEventMap["open"]) => void;
  onMessage?: (event: WebSocketEventMap["message"]) => void;
  onClose?: (event: WebSocketEventMap["close"]) => void;
  onError?: (event: WebSocketEventMap["error"]) => void;
  onParseError?: (raw: string, error: unknown) => void;
}

export const useChannel = ({
  channelId,
  onMessage,
  onOpen,
  onClose,
  onError,
  onParseError,
}: UseChannelProps) => {
  const { token, environmentId, realtimeHost } = useChatContext();
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<string, Message[]>
  >({});

  const socket = usePartySocket({
    host: realtimeHost,
    room: `${environmentId}:${channelId}`,
    query: { token: token ?? "" },
    startClosed: !token,
    onOpen: (event) => {
      onOpen?.(event);
    },
    onMessage: (event) => {
      try {
        const message = JSON.parse(event.data) as Message;
        setMessagesByChannel((prev) => ({
          ...prev,
          [channelId]: [...(prev[channelId] ?? []), message],
        }));
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
