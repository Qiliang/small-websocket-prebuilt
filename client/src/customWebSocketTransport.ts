import { logger } from "@pipecat-ai/client-js";
import {
  ProtobufFrameSerializer,
  WebSocketTransport,
} from "@pipecat-ai/websocket-transport";

// The package declares this type but does not export it.
export type WebSocketTransportConstructorOptions = NonNullable<
  ConstructorParameters<typeof WebSocketTransport>[0]
>;

type FrameSerializer = NonNullable<
  WebSocketTransportConstructorOptions["serializer"]
>;

export type HandshakeConfig = {
  conversationId: string;
  settings: Record<string, unknown>;
};

const HANDSHAKE_TIMEOUT_MS = 30_000;

function toBlob(data: unknown): Blob {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return new Blob([copy]);
  }
  throw new Error("Unknown data type");
}

/**
 * ProtobufFrameSerializer 只接受 Blob。握手 JSON（ready / settings_ack）是
 * WebSocket 文本帧（string），部分环境还会把二进制当成 ArrayBuffer/Uint8Array。
 * 文本控制消息按 raw 跳过，避免父类打出 Failed to deserialize / Unknown data type。
 */
function createTolerantSerializer(inner?: FrameSerializer): FrameSerializer {
  const delegate = inner ?? new ProtobufFrameSerializer();
  return {
    serialize: (data) => delegate.serialize(data),
    serializeAudio: (data, sampleRate, numChannels) =>
      delegate.serializeAudio(data, sampleRate, numChannels),
    serializeMessage: (msg) => delegate.serializeMessage(msg),
    async deserialize(data) {
      if (typeof data === "string") {
        try {
          return { type: "raw" as const, message: JSON.parse(data) };
        } catch {
          return { type: "raw" as const, message: data };
        }
      }
      if (
        data &&
        typeof data === "object" &&
        !(data instanceof Blob) &&
        !(data instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(data)
      ) {
        return { type: "raw" as const, message: data };
      }
      return delegate.deserialize(toBlob(data));
    },
  };
}

/**
 * 继承 WebSocketTransport：
 * - 禁用 cam / screen share
 * - 支持服务端 handshake 模式：先收 ready JSON，再发 init_settings，等 settings_ack
 */
export class CustomWebSocketTransport extends WebSocketTransport {
  private _handshake: HandshakeConfig | null = null;

  constructor(opts?: WebSocketTransportConstructorOptions) {
    super({
      ...opts,
      serializer: createTolerantSerializer(opts?.serializer),
    });
  }

  setHandshake(config: HandshakeConfig | null) {
    this._handshake = config;
  }

  override get isSharingScreen(): boolean {
    logger.warn("isSharingScreen not implemented for WebSocketTransport");
    return false;
  }

  override get isCamEnabled(): boolean {
    logger.warn("isCamEnabled not implemented for WebSocketTransport");
    return false;
  }

  override enableCam(_enable: boolean): void {
    logger.warn("enableCam not implemented for WebSocketTransport");
  }

  override enableScreenShare(_enable: boolean): void {
    logger.warn("enableScreenShare not implemented for WebSocketTransport");
  }

  /**
   * 在父类连接流程中插入 JSON 握手（仅当 setHandshake 已设置）。
   * 必须在 mediaManager.connect() 之前完成，避免二进制音频抢先到达服务端。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async _connect(connectParams?: { wsUrl?: string; ws_url?: string }): Promise<void> {
    const self = this as any;
    if (self._abortController?.signal.aborted) return;

    this.state = "connecting";
    self._wsUrl = connectParams?.wsUrl ?? connectParams?.ws_url ?? self._wsUrl;
    if (!self._wsUrl) {
      logger.error("No url provided for connection");
      this.state = "error";
      throw new Error("No url provided for connection");
    }

    try {
      self._ws = this.initializeWebsocket();

      // 必须在 connect() 之前挂上监听，避免错过服务端立刻下发的 ready
      const handshakePromise = this._handshake
        ? this._runHandshake(self._ws, this._handshake)
        : null;

      await self._ws.connect();

      if (handshakePromise) {
        logger.info("Running BotSettings handshake (init_settings)");
        await handshakePromise;
        this._handshake = null;
      }

      await self._mediaManager.connect();
      if (self._abortController?.signal.aborted) return;

      this.state = "connected";
      self._callbacks.onConnected?.();
    } catch (error) {
      const msg = `Failed to connect to websocket: ${error}`;
      logger.error(msg);
      this.state = "error";
      throw new Error(msg);
    }
  }

  /**
   * DailyMediaManager.disconnect() always calls WavRecorder.end().
   * That throws "Session ended: please call .begin() first" when:
   * - initDevices is still in progress (StrictMode remount / effect cleanup)
   * - mic track never started (permission denied)
   * - disconnect is invoked twice (user Disconnect + resetKey teardown)
   * Swallow that so websocket close + disconnected state still run.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async _disconnect(): Promise<void> {
    if (this.state === "disconnected" || this.state === "disconnecting") {
      return;
    }

    const self = this as any;
    this.state = "disconnecting";
    try {
      await self._mediaManager.disconnect();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes("please call .begin()")) {
        logger.warn(`mediaManager.disconnect() failed: ${msg}`);
      }
    }
    try {
      await self._ws?.close();
    } catch (error) {
      logger.warn(`websocket close failed: ${error}`);
    }
    this.state = "disconnected";
    self._callbacks.onDisconnected?.();
  }

  private _runHandshake(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws: any,
    handshake: HandshakeConfig,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.off?.("message", onMessage);
        ws.removeListener?.("message", onMessage);
        if (err) reject(err);
        else resolve();
      };

      const timer = setTimeout(() => {
        finish(new Error("Handshake timeout waiting for ready/settings_ack"));
      }, HANDSHAKE_TIMEOUT_MS);

      const handleObj = (obj: Record<string, unknown>) => {
        const type = obj?.type;
        if (type === "ready") {
          const msg = {
            type: "init_settings",
            conversation_id: handshake.conversationId,
            data: handshake.settings,
          };
          void ws.send(JSON.stringify(msg));
          return;
        }
        if (type === "settings_ack") {
          finish();
          return;
        }
        if (type === "error") {
          finish(new Error(String(obj.message ?? "Handshake error from server")));
        }
      };

      const onMessage = (data: unknown) => {
        if (typeof data === "string") {
          try {
            handleObj(JSON.parse(data) as Record<string, unknown>);
          } catch {
            // 非 JSON（例如后续 protobuf），握手阶段忽略
          }
          return;
        }
        if (data && typeof data === "object" && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer) && !(data instanceof Blob)) {
          // Blob parse 路径可能直接给出 object
          if ("type" in (data as object)) {
            handleObj(data as Record<string, unknown>);
          }
        }
      };

      ws.on("message", onMessage);
    });
  }
}
