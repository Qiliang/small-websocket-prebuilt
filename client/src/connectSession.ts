import { useCallback, useMemo, useRef, useState } from "react";

function browserWsOrigin(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

/** 服务端要求 conversation_id 至少 20 个字符。dev- 加 UUID 固定满足。 */
export function createDevConversationId(): string {
  return `dev-${crypto.randomUUID()}`;
}

/** 把地址里的会话号换成 dev-UUID，主机和其余路径保持不变。 */
export function withDevConversationId(
  endpoint: string,
  conversationId: string = createDevConversationId(),
): string {
  const id = encodeURIComponent(conversationId);
  let raw = endpoint.trim();
  if (raw.includes("{conversation_id}")) {
    raw = raw.split("{conversation_id}").join(id);
  }
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol === "https:") url.protocol = "wss:";
    let path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/bot/connect" || path.endsWith("/bot/connect")) {
      const prefix = path.slice(0, -"/bot/connect".length);
      path = `${prefix}/bot/${id}/ws`;
    } else if (/\/bot\/[^/]+\/ws$/.test(path)) {
      path = path.replace(/\/bot\/[^/]+\/ws$/, `/bot/${id}/ws`);
    } else {
      const prefix = path === "/" ? "" : path;
      path = `${prefix}/bot/${id}/ws`;
    }
    url.pathname = path;
    return url.toString();
  } catch {
    return `${browserWsOrigin()}/bot/${id}/ws`;
  }
}

/** 输入框的初始值：已经带上一条 dev-UUID，不是占位符。 */
export const defaultConnectEndpoint =
  import.meta.env.VITE_CONNECT_URL ??
  withDevConversationId(`${browserWsOrigin()}/bot/{conversation_id}/ws`);

export const connectEndpointPlaceholder = `${browserWsOrigin()}/bot/dev-<uuid>/ws`;

export type DirectConnect = {
  wsUrl: string;
  handshake: {
    conversationId: string;
    settings: Record<string, unknown>;
  };
};

/** `/bot/connect`、`ws://…/bot/{conversation_id}/ws` 都走直连，不再 POST。 */
export function isDirectBotWsEndpoint(endpoint: string): boolean {
  const raw = endpoint.trim();
  if (!raw) return false;
  if (raw.includes("{conversation_id}")) return true;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol === "ws:" || url.protocol === "wss:") return true;
    const path = url.pathname.replace(/\/+$/, "");
    return path === "/bot/connect" || path.endsWith("/bot/connect");
  } catch {
    return false;
  }
}

export function resolveBotWsUrl(endpoint: string, conversationId: string): string {
  const id = encodeURIComponent(conversationId);
  let raw = endpoint.trim();
  if (raw.includes("{conversation_id}")) {
    raw = raw.split("{conversation_id}").join(id);
  }
  const url = new URL(raw, window.location.origin);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";

  let path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/bot/connect" || path.endsWith("/bot/connect")) {
    const prefix = path.slice(0, -"/bot/connect".length);
    path = `${prefix}/bot/${id}/ws`;
  } else if (!/\/bot\/[^/]+\/ws$/.test(path)) {
    const prefix = path === "/" ? "" : path;
    path = `${prefix}/bot/${id}/ws`;
  }
  url.pathname = path;
  return url.toString();
}

