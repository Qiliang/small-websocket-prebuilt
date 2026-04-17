import {
  Banner,
  BannerClose,
  BannerIcon,
  BannerTitle,
  BotAudioPanel,
  BotVideoPanel,
  ConnectButton,
  ConversationPanel,
  EventsPanel,
  InfoPanel,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SpinLoader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ThemeModeToggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  usePipecatConversation,
  type PipecatBaseChildProps,
} from "@pipecat-ai/voice-ui-kit";
import { RTVIEvent } from "@pipecat-ai/client-js";
import { useRTVIClientEvent } from "@pipecat-ai/client-react";
import {
  BotIcon,
  ChevronsLeftRightEllipsis,
  CircleAlert,
  InfoIcon,
  MessagesSquare,
  Settings2,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";
import { HollyCrmLogo } from "./hollycrmLogo";

type ConsoleTemplateProps = ComponentProps<
  typeof import("@pipecat-ai/voice-ui-kit").ConsoleTemplate
>;

export type PlaygroundConsoleProps = Omit<ConsoleTemplateProps, "transportType" | "transportOptions"> &
  PipecatBaseChildProps & {
    connectionUrl?: string;
    settingsContent?: ReactNode;
  };

function resolveDisplayUrl(url: string): string {
  if (typeof window === "undefined") return url;
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

export function PlaygroundConsole(props: PlaygroundConsoleProps) {
  if (!props.client) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <SpinLoader />
      </div>
    );
  }
  return <PlaygroundConsoleInner {...props} client={props.client} />;
}

