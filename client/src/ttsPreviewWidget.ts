/**
 * Vue2 TTS 试听 Widget，供 vue-json-schema-form 通过 ui:widget=TtsPreviewWidget 引用。
 * @xiaoql/vue-json-schema-form 不含此组件，需在表单挂载前全局注册。
 *
 * 下载文件名使用 schema 显示名：服务提供商 title + 音色 title + 语速。
 */

import { basicAuthHeaders } from "./basicAuth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** 由 settingsEditor 在拉到 schema 后注入，用于解析显示名。 */
let providerSchemaRef: AnyRecord | null = null;

export function setTtsProviderSchema(schema: AnyRecord | null | undefined): void {
  providerSchemaRef = schema && typeof schema === "object" ? schema : null;
}

function guessExt(contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("webm")) return "webm";
  return "wav";
}

function sanitizeFilePart(value: unknown, fallback = "unknown"): string {
  const text = String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_");
  return text || fallback;
}

function providerOptions(schema: AnyRecord | null): AnyRecord[] {
  if (!schema) return [];
  const opts = schema.oneOf || schema.anyOf;
  return Array.isArray(opts) ? opts : [];
}

function matchProviderOption(
  schema: AnyRecord | null,
  name: unknown,
): AnyRecord | null {
  for (const opt of providerOptions(schema)) {
    const props = opt?.properties;
    const nameProp = props?.name;
    const constName =
      nameProp?.const ?? nameProp?.default ?? nameProp?.enum?.[0];
    if (constName === name) return opt;
  }
  return null;
}

function resolveVoiceLabel(
  voiceSchema: AnyRecord | undefined,
  voiceValue: unknown,
): string {
  if (voiceValue == null || voiceValue === "") return "voice";

  const oneOf = voiceSchema?.oneOf;
  if (Array.isArray(oneOf)) {
    for (const opt of oneOf) {
      if (opt && opt.const === voiceValue && opt.title) {
        return String(opt.title);
      }
    }
  }

  const enums = voiceSchema?.enum;
  const names = voiceSchema?.enumNames;
  if (Array.isArray(enums) && Array.isArray(names)) {
    const idx = enums.indexOf(voiceValue);
    if (idx >= 0 && names[idx]) return String(names[idx]);
  }

  return String(voiceValue);
}

function buildTtsDownloadName(
  ttsParams: AnyRecord | null | undefined,
  ext: string,
  providerSchema: AnyRecord | null = providerSchemaRef,
): string {
  const provider =
    ttsParams && typeof ttsParams === "object"
      ? (ttsParams.provider as AnyRecord | undefined)
      : undefined;
  const nameVal = provider?.name;
  const option = matchProviderOption(providerSchema, nameVal);
  const nameLabel = option?.title || nameVal || "provider";

  const voiceVal = provider?.voice?.value ?? provider?.voice;
  const voiceLabel = resolveVoiceLabel(option?.properties?.voice, voiceVal);

  const rateRaw = provider?.speech_rate;
  const rateLabel =
    rateRaw === undefined || rateRaw === null || rateRaw === ""
      ? "default"
      : String(rateRaw);

  return `${sanitizeFilePart(nameLabel, "provider")}+${sanitizeFilePart(voiceLabel, "voice")}+${sanitizeFilePart(rateLabel, "default")}.${ext}`;
}