function readSettings(settingsJson: string): Record<string, unknown> {
  try {
    const settings = JSON.parse(settingsJson) as unknown;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return {};
    }
    return settings as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const transportOptions = { recorderSampleRate: 16000, playerSampleRate: 16000 };

/** wss://a8-service.7x24cc.com/... → a8.7x24cc.com */
function resolveMpaasPortalHost(agentUrl: string): string | null {
  try {
    return new URL(agentUrl).hostname.replace(/-service\./, ".");
  } catch {
    return null;
  }
}

/**
 * UI Disconnect only: notify MPaaS that the agent session finished.
 * Fire-and-forget; must not block or break local disconnect.
 */
export function finishAgentSession(settingsJson: string, agentSessionId: string): void {
  if (!agentSessionId) return;
  try {
    const settings = JSON.parse(settingsJson) as {
      agent?: { provider?: { url?: string; account_id?: string } };
    };
    const provider = settings?.agent?.provider;
    const accountId = provider?.account_id;
    const host = provider?.url ? resolveMpaasPortalHost(provider.url) : null;
    if (!accountId || !host) return;

    const url =
      `https://${host}/scheduledTask/ai/agentFinish/` +
      `${encodeURIComponent(accountId)}/${encodeURIComponent(agentSessionId)}`;
    // Cross-origin GET; no-cors still delivers the request to MPaaS.
    void fetch(url, { method: "GET", mode: "no-cors", keepalive: true }).catch(
      (e) => console.warn("agentFinish request failed:", e),
    );
  } catch (e) {
    console.warn("agentFinish skipped:", e);
  }
}

export function useConnectSession(initialEndpoint?: string) {
  const [connectEndpoint, setConnectEndpoint] = useState(
    initialEndpoint?.trim() || defaultConnectEndpoint,
  );
  const [settingsJson, setSettingsJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Conversation id of the active session — used only for Disconnect → agentFinish.
  const activeConversationIdRef = useRef("");

  const handleSettingsChange = useCallback((value: string) => {
    setSettingsJson(value);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }, []);

  // Build startBotParams from current settings JSON.
  // requestData getter runs on each Connect so empty conversation_id gets a fresh UUID.
  const startBotParams = useMemo(() => {
    return {
      endpoint: connectEndpoint,
      get requestData() {
        try {
          const settings = JSON.parse(settingsJson);
          if (!settings.conversation_id) {
            settings.conversation_id = createDevConversationId();
          }
          activeConversationIdRef.current = String(settings.conversation_id);
          return settings;
        } catch {
          const conversationId = createDevConversationId();
          activeConversationIdRef.current = conversationId;
          return { conversation_id: conversationId };
        }
      },
    };
  }, [settingsJson, connectEndpoint]);

  // Server returns { ws_url, mode? }; PipecatClient.connect() needs { wsUrl }
  // handshake 模式：URL 不含 settings，连接后由 CustomWebSocketTransport 发 init_settings
  const startBotResponseTransformer = useCallback((response: unknown) => {
    const r = response as Record<string, unknown>;
    if (typeof r.ws_url !== "string") {
      return r;
    }

    let wsUrl = r.ws_url;
    if (window.location.protocol === "https:") {
      wsUrl = wsUrl.replace(/^ws:\/\//, "wss://");
    }

    const result: {
      wsUrl: string;
      handshake?: { conversationId: string; settings: Record<string, unknown> };
    } = { wsUrl };

    if (r.mode === "handshake") {
      try {
        const settings = JSON.parse(settingsJson) as Record<string, unknown>;
        // conversation_id 以 URL 路径为准，避免二次生成 UUID 不一致
        const fromUrl = wsUrl.match(/\/bot\/([^/?#]+)\/ws/)?.[1];
        if (fromUrl) {
          settings.conversation_id = fromUrl;
        } else if (!settings.conversation_id) {
          settings.conversation_id = createDevConversationId();
        }
        activeConversationIdRef.current = String(settings.conversation_id);
        result.handshake = {
          conversationId: String(settings.conversation_id),
          settings,
        };
      } catch (e) {
        console.error("handshake mode requires valid settings JSON", e);
      }
    } else {
      const fromUrl = wsUrl.match(/\/bot\/([^/?#]+)\/ws/)?.[1];
      if (fromUrl) {
        activeConversationIdRef.current = fromUrl;
      }
    }

    return result;
  }, [settingsJson]);

  const disconnectAndFinish = useCallback(
    async (handleDisconnect?: () => void | Promise<void>) => {
      finishAgentSession(settingsJson, activeConversationIdRef.current);
      await handleDisconnect?.();
    },
    [settingsJson],
  );

  // 这次连接用输入框里现成的会话号。点下去之后立刻换成下一条 dev-UUID。
  const getDirectConnect = useCallback((): DirectConnect | null => {
    if (!isDirectBotWsEndpoint(connectEndpoint)) return null;
    const settings = readSettings(settingsJson);
    if (!settings.conversation_id) {
      settings.conversation_id = createDevConversationId();
    }
    let conversationId = String(settings.conversation_id);
    const wsUrl = resolveBotWsUrl(connectEndpoint, conversationId);
    const fromUrl = new URL(wsUrl).pathname.match(/\/bot\/([^/]+)\/ws$/)?.[1];
    if (fromUrl) {
      conversationId = decodeURIComponent(fromUrl);
      settings.conversation_id = conversationId;
    }
    activeConversationIdRef.current = conversationId;
    setConnectEndpoint((current) => withDevConversationId(current));
    return {
      wsUrl,
      handshake: { conversationId, settings },
    };
  }, [connectEndpoint, settingsJson]);

  return {
    connectEndpoint,
    setConnectEndpoint,
    settingsJson,
    jsonError,
    handleSettingsChange,
    startBotParams,
    startBotResponseTransformer,
    getDirectConnect,
    disconnectAndFinish,
  };
}
