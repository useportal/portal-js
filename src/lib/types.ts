export interface Message {
  id: string;
  type: "text" | "image";
  content: string;
  senderId: string;
  timestamp: string;
}

export type ReplayEnvelope = { type: "replay"; messages: Message[] };

export type HistoryRow = {
  id: string;
  type: Message["type"];
  content: string;
  end_user_id: string;
  created_at: string;
};

export type SendMessageInput = {
  content: string;
  id?: string;
  type?: Message["type"];
  senderId?: string;
  timestamp?: string;
};
