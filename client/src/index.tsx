import { FullScreenContainer, ThemeProvider, TooltipProvider } from "@pipecat-ai/voice-ui-kit";
import { StrictMode, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { PlaygroundConsole } from "./playgroundConsole";
import { SettingsEditor } from "./settingsEditor";
import { WebsocketPipecatAppBase } from "./websocketPipecatAppBase";

// @ts-ignore — font packages ship without TypeScript declarations
import "@fontsource-variable/geist";
// @ts-ignore — font packages ship without TypeScript declarations
import "@fontsource-variable/geist-mono";

import "./style.css";

const defaultConnectEndpoint =
  import.meta.env.VITE_CONNECT_URL ??
  new URL("/bot/connect", window.location.origin).href;

const transportOptions = { recorderSampleRate: 16000, playerSampleRate: 16000 };

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
function finishAgentSession(settingsJson: string, agentSessionId: string): void {
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

function App() {
  const [connectEndpoint, setConnectEndpoint] = useState(defaultConnectEndpoint);
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
            settings.conversation_id = crypto.randomUUID();
          }
          activeConversationIdRef.current = String(settings.conversation_id);
          return settings;
        } catch {
          const conversationId = crypto.randomUUID();
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
        // conversation_id 以 URL 路径为准（与 /bot/connect 时一致），避免二次生成 UUID 不一致
        const fromUrl = wsUrl.match(/\/bot\/([^/?#]+)\/ws/)?.[1];
        if (fromUrl) {
          settings.conversation_id = fromUrl;
        } else if (!settings.conversation_id) {
          settings.conversation_id = crypto.randomUUID();
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

  const settingsContent = (
    <SettingsEditor
      endpoint={connectEndpoint}
      onEndpointChange={setConnectEndpoint}
      settingsJson={settingsJson}
      onSettingsChange={handleSettingsChange}
      jsonError={jsonError}
    />
  );

  return (
    <ThemeProvider>
      <TooltipProvider>
        <FullScreenContainer>
          <WebsocketPipecatAppBase
            noThemeProvider
            initDevicesOnMount
            transportOptions={transportOptions}
            startBotParams={startBotParams}
            startBotResponseTransformer={startBotResponseTransformer}
          >
            {(childProps) => {
              // Only the ConnectButton Disconnect path — not transport teardown / cleanup.
              const handleDisconnect = async () => {
                finishAgentSession(
                  settingsJson,
                  activeConversationIdRef.current,
                );
                await childProps.handleDisconnect?.();
              };
              return (
                <PlaygroundConsole
                  {...childProps}
                  handleDisconnect={handleDisconnect}
                  settingsContent={settingsContent}
                />
              );
            }}
          </WebsocketPipecatAppBase>
        </FullScreenContainer>
      </TooltipProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
