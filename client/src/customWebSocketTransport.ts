import { logger } from "@pipecat-ai/client-js";
import {
  WebSocketTransport,
  type WebSocketTransportConstructorOptions,
} from "@pipecat-ai/websocket-transport";

export type HandshakeConfig = {
  conversationId: string;
  settings: Record<string, unknown>;
};

const HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * 继承 WebSocketTransport：
 * - 禁用 cam / screen share
 * - 支持服务端 handshake 模式：先收 ready JSON，再发 init_settings，等 settings_ack
 */
export class CustomWebSocketTransport extends WebSocketTransport {
  private _handshake: HandshakeConfig | null = null;

  constructor(opts?: WebSocketTransportConstructorOptions) {
    super(opts);
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
