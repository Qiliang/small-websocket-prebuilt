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

  // Server returns { ws_url: "ws://..." }; PipecatClient.connect() needs { wsUrl }
  const startBotResponseTransformer = useCallback((response: unknown) => {
    const r = response as Record<string, unknown>;
    if (typeof r.ws_url === "string") {
      let wsUrl = r.ws_url;
      if (window.location.protocol === "https:") {
        wsUrl = wsUrl.replace(/^ws:\/\//, "wss://");
      }
      return { wsUrl };
    }
    return r;
  }, []);

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
