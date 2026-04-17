import {
  ConversationProvider,
  ThemeProvider,
  type PipecatBaseChildProps,
  type PipecatBaseProps,
} from "@pipecat-ai/voice-ui-kit";
import { PipecatClient } from "@pipecat-ai/client-js";
import { PipecatClientAudio, PipecatClientProvider } from "@pipecat-ai/client-react";
import { type WebSocketTransportConstructorOptions } from "@pipecat-ai/websocket-transport";
import { CustomWebSocketTransport } from "./customWebSocketTransport";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const defaultStartBotResponseTransformer: NonNullable<
  PipecatBaseProps["startBotResponseTransformer"]
> = (response) => response;

export type WebsocketPipecatAppBaseProps = Omit<
  PipecatBaseProps,
  "transportType" | "transportOptions"
> & {
  transportOptions?: WebSocketTransportConstructorOptions;
};

/**
 * Same role as PipecatAppBase from voice-ui-kit, but uses WebSocketTransport
 * (ConsoleTemplate only supports smallwebrtc / daily).
 */
export function WebsocketPipecatAppBase({
  clientOptions,
  connectOnMount = false,
  connectParams,
  initDevicesOnMount = false,
  noAudioOutput = false,
  noThemeProvider = false,
  startBotParams,
  startBotResponseTransformer = defaultStartBotResponseTransformer,
  transportOptions,
  themeProps,
  children,
}: WebsocketPipecatAppBaseProps) {
  const [state, setState] = useState<{
    client: PipecatClient | null;
    error: string | null;
    rawStartBotResponse: unknown;
    transformedStartBotResponse: unknown;
  }>({
    client: null,
    error: null,
    rawStartBotResponse: null,
    transformedStartBotResponse: null,
  });

  // Bump this to force useEffect to tear down the current PipecatClient +
  // CustomWebSocketTransport and build a fresh one. Needed after a user-
  // initiated disconnect: the underlying websocket-transport's DailyMediaManager
  // / WavStreamPlayer leaves residual state behind (persisted
  // interruptedTrackIds, orphaned AudioWorkletNode), which silently drops TTS
  // audio on the next connect and leaves the mic control stuck in a loading
  // spinner (UserAudioControl treats transportState === "disconnected" as
  // loading). Recreating the whole client is the reliable workaround.
  const [resetKey, setResetKey] = useState(0);

  // Keep refs up-to-date so startAndConnect always reads the latest values
  // without needing to be in the useEffect dependency array (which would
  // destroy and recreate the PipecatClient every time settings change).
  const connectParamsRef = useRef(connectParams);
  const startBotParamsRef = useRef(startBotParams);
  const transformerRef = useRef(startBotResponseTransformer);
  useEffect(() => { connectParamsRef.current = connectParams; });
  useEffect(() => { startBotParamsRef.current = startBotParams; });
  useEffect(() => { transformerRef.current = startBotResponseTransformer; });

  const startAndConnect = useCallback(async (client: PipecatClient) => {
    try {
      if (startBotParamsRef.current) {
        const response = await client.startBot({
          requestData: {},
          ...startBotParamsRef.current,
        });
        setState((s) => ({ ...s, rawStartBotResponse: response }));
        const transformedResponse = await transformerRef.current(response);
        await client.connect(transformedResponse);
        setState((s) => ({ ...s, transformedStartBotResponse: transformedResponse }));
      } else {
        await client.connect(connectParamsRef.current ?? {});
      }
    } catch (err) {
      console.error("Connection error:", err);
      setState((s) => ({
        ...s,
        error: `Failed to start session: ${err instanceof Error ? err.message : String(err)}`,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let current: PipecatClient | null = null;
    (async () => {
      try {
        const transport = new CustomWebSocketTransport(transportOptions ?? {});
        const pcClient = new PipecatClient({
          enableCam: false,
          enableScreenShare:false,
          enableMic: true,
          transport,
          ...clientOptions,
        });
        current = pcClient;
        setState((s) => ({ ...s, client: pcClient, error: null }));
        if (initDevicesOnMount) {
          await pcClient.initDevices();
        }
        if (connectOnMount) {
          await startAndConnect(pcClient);
        }
      } catch (e) {
        console.error("Failed to initialize WebSocket transport:", e);
      }
    })();
    return () => {
      void current?.disconnect();
      setState({
        client: null,
        error: null,
        rawStartBotResponse: null,
        transformedStartBotResponse: null,
      });
    };
  }, [
    clientOptions,
    connectOnMount,
    initDevicesOnMount,
    startAndConnect,
    transportOptions,
    resetKey,
  ]);

  const handleConnect = async () => {
    const client = state.client;
    if (!client || !["initialized", "disconnected", "error"].includes(client.state)) {
      return;
    }
    setState((s) => ({ ...s, error: null }));
    await startAndConnect(client);
  };

  const handleDisconnect = async () => {
    const client = state.client;
    if (!client) return;
    try {
      await client.disconnect();
    } catch (e) {
      console.error("Error during disconnect:", e);
    }
    // Recreate transport/client so the next Connect starts from a clean
    // media-manager state. See comment on `resetKey` above.
    setResetKey((k) => k + 1);
  };

  const renderChildren = (passed: PipecatBaseChildProps): ReactNode => {
    if (typeof children === "function") {
      return children(passed);
    }
    return children;
  };

  if (!state.client) {
    return typeof children === "function"
      ? renderChildren({
          client: null,
          handleConnect: async () => {
            /* client not ready */
          },
          handleDisconnect: async () => {
            /* client not ready */
          },
          error: null,
          rawStartBotResponse: undefined,
          transformedStartBotResponse: undefined,
        })
      : children;
  }

  const passedProps: PipecatBaseChildProps = {
    client: state.client,
    handleConnect,
    handleDisconnect,
    error: state.error,
    rawStartBotResponse: state.rawStartBotResponse ?? undefined,
    transformedStartBotResponse: state.transformedStartBotResponse ?? undefined,
  };

  const clientProvider = (
    <PipecatClientProvider client={state.client}>
      <ConversationProvider>
        {renderChildren(passedProps)}
        {!noAudioOutput ? <PipecatClientAudio /> : null}
      </ConversationProvider>
    </PipecatClientProvider>
  );

  return noThemeProvider ? (
    clientProvider
  ) : (
    <ThemeProvider {...themeProps}>{clientProvider}</ThemeProvider>
  );
}
