/**
 * `@pipecat-ai/websocket-transport` 把 WavMediaManager 从
 * `@pipecat-ai/transport-lib` 再导出，但该包只在上游构建时打包进 JS，
 * 没有发布到 npm。没有这份声明时，WavMediaManager 不是 class，
 * 子类上的 override / 继承方法都会报错。
 */
declare module "@pipecat-ai/transport-lib" {
  export abstract class MediaManager {
    abstract initialize(): Promise<void>;
    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
    abstract getAllMics(): Promise<MediaDeviceInfo[]>;
    abstract getAllCams(): Promise<MediaDeviceInfo[]>;
    abstract getAllSpeakers(): Promise<MediaDeviceInfo[]>;
    abstract updateMic(micId: string): void;
    abstract updateCam(camId: string): void;
    abstract updateSpeaker(speakerId: string): void;
    abstract get selectedMic(): MediaDeviceInfo | Record<string, never>;
    abstract get selectedCam(): MediaDeviceInfo | Record<string, never>;
    abstract get selectedSpeaker(): MediaDeviceInfo | Record<string, never>;
    abstract enableMic(enable: boolean): void;
    abstract enableCam(enable: boolean): void;
    abstract enableScreenShare(enable: boolean): void;
    abstract get isCamEnabled(): boolean;
    abstract get isMicEnabled(): boolean;
    abstract get isSharingScreen(): boolean;
  }

  export class WavMediaManager extends MediaManager {
    constructor(recorderChunkSize?: number, recorderSampleRate?: number);
    initialize(): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getAllMics(): Promise<MediaDeviceInfo[]>;
    getAllCams(): Promise<MediaDeviceInfo[]>;
    getAllSpeakers(): Promise<MediaDeviceInfo[]>;
    updateMic(micId: string): Promise<void>;
    updateCam(camId: string): void;
    updateSpeaker(speakerId: string): void;
    get selectedMic(): MediaDeviceInfo | Record<string, never>;
    get selectedCam(): MediaDeviceInfo | Record<string, never>;
    get selectedSpeaker(): MediaDeviceInfo | Record<string, never>;
    enableMic(enable: boolean): Promise<void>;
    enableCam(enable: boolean): void;
    enableScreenShare(enable: boolean): void;
    get isCamEnabled(): boolean;
    get isMicEnabled(): boolean;
    get isSharingScreen(): boolean;
  }

  export class DailyMediaManager extends MediaManager {
    initialize(): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getAllMics(): Promise<MediaDeviceInfo[]>;
    getAllCams(): Promise<MediaDeviceInfo[]>;
    getAllSpeakers(): Promise<MediaDeviceInfo[]>;
    updateMic(micId: string): void;
    updateCam(camId: string): void;
    updateSpeaker(speakerId: string): void;
    get selectedMic(): MediaDeviceInfo | Record<string, never>;
    get selectedCam(): MediaDeviceInfo | Record<string, never>;
    get selectedSpeaker(): MediaDeviceInfo | Record<string, never>;
    enableMic(enable: boolean): void;
    enableCam(enable: boolean): void;
    enableScreenShare(enable: boolean): void;
    get isCamEnabled(): boolean;
    get isMicEnabled(): boolean;
    get isSharingScreen(): boolean;
  }

  export class ReconnectingWebSocket {
    connect(): Promise<void>;
    close(): Promise<void>;
    send(data: unknown): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    off(event: string, listener: (...args: unknown[]) => void): void;
    removeListener(event: string, listener: (...args: unknown[]) => void): void;
  }
}