function PlaygroundConsoleInner(
  props: PlaygroundConsoleProps & { client: NonNullable<PlaygroundConsoleProps["client"]> },
) {
  const {
    error,
    handleConnect,
    handleDisconnect,
    connectionUrl,
    settingsContent,
    titleText = "WebSocket Playground",
    noThemeSwitch = false,
    noLogo = false,
    noSessionInfo = false,
    noStatusInfo = false,
    noUserAudio = false,
    noUserVideo = true,
    noScreenControl = false,
    noTextInput = false,
    noBotAudio = true,
    noBotVideo = true,
    noConversation = false,
    noMetrics = false,
    collapseInfoPanel = false,
    collapseMediaPanel = false,
    assistantLabelText,
    userLabelText,
    systemLabelText,
    conversationElementProps,
    logoComponent,
  } = props;

  const [isBotAreaCollapsed, setIsBotAreaCollapsed] = useState(false);
  const [isEventsPanelCollapsed, setIsEventsPanelCollapsed] = useState(false);
  const [participantId, setParticipantId] = useState("");
  const [sessionId, setSessionId] = useState("");

  useRTVIClientEvent(RTVIEvent.ParticipantConnected, (p) => {
    if (p.local) setParticipantId(p.id || "");
  });
  useRTVIClientEvent(RTVIEvent.TrackStarted, (_track, p) => {
    if (p?.id && p?.local) setParticipantId(p.id);
  });
  useRTVIClientEvent(RTVIEvent.BotStarted, (data) => {
    const sessionData = data as { sessionId?: string };
    if (sessionData?.sessionId) {
      setSessionId(sessionData.sessionId);
    }
  });

  const { injectMessage } = usePipecatConversation();
  useEffect(() => {
    props.onInjectMessage?.(injectMessage);
  }, [props.onInjectMessage, injectMessage]);

  const noBotArea = noBotAudio && noBotVideo;
  const noConversationPanel = noConversation && noMetrics;
  const noInfoPanel = noStatusInfo && noUserAudio && noUserVideo && noScreenControl && noSessionInfo;
  const tooltipUrl = connectionUrl ? resolveDisplayUrl(connectionUrl) : undefined;

  /** When only conversation + info (no bot strip), use 50/50; with bot area, split remainder evenly (26+37+37). */
  const conversationPanelDefault = collapseInfoPanel ? 70 : noBotArea ? 50 : 37;
  const infoPanelDefault = collapseInfoPanel ? 4 : noBotArea ? 50 : 37;

  return (
    <Fragment>
      <div className="flex flex-col h-full w-full overflow-auto">
        <div className="h-min grid grid-cols-2 sm:grid-cols-[150px_1fr_150px] gap-2 items-center justify-center p-2 bg-background sm:relative top-0 w-full z-10">
          {noLogo ? <span className="h-6" /> : logoComponent ?? <HollyCrmLogo />}
          <strong className="hidden sm:block text-center">{titleText}</strong>
          <div className="flex items-center justify-end gap-2 sm:gap-3 xl:gap-6">
            {!noThemeSwitch ? <ThemeModeToggle /> : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <ConnectButton
                    onConnect={() => void handleConnect?.()}
                    onDisconnect={() => void handleDisconnect?.()}
                  />
                </span>
              </TooltipTrigger>
              {tooltipUrl ? (
                <TooltipContent align="end" side="bottom">
                  {tooltipUrl}
                </TooltipContent>
              ) : null}
            </Tooltip>
          </div>
        </div>

        {error ? (
          <Banner variant="destructive" className="h-min animate-in fade-in duration-300">
            <BannerIcon icon={CircleAlert} />
            <BannerTitle>Unable to connect. Please check web console for errors.</BannerTitle>
            <BannerClose variant="destructive" />
          </Banner>
        ) : null}

        <div className="hidden sm:block h-full">
          <ResizablePanelGroup direction="vertical" className="h-full">
            <ResizablePanel defaultSize={70} minSize={50}>
              <ResizablePanelGroup direction="horizontal">
                {!noBotArea ? (
                  <Fragment>
                    <ResizablePanel
                      className="flex flex-col gap-2 p-2 xl:gap-4"
                      defaultSize={collapseMediaPanel ? 8 : 26}
                      maxSize={30}
                      minSize={10}
                      collapsible
                      collapsedSize={8}
                      onCollapse={() => setIsBotAreaCollapsed(true)}
                      onExpand={() => setIsBotAreaCollapsed(false)}
                    >
                      {!noBotAudio ? (
                        <BotAudioPanel
                          className={cn({
                            "mb-auto": noBotVideo,
                          })}
                          collapsed={isBotAreaCollapsed}
                        />
                      ) : null}
                      {!noBotVideo ? (
                        <BotVideoPanel
                          className={cn({
                            "mt-auto": noBotAudio,
                          })}
                          collapsed={isBotAreaCollapsed}
                        />
                      ) : null}
                    </ResizablePanel>
                    {!noConversationPanel || !noInfoPanel ? <ResizableHandle withHandle /> : null}
                  </Fragment>
                ) : null}

                {!noConversationPanel ? (
                  <Fragment>
                    <ResizablePanel className="h-full p-2" defaultSize={conversationPanelDefault} minSize={30}>
                      <ConversationPanel
                        noConversation={noConversation}
                        noMetrics={noMetrics}
                        noTextInput={noTextInput}
                        conversationElementProps={{
                          ...conversationElementProps,
                          assistantLabel: assistantLabelText,
                          clientLabel: userLabelText,
                          systemLabel: systemLabelText,
                        }}
                      />
                    </ResizablePanel>
                    {!noInfoPanel ? <ResizableHandle withHandle /> : null}
                  </Fragment>
                ) : null}

                {!noInfoPanel ? (
                  <ResizablePanel
                    id="info-panel"
                    collapsible
                    collapsedSize={4}
                    defaultSize={infoPanelDefault}
                    minSize={15}
                    className="p-2"
                  >
                  
                      <Tabs defaultValue="info" className="h-full flex flex-col gap-1">
                        <TabsList className="w-full shrink-0">
                          <TabsTrigger value="info" className="flex-1">
                            <InfoIcon className="w-3.5 h-3.5 mr-1" />
                            Info
                          </TabsTrigger>
                          <TabsTrigger value="settings" className="flex-1">
                            <Settings2 className="w-3.5 h-3.5 mr-1" />
                            Settings
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="info" className="flex-1 overflow-auto mt-0">
                          <InfoPanel
                            noSessionInfo={noSessionInfo}
                            noStatusInfo={noStatusInfo}
                            noUserAudio={noUserAudio}
                            noUserVideo={noUserVideo}
                            noScreenControl={noScreenControl}
                            participantId={participantId}
                            sessionId={sessionId}
                          />
                        </TabsContent>
                        <TabsContent value="settings" className="flex-1 overflow-auto mt-0">
                          {settingsContent}
                        </TabsContent>
                      </Tabs>
                    
                  </ResizablePanel>
                ) : null}
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel
              collapsible
              collapsedSize={4}
              minSize={7}
              onCollapse={() => setIsEventsPanelCollapsed(true)}
              onExpand={() => setIsEventsPanelCollapsed(false)}
            >
              <EventsPanel collapsed={isEventsPanelCollapsed} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <Tabs
          defaultValue={noBotArea ? (noConversationPanel ? "info" : "conversation") : "bot"}
          className="flex flex-col gap-0 h-full sm:hidden overflow-hidden"
        >
          <div className="flex flex-col overflow-hidden flex-1">
            {!noBotArea ? (
              <TabsContent value="bot" className="flex-1 overflow-auto flex flex-col gap-4 p-2">
                {!noBotAudio ? <BotAudioPanel /> : null}
                {!noBotVideo ? <BotVideoPanel /> : null}
              </TabsContent>
            ) : null}
            {!noConversationPanel ? (
              <TabsContent value="conversation" className="flex-1 overflow-auto">
                <ConversationPanel
                  noConversation={noConversation}
                  noMetrics={noMetrics}
                  noTextInput={noTextInput}
                  conversationElementProps={{
                    ...conversationElementProps,
                    assistantLabel: assistantLabelText,
                    clientLabel: userLabelText,
                    systemLabel: systemLabelText,
                  }}
                />
              </TabsContent>
            ) : null}
            <TabsContent value="info" className="flex-1 overflow-auto p-2">
              <InfoPanel
                noUserAudio={noUserAudio}
                noUserVideo={noUserVideo}
                noScreenControl={noScreenControl}
                participantId={participantId}
                sessionId={sessionId}
              />
            </TabsContent>
            <TabsContent value="events" className="flex-1 overflow-auto">
              <EventsPanel />
            </TabsContent>
            {settingsContent ? (
              <TabsContent value="settings" className="flex-1 overflow-auto">
                {settingsContent}
              </TabsContent>
            ) : null}
          </div>
          <TabsList className="w-full h-12 rounded-none z-10 mt-auto shrink-0">
            {!noBotArea ? (
              <TabsTrigger value="bot">
                <BotIcon />
              </TabsTrigger>
            ) : null}
            {!noConversationPanel ? (
              <TabsTrigger value="conversation">
                <MessagesSquare />
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="info">
              <InfoIcon />
            </TabsTrigger>
            <TabsTrigger value="events">
              <ChevronsLeftRightEllipsis />
            </TabsTrigger>
            {settingsContent ? (
              <TabsTrigger value="settings">
                <Settings2 />
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
      </div>
    </Fragment>
  );
}
