import { FullScreenContainer, ThemeProvider, TooltipProvider } from "@pipecat-ai/voice-ui-kit";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { transportOptions, useConnectSession } from "./connectSession";
import { PlaygroundConsole } from "./playgroundConsole";
import { SettingsEditor } from "./settingsEditor";
import { WebsocketPipecatAppBase } from "./websocketPipecatAppBase";

// @ts-ignore — font packages ship without TypeScript declarations
import "@fontsource-variable/geist";
// @ts-ignore — font packages ship without TypeScript declarations
import "@fontsource-variable/geist-mono";

import "./style.css";

function App() {
  const session = useConnectSession();

  const settingsContent = (
    <SettingsEditor
      endpoint={session.connectEndpoint}
      onEndpointChange={session.setConnectEndpoint}
      settingsJson={session.settingsJson}
      onSettingsChange={session.handleSettingsChange}
      jsonError={session.jsonError}
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
            startBotParams={session.startBotParams}
            startBotResponseTransformer={session.startBotResponseTransformer}
          >
            {(childProps) => (
              <PlaygroundConsole
                {...childProps}
                handleDisconnect={() => session.disconnectAndFinish(childProps.handleDisconnect)}
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