export function createTtsPreviewWidget(): AnyRecord {
  return {
    name: "TtsPreviewWidget",
    props: {
      value: { type: String, default: "" },
      action: { type: String, default: "" },
      btnText: { type: String, default: "试听" },
      downloadBtnText: { type: String, default: "下载" },
      ttsParams: { type: Object, default: null },
      rows: { type: [Number, String], default: 1 },
      placeholder: { type: String, default: "请输入试听文本" },
    },
    data(): AnyRecord {
      return {
        loading: false,
        audioUrl: null,
        audio: null,
        downloadName: "provider+voice+default.wav",
      };
    },
    computed: {
      inputRows(): number {
        const n = Number(this.rows);
        return Number.isFinite(n) && n > 1 ? n : 1;
      },
      canPreview(): boolean {
        return Boolean(
          this.action &&
            !this.loading &&
            this.value &&
            String(this.value).trim(),
        );
      },
      canDownload(): boolean {
        return Boolean(this.audioUrl) && !this.loading;
      },
    },
    beforeDestroy() {
      this.revokeAudio();
    },
    methods: {
      revokeAudio() {
        if (this.audio) {
          this.audio.pause();
          this.audio = null;
        }
        if (this.audioUrl) {
          URL.revokeObjectURL(this.audioUrl);
          this.audioUrl = null;
        }
      },
      showError(message: string) {
        if (this.$message) {
          this.$message.error(message);
        } else {
          console.error(message);
        }
      },
      handleDownload() {
        if (!this.audioUrl) return;
        const a = document.createElement("a");
        a.href = this.audioUrl;
        a.download =
          this.downloadName ||
          buildTtsDownloadName(this.ttsParams, "wav");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      },
      async handlePreview() {
        if (!this.canPreview) {
          return;
        }
        if (!this.ttsParams || typeof this.ttsParams !== "object") {
          this.showError("缺少 TTS 配置，无法试听");
          return;
        }

        this.loading = true;
        this.revokeAudio();

        try {
          const response = await fetch(this.action, {
            method: "POST",
            headers: basicAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              text: String(this.value).trim(),
              tts: this.ttsParams,
            }),
          });

          const contentType = (
            response.headers.get("content-type") || ""
          ).toLowerCase();

          if (!response.ok) {
            let detail = `试听失败 (${response.status})`;
            if (contentType.includes("application/json")) {
              const data = await response.json();
              if (data?.detail) {
                detail =
                  typeof data.detail === "string"
                    ? data.detail
                    : JSON.stringify(data.detail);
              }
            } else {
              const text = await response.text();
              if (text) detail = text.slice(0, 200);
            }
            throw new Error(detail);
          }

          if (!contentType.startsWith("audio/")) {
            throw new Error("试听接口未返回音频");
          }

          const blob = await response.blob();
          this.downloadName = buildTtsDownloadName(
            this.ttsParams,
            guessExt(contentType),
          );
          this.audioUrl = URL.createObjectURL(blob);
          this.audio = new Audio(this.audioUrl);
          await this.audio.play();
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "试听失败";
          this.showError(message);
        } finally {
          this.loading = false;
        }
      },
    },
    render(h: (...args: unknown[]) => unknown) {
      const isTextarea = this.inputRows > 1;
      return h(
        "div",
        {
          style: {
            display: "flex",
            gap: "8px",
            alignItems: isTextarea ? "flex-start" : "center",
            width: "100%",
          },
        },
        [
          h("el-input", {
            style: { flex: "1 1 auto" },
            props: {
              value: this.value,
              type: isTextarea ? "textarea" : "text",
              rows: this.inputRows,
              placeholder: this.placeholder,
              disabled: this.loading,
            },
            on: {
              input: (val: string) => {
                this.$emit("input", val);
              },
            },
          }),
          h(
            "el-button",
            {
              props: {
                type: "primary",
                loading: this.loading,
                disabled: !this.canPreview,
              },
              on: { click: this.handlePreview },
            },
            [this.btnText],
          ),
          h(
            "el-button",
            {
              props: {
                disabled: !this.canDownload,
              },
              on: { click: this.handleDownload },
            },
            [this.downloadBtnText],
          ),
        ],
      );
    },
  };
}

export function registerTtsPreviewWidget(Vue: AnyRecord | undefined): void {
  if (!Vue || Vue._ttsPreviewInstalled) return;
  Vue.component("TtsPreviewWidget", createTtsPreviewWidget());
  Vue._ttsPreviewInstalled = true;
}
