import { usePipecatClientMediaDevices } from "@pipecat-ai/client-react";
import {
  Banner,
  BannerClose,
  BannerIcon,
  BannerTitle,
  Button,
  ButtonGroup,
  ConnectButton,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FullScreenContainer,
  SpinLoader,
  ThemeProvider,
  TooltipProvider,
  UserAudioControl,
  usePipecatConnectionState,
  usePipecatConversation,
  type ConversationMessage,
} from "@pipecat-ai/voice-ui-kit";
import { ChevronDown, CircleAlert } from "lucide-react";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { basicAuthHeaders } from "./basicAuth";
import { defaultConnectEndpoint, transportOptions, useConnectSession } from "./connectSession";
import { SettingsEditor } from "./settingsEditor";
import { WebsocketPipecatAppBase } from "./websocketPipecatAppBase";

function embedQuery(name: string, fallback: string): string {
  try {
    const value = new URLSearchParams(window.location.search).get(name)?.trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

/** 查询参数不存在时返回 undefined，存在则原样返回（允许空字符串）。 */
function embedParam(name: string): string | undefined {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(name)) return undefined;
    return params.get(name) ?? "";
  } catch {
    return undefined;
  }
}

// @ts-ignore — font packages ship without TypeScript declarations
import "@fontsource-variable/geist";
// @ts-ignore — font packages ship without TypeScript declarations
import "@fontsource-variable/geist-mono";

import "./style.css";

function partText(text: ConversationMessage["parts"][number]["text"]): string {
  if (typeof text === "string") return text;
  if (text && typeof text === "object" && "spoken" in text) {
    return `${text.spoken}${text.unspoken ?? ""}`;
  }
  return "";
}

function latestSpeech(messages: ConversationMessage[]): { role: "user" | "assistant"; text: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.parts.map((part) => partText(part.text)).join("").trim();
    if (text) return { role: message.role, text };
  }
  return null;
}

function VolumeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
      <path d="M16 9a5 5 0 0 1 0 6" />
      <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
    </svg>
  );
}

