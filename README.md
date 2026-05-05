# @use-portal-co/portal-js

[![npm](https://img.shields.io/npm/v/@use-portal-co/portal-js)](https://www.npmjs.com/package/@use-portal-co/portal-js)

Realtime client SDK for [Portal](https://useportal.co).

## Installation

```bash
npm install @use-portal-co/portal-js
# or
pnpm add @use-portal-co/portal-js
```

## Usage

### 1. Wrap your app with `RealtimeProvider`

**BYOA mode** — if you're using your own auth provider, pass your `apiKey` and return your provider's JWT from `authTokenProvider`. The SDK will exchange it for a Portal token automatically:

```tsx
<RealtimeProvider
  apiKey="your-portal-api-key"
  authTokenProvider={async () => yourAuthProvider.getToken()}
>
  <YourApp />
</RealtimeProvider>
```

Alternatively, return a pre-minted Portal chat token directly from your backend:

```tsx
import { RealtimeProvider } from "@use-portal-co/portal-js";

function App() {
  return (
    <RealtimeProvider
      authTokenProvider={async () => {
        const res = await fetch("/api/chat-token");
        const { token } = await res.json();
        return token;
      }}
    >
      <YourApp />
    </RealtimeProvider>
  );
}
```

### 2. Subscribe to a channel with `useChannel`

```tsx
import { useChannel } from "@use-portal-co/portal-js";

function ChatRoom({ channelId }: { channelId: string }) {
  const { messages, sendMessage } = useChannel({ channelId });

  return (
    <div>
      {messages.map((msg) => (
        <p key={msg.id}>{msg.content}</p>
      ))}
      <button
        onClick={() =>
          sendMessage({
            id: crypto.randomUUID(),
            type: "text",
            content: "Hello!",
            senderId: "user-123",
            timestamp: new Date().toISOString(),
          })
        }
      >
        Send
      </button>
    </div>
  );
}
```

## API

### `RealtimeProvider`

| Prop | Type | Required | Description |
|---|---|---|---|
| `authTokenProvider` | `() => Promise<string>` | No | Returns a Portal chat token or an external JWT |
| `apiKey` | `string` | No | Your Portal API key (BYOA mode) |
| `apiUrl` | `string` | No | Portal API base URL. Defaults to `https://api.useportal.co` |
| `realtimeHost` | `string` | No | Realtime server host. Defaults to `realtime.useportal.co` |

### `useChannel(props)`

| Prop | Type | Required | Description |
|---|---|---|---|
| `channelId` | `string` | Yes | The channel to subscribe to |
| `replay` | `"connect" \| "request"` | No | `"connect"` (default): the server sends recent message history immediately after connect. `"request"`: no automatic replay — fetch history on demand. |
| `replayLimit` | `number` | No | Override the number of recent messages included in the connect-time replay. Server default is 50, hard cap 500. |
| `onOpen` | `(event) => void` | No | WebSocket open callback |
| `onMessage` | `(event) => void` | No | WebSocket message callback |
| `onClose` | `(event) => void` | No | WebSocket close callback |
| `onError` | `(event) => void` | No | WebSocket error callback |
| `onParseError` | `(raw: string, error: unknown) => void` | No | Called when an incoming message fails to parse |

Returns `{ messages, sendMessage }`.

`messages` is automatically deduplicated by `id`, so the message you optimistically appended via `sendMessage` won't appear twice when the server's broadcast echoes it back.

## License

MIT
