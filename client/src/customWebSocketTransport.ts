import { logger } from "@pipecat-ai/client-js";
import {
  ProtobufFrameSerializer,
  WavMediaManager,
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
const RECORDER_CHUNK_SIZE = 512;

type WavPlayer = {
  sampleRate: number;
  updateSpeaker: (speakerId: string) => Promise<void>;
};

type SpeakerCallbacks = {
  onAvailableSpeakersUpdated?: (speakers: MediaDeviceInfo[]) => void;
  onSpeakerUpdated?: (speaker: MediaDeviceInfo | Record<string, never>) => void;
  onMicUpdated?: (mic: MediaDeviceInfo) => void;
};

type WavRecorder = {
  deviceSelection: MediaDeviceInfo | null;
  stream: MediaStream | null;
  recording: boolean;
  pause: () => Promise<boolean>;
};

/**
 * WebSocketTransport 默认用 DailyMediaManager，构造时就会
 * createCallObject() 并拉取 c.daily.co 上的 call-machine bundle。
 * 这里改用包内的 WavMediaManager（getUserMedia + AudioWorklet），
 * 并把播放采样率改成与 recorder/player 配置一致（库内写死 24000）。
 * 扬声器列表由 enumerateDevices 补上，WavMediaManager 本身不提供。
 */
class LocalAudioMediaManager extends WavMediaManager {
  private _selectedSpeaker: MediaDeviceInfo | Record<string, never> = {};
  private _onDeviceChange: (() => void) | null = null;

  constructor(recorderSampleRate: number, playerSampleRate: number) {
    super(RECORDER_CHUNK_SIZE, recorderSampleRate);
    this.player.sampleRate = playerSampleRate;
  }

  private get player(): WavPlayer {
    return (this as unknown as { _wavStreamPlayer: WavPlayer })._wavStreamPlayer;
  }

  private get speakerCallbacks(): SpeakerCallbacks {
    return (this as unknown as { _callbacks: SpeakerCallbacks })._callbacks ?? {};
  }

  async initialize(): Promise<void> {
    await super.initialize();
    if (!this._onDeviceChange && navigator.mediaDevices) {
      this._onDeviceChange = () => {
        void this.publishSpeakers();
      };
      navigator.mediaDevices.addEventListener("devicechange", this._onDeviceChange);
    }
    await this.publishSpeakers();
    await this.publishDefaultMic();
  }

  /**
   * WavRecorder 在 begin() 里异步写入 deviceSelection，且不会发 MicUpdated。
   * 系统默认麦克风在列表里的 deviceId 是 "default"，轨道上则是具体设备 id，
   * 这里把同一组设备勾回 "default" 那一项。
   */
  private async publishDefaultMic(): Promise<void> {
    const recorder = (this as unknown as { _wavRecorder: WavRecorder })._wavRecorder;
    let selected = recorder.deviceSelection;
    for (let i = 0; i < 20 && !selected?.deviceId; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      selected = recorder.deviceSelection;
    }

    const mics = await this.getAllMics();
    const trackId = recorder.stream?.getAudioTracks()[0]?.getSettings().deviceId;
    const active = trackId ? mics.find((mic) => mic.deviceId === trackId) : undefined;
    const systemDefault = mics.find((mic) => mic.deviceId === "default");
    const next =
      (active && systemDefault && active.groupId === systemDefault.groupId
        ? systemDefault
        : active) ??
      systemDefault ??
      mics[0];
    if (!next) return;

    recorder.deviceSelection = next;
    this.speakerCallbacks.onMicUpdated?.(next);
  }

  /**
   * begin() 之后录音器处于 paused，此时点麦克风图标会走 pause() 并抛
   * "Already paused"。还没 record() 时只关音轨。
   */
  override async enableMic(enable: boolean): Promise<void> {
    const self = this as unknown as {
      _micEnabled: boolean;
      _wavRecorder: WavRecorder;
      _callbacks: {
        onTrackStopped?: (track: MediaStreamTrack, participant: { id: string; name: string; local: boolean }) => void;
      };
      _startRecording: () => Promise<void>;
    };
    self._micEnabled = enable;
    const stream = self._wavRecorder.stream;
    if (!stream) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = enable;
      if (!enable) {
        self._callbacks.onTrackStopped?.(track, { id: "local", name: "", local: true });
      }
    });
    if (enable) {
      await self._startRecording();
      return;
    }
    if (self._wavRecorder.recording) {
      await self._wavRecorder.pause();
    }
  }

  async disconnect(): Promise<void> {
    if (this._onDeviceChange) {
      navigator.mediaDevices?.removeEventListener("devicechange", this._onDeviceChange);
      this._onDeviceChange = null;
    }
    await super.disconnect();
  }

  getAllSpeakers(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then((devices) =>
      devices.filter((device) => device.kind === "audiooutput"),
    );
  }

  async updateSpeaker(speakerId: string): Promise<void> {
    await this.player.updateSpeaker(speakerId);
    const speakers = await this.getAllSpeakers();
    const selected =
      speakers.find((speaker) => speaker.deviceId === speakerId) ??
      ({ deviceId: speakerId } as MediaDeviceInfo);
    this._selectedSpeaker = selected;
    this.speakerCallbacks.onSpeakerUpdated?.(this._selectedSpeaker);
  }

  get selectedSpeaker(): MediaDeviceInfo | Record<string, never> {
    return this._selectedSpeaker;
  }

  private async publishSpeakers(): Promise<void> {
    const speakers = await this.getAllSpeakers();
    this.speakerCallbacks.onAvailableSpeakersUpdated?.(speakers);
    const currentId =
      "deviceId" in this._selectedSpeaker ? this._selectedSpeaker.deviceId : undefined;
    if (currentId && speakers.some((speaker) => speaker.deviceId === currentId)) return;
    const next = speakers.find((speaker) => speaker.deviceId === "default") ?? speakers[0];
    if (!next) return;
    this._selectedSpeaker = next;
    this.speakerCallbacks.onSpeakerUpdated?.(next);
  }
}

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
    const recorderSampleRate = opts?.recorderSampleRate ?? 16_000;
    const playerSampleRate = opts?.playerSampleRate ?? 24_000;
    super({
      ...opts,
      mediaManager:
        opts?.mediaManager ??
        new LocalAudioMediaManager(recorderSampleRate, playerSampleRate),
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
   * WavMediaManager.disconnect() calls WavRecorder.end().
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