function SpeakerControl() {
  const { availableSpeakers, selectedSpeaker, updateSpeaker } = usePipecatClientMediaDevices();
  const selectedId = "deviceId" in selectedSpeaker ? selectedSpeaker.deviceId : undefined;

  return (
    <ButtonGroup className="gap-[1px]">
      <Button
        variant="secondary"
        size="sm"
        className="flex-1 z-10 justify-start rounded-e-none"
        aria-label="扬声器"
      >
        <VolumeIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            isIcon
            className="flex-none z-0 rounded-s-none border-l-0"
            aria-label="选择扬声器"
          >
            <ChevronDown size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>扬声器</DropdownMenuLabel>
          {availableSpeakers.length > 0 ? <DropdownMenuSeparator /> : null}
          {availableSpeakers.map((device) => (
            <DropdownMenuCheckboxItem
              key={device.deviceId}
              checked={selectedId === device.deviceId}
              onCheckedChange={() => updateSpeaker(device.deviceId)}
            >
              {device.label || `Speaker ${device.deviceId.slice(0, 5)}`}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

function SpeakingLine() {
  const { isConnected } = usePipecatConnectionState();
  const { messages } = usePipecatConversation();
  const latest = isConnected ? latestSpeech(messages) : null;
  const label = latest?.role === "user" ? "User" : "Assistant";

  return (
    <div className="shrink-0 border-t bg-background px-3 py-2 text-sm min-h-10">
      {latest ? (
        <p className="leading-snug">
          <span className="font-medium">{label}: </span>
          {latest.text}
        </p>
      ) : null}
    </div>
  );
}

function EmbedApp() {
  const saveUrl = embedQuery("saveUrl", "");
  const session = useConnectSession(embedQuery("connectUrl", defaultConnectEndpoint));
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    const url = saveUrl.trim();
    if (!url) return;
    if (session.jsonError || !session.settingsJson.trim()) {
      setSaveError(session.jsonError || "当前配置为空");
      setSaveMessage(null);
      return;
    }
    console.log(session.settingsJson);
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: basicAuthHeaders({ "Content-Type": "application/json" }),
        body: session.settingsJson,
      });
      if (!res.ok) {
        const detail = (await res.text()).trim().slice(0, 180);
        throw new Error(detail ? `HTTP ${res.status} ${detail}` : `HTTP ${res.status}`);
      }
      setSaveMessage("已保存");
    } catch (e) {
      setSaveError((e as Error).message || String(e));
    } finally {
      setSaving(false);
    }
  };

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
            {(childProps) => !childProps.client ? (
              <div className="flex items-center justify-center h-full w-full">
                <SpinLoader />
              </div>
            ) : (
              <div className="flex flex-col h-full w-full overflow-hidden">
                <div className="relative flex items-center gap-2 p-2 border-b bg-background shrink-0">
                  <UserAudioControl
                    size="sm"
                    noVisualizer
                    noSpeakers
                    microphoneLabel="麦克风"
                  />
                  <SpeakerControl />
                  {saveMessage || saveError ? (
                    <span
                      className={`pointer-events-none absolute left-1/2 top-1/2 max-w-[40%] -translate-x-1/2 -translate-y-1/2 truncate text-xs ${saveError ? "text-destructive" : "text-muted-foreground"}`}
                      title={saveError || saveMessage || undefined}
                    >
                      {saveError || saveMessage}
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    {saveUrl.trim() ? (
                      <Button
                        variant="active"
                        size="sm"
                        isLoading={saving}
                        disabled={saving || !!session.jsonError || !session.settingsJson.trim()}
                        onClick={() => void handleSave()}
                      >
                        保存
                      </Button>
                    ) : null}
                    <ConnectButton
                      size="sm"
                      stateContent={{
                        disconnected: { children: "连接", variant: "active" },
                        initialized: { children: "连接", variant: "active" },
                        initializing: { children: "初始化…", variant: "secondary" },
                        authenticating: { children: "连接中…", variant: "secondary" },
                        authenticated: { children: "连接中…", variant: "secondary" },
                        connecting: { children: "连接中…", variant: "secondary" },
                        connected: { children: "连接中…", variant: "secondary" },
                        ready: { children: "断开", variant: "destructive" },
                        disconnecting: { children: "断开中…", variant: "secondary" },
                        error: { children: "出错", variant: "destructive" },
                      }}
                      onConnect={() => void childProps.handleConnect?.()}
                      onDisconnect={() => void session.disconnectAndFinish(childProps.handleDisconnect)}
                    />
                  </div>
                </div>

                {childProps.error ? (
                  <Banner variant="destructive" className="h-min animate-in fade-in duration-300">
                    <BannerIcon icon={CircleAlert} />
                    <BannerTitle>Unable to connect. Please check web console for errors.</BannerTitle>
                    <BannerClose variant="destructive" />
                  </Banner>
                ) : null}

                <div className="flex-1 min-h-0 overflow-hidden">
                  <SettingsEditor
                    agentTheme
                    showEndpoint={false}
                    schemaUrl={embedQuery("schemaUrl", "/bot/settings/_schema")}
                    defaultsUrl={embedQuery("settingsUrl", "/client/_settings")}
                    lockedAccountId={embedParam("accountId")}
                    lockedAgentJson={embedParam("agent")}
                    endpoint={session.connectEndpoint}
                    onEndpointChange={session.setConnectEndpoint}
                    settingsJson={session.settingsJson}
                    onSettingsChange={session.handleSettingsChange}
                    jsonError={session.jsonError}
                  />
                </div>

                <SpeakingLine />
              </div>
            )}
          </WebsocketPipecatAppBase>
        </FullScreenContainer>
      </TooltipProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EmbedApp />
  </StrictMode>,
);
