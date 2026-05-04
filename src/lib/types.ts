export interface Message {
  id: string;
  type: "text" | "image";
  content: string;
  senderId: string;
  timestamp: string;
}
