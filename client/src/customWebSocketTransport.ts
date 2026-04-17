import {
  logger,
} from "@pipecat-ai/client-js";
import { WebSocketTransport, type WebSocketTransportConstructorOptions } from "@pipecat-ai/websocket-transport";

/**
 * 继承 WebSocketTransport，覆写 isSharingScreen getter 和 enableCam 方法，
 * 使摄像头与屏幕共享始终被视为不可用，避免底层 mediaManager 报错。
 */
export class CustomWebSocketTransport extends WebSocketTransport {
  constructor(opts?: WebSocketTransportConstructorOptions) {
    super(opts);
  }

  override get isSharingScreen(): boolean {
    logger.warn("isSharingScreen not implemented for WebSocketTransport");
    return false;
  }

  override get isCamEnabled(): boolean {
    logger.warn("isCamEnabled not implemented for WebSocketTransport");
    return false;
  }


}
