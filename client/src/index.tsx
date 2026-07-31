import { FullScreenContainer, ThemeProvider, TooltipProvider } from "@pipecat-ai/voice-ui-kit";
import { StrictMode, useCallback, useMemo, useState } from "react";
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

function App() {
  const [connectEndpoint, setConnectEndpoint] = useState(defaultConnectEndpoint);
  const [settingsJson, setSettingsJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

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
  // Auto-generate conversation_id if left empty.
  const startBotParams = useMemo(() => {
    try {
      const settings = JSON.parse(settingsJson);
      if (!settings.conversation_id) {
        settings.conversation_id = crypto.randomUUID();
      }
      return { endpoint: connectEndpoint, requestData: settings };
    } catch {
      return { endpoint: connectEndpoint, requestData: {} };
    }
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
        result.handshake = {
          conversationId: String(settings.conversation_id),
          settings,
        };
      } catch (e) {
        console.error("handshake mode requires valid settings JSON", e);
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
            {(childProps) => (
              <PlaygroundConsole
                {...childProps}
                settingsContent={settingsContent}
              />
            )}
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
