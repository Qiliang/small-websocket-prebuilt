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

const defaultClientSettings = {
  conversation_id: "",
  audio: {
    audio_filter: {
      name: "vad_rms_gate",
      trigger_threshold: 0.05,
      grace_continue_threshold: 0.03,
    },
  },
  user_start_strategy: {
    selected: ["stt_min_chars", "intent_start"],
    stt_min_chars: 3,
    intent_threshold: 0.85,
  },
  user_stop_strategy: {
    selected: ["vad_stop", "intent_stop"],
    vad_stop_seconds: 0.6,
    intent_time_out: 2.0,
  },
  stt: {
    provider: {
      name: "volcengine",
      hotwords_enabled: false,
      hotwords: "",
      context_enabled: false,
      context: "",
    },
  },
  tts: {
    provider: {
      name: "qwen_vc",
      model: "qwen3-tts-vc-realtime-2026-01-15",
      voice: "qwen-tts-vc-yanyan-voice-20260414162946853-a320",
      speech_rate: 1.2,
      pitch_rate: 1.0,
    },
  },
  agent: {
    provider: {
      name: "mpaas",
      url: "wss://service.7x24cc.com/service/ws",
      account_id: "N000000001907",
      agent_id: "582480b02daf11f198fbbdeca5433be1",
    },
  },
  filler: {
    provider: {
      name: "disabled",
    },
  },
  idle: {
    provider: {
      name: "mpaas",
    },
  },
  audio_output_mixer: {
    provider: {
      name: "soundfile",
      sound_files: "office-ambience-16000-mono.mp3",
      volume: 1.0,
    },
  },
  user_mute_strategy: {
    provider: {
      name: "first_speech",
    },
  },
  dialogue: {
    enabled: false,
  },
};

const defaultSettingsJson = JSON.stringify(defaultClientSettings, null, 2);

const transportOptions = { recorderSampleRate: 16000, playerSampleRate: 16000 };

function App() {
  const [connectEndpoint, setConnectEndpoint] = useState(defaultConnectEndpoint);
  const [settingsJson, setSettingsJson] = useState(defaultSettingsJson);
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
      defaultSettingsJson={defaultSettingsJson}
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
