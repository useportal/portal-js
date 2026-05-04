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
}

export const useChannel = ({
  channelId,
  onMessage,
  onOpen,
  onClose,
  onError,
}: UseChannelProps) => {
  const { token, environmentId } = useChatContext();
  const [messagesByChannel, setMessagesByChannel] = useState<
    Record<string, Message[]>
  >({});
  const socket = usePartySocket({
    host:
      (import.meta.env.VITE_REALTIME_URL as string) || "realtime.useportal.co",
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
        console.log("parse error:", error);
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
