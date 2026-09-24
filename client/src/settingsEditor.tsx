import { SpinLoader, cn } from "@pipecat-ai/voice-ui-kit";
import ElementUI from "element-ui";
import "element-ui/lib/theme-chalk/index.css";
import { useEffect, useRef, useState } from "react";
import Vue from "vue";
import VueForm from "@xiaoql/vue-json-schema-form";
import { basicAuthHeaders } from "./basicAuth";
import { registerTtsPreviewWidget, setTtsProviderSchema } from "./ttsPreviewWidget";

Vue.use(ElementUI);
registerTtsPreviewWidget(Vue);

export interface SettingsEditorProps {
  endpoint: string;
  onEndpointChange: (v: string) => void;
  settingsJson: string;
  onSettingsChange: (v: string) => void;
  jsonError: string | null;
  schemaUrl?: string;
  defaultsUrl?: string;
  /** embed 由宿主代码传入连接地址时，不在表单里显示。 */
  showEndpoint?: boolean;
  /** 传入时写入 settings.account_id，且不在表单展示。 */
  lockedAccountId?: string;
  /** 传入时整体替换 settings.agent，且不在表单展示。值为 JSON 对象字符串。 */
  lockedAgentJson?: string;
  /** embed.html 入口使用 agent 表单主题。 */
  agentTheme?: boolean;
}

const UNHIDE_FIELDS = ["account_id", "agent_id"];

function unhideFields(obj: any, parentKey: string): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => unhideFields(item, parentKey));
  }
  const result: Record<string, any> = {};
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (
      key === "ui:widget" &&
      obj[key] === "HiddenWidget" &&
      UNHIDE_FIELDS.indexOf(parentKey) !== -1
    ) {
      continue;
    }
    if (key === "properties") {
      const props: Record<string, any> = {};
      for (const pk in obj[key]) {
        if (Object.prototype.hasOwnProperty.call(obj[key], pk)) {
          props[pk] = unhideFields(obj[key][pk], pk);
        }
      }
      result[key] = props;
    } else {
      result[key] = unhideFields(obj[key], parentKey);
    }
  }
  return result;
}

function tryParse(json: string): unknown | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseLockedAgent(json: string | undefined): { value?: unknown; error?: string } {
  if (json === undefined) return {};
  const parsed = tryParse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "Agent服务提供商配置不是合法 JSON 对象" };
  }
  return { value: parsed };
}

/** 宿主代码锁定的字段覆盖表单数据，保证保存和连接都带上这些值。 */
function applyHostConfig(
  data: unknown,
  accountId: string | undefined,
  agent: unknown | undefined,
): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const next: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  if (accountId !== undefined) next.account_id = accountId;
  if (agent !== undefined) next.agent = deepClone(agent);
  return next;
}

function deepClone<T>(value: T): T {
  return value === undefined
    ? value
    : (JSON.parse(JSON.stringify(value)) as T);
}

/** Match a oneOf/anyOf branch by const discriminator fields (e.g. name). */
function matchOptionIndex(data: unknown, options: any[]): number {
  if (!Array.isArray(options) || options.length === 0) return 0;
  if (!data || typeof data !== "object" || Array.isArray(data)) return 0;

  const record = data as Record<string, unknown>;
  for (let i = 0; i < options.length; i++) {
    const props = options[i]?.properties;
    if (!props || typeof props !== "object") continue;

    let hasConst = false;
    let matches = true;
    for (const key of Object.keys(props)) {
      const prop = props[key];
      if (!prop || typeof prop !== "object" || !("const" in prop)) continue;
      hasConst = true;
      if (record[key] !== prop.const) {
        matches = false;
        break;
      }
    }
    if (hasConst && matches) return i;
  }
  return 0;
}

/** Build form defaults for a single schema option (no merge with prior formData). */
function buildDefaultsFromOption(optionSchema: any): Record<string, unknown> {
  if (!optionSchema || typeof optionSchema !== "object") return {};

  const options = optionSchema.oneOf || optionSchema.anyOf;
  if (Array.isArray(options) && options.length > 0) {
    const idx =
      optionSchema.default !== undefined
        ? matchOptionIndex(optionSchema.default, options)
        : 0;
    return buildDefaultsFromOption(options[idx]);
  }

  const result: Record<string, unknown> = {};
  if (
    optionSchema.default !== undefined &&
    typeof optionSchema.default === "object" &&
    !Array.isArray(optionSchema.default)
  ) {
    Object.assign(result, deepClone(optionSchema.default));
  }

  const props = optionSchema.properties;
  if (!props || typeof props !== "object") {
    return result;
  }

  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (!prop || typeof prop !== "object") continue;

    if ("const" in prop) {
      result[key] = prop.const;
    } else if ("default" in prop) {
      result[key] = deepClone(prop.default);
    } else if (prop.oneOf || prop.anyOf || prop.properties) {
      result[key] = buildDefaultsFromOption(prop);
    }
  }
  return result;
}

/**
 * vue-json-schema-form keeps same-named keys when switching oneOf/anyOf
 * (only const discriminators are overwritten). Reset the whole branch to the
 * newly selected option's defaults so fields like voice / speech_rate update.
 */
function applyOneOfSwitchDefaults(
  schema: any,
  prev: unknown,
  next: unknown,
): unknown {
  if (!schema || typeof schema !== "object") return next;

  const options = schema.oneOf || schema.anyOf;
  if (Array.isArray(options) && options.length > 0) {
    if (prev === undefined || prev === null) return next;
    const prevIdx = matchOptionIndex(prev, options);
    const nextIdx = matchOptionIndex(next, options);
    if (prevIdx !== nextIdx) {
      return buildDefaultsFromOption(options[nextIdx]);
    }
    return applyOneOfSwitchDefaults(options[nextIdx], prev, next);
  }

  if (
    schema.properties &&
    next &&
    typeof next === "object" &&
    !Array.isArray(next)
  ) {
    const prevObj =
      prev && typeof prev === "object" && !Array.isArray(prev)
        ? (prev as Record<string, unknown>)
        : undefined;
    const nextObj = next as Record<string, unknown>;
    const result: Record<string, unknown> = { ...nextObj };
    let changed = false;

    for (const key of Object.keys(schema.properties)) {
      const fixed = applyOneOfSwitchDefaults(
        schema.properties[key],
        prevObj?.[key],
        nextObj[key],
      );
      if (fixed !== nextObj[key]) {
        result[key] = fixed;
        changed = true;
      }
    }
    return changed ? result : next;
  }

  return next;
}

export function SettingsEditor({
  endpoint,
  onEndpointChange,
  settingsJson,
  onSettingsChange,
  jsonError,
  schemaUrl = "/bot/settings/_schema",
  defaultsUrl = "/client/_settings",
  showEndpoint = true,
  lockedAccountId,
  lockedAgentJson,
  agentTheme = false,
}: SettingsEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const vueInstanceRef = useRef<any>(null);
  const propsRef = useRef({ onSettingsChange });
  const lastEmittedJsonRef = useRef<string | null>(null);
  const defaultSettingsJsonRef = useRef<string | null>(null);

  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const lockedAccountIdRef = useRef(lockedAccountId);
  const lockedAgentRef = useRef<unknown>(undefined);
  const lockedAgentParsed = parseLockedAgent(lockedAgentJson);
  lockedAccountIdRef.current = lockedAccountId;
  lockedAgentRef.current = lockedAgentParsed.value;

  const toSettingsJson = (data: unknown) =>
    JSON.stringify(
      applyHostConfig(data, lockedAccountIdRef.current, lockedAgentRef.current),
      null,
      2,
    );

  useEffect(() => {
    propsRef.current.onSettingsChange = onSettingsChange;
  }, [onSettingsChange]);

  useEffect(() => {
    let cancelled = false;

    setStatus("loading");
    setErrorMessage(null);

    if (lockedAgentParsed.error) {
      setErrorMessage(lockedAgentParsed.error);
      setStatus("error");
      return;
    }

    (async () => {
      try {
        const [schemaRes, defaultsRes] = await Promise.all([
          fetch(schemaUrl, { headers: basicAuthHeaders() }).then((r) => {
            if (!r.ok) throw new Error(`schema HTTP ${r.status}`);
            return r.json();
          }),
          fetch(defaultsUrl, { headers: basicAuthHeaders() }).then((r) => {
            if (!r.ok) throw new Error(`defaults HTTP ${r.status}`);
            return r.json();
          }),
        ]);
        if (cancelled) return;

        if (!defaultsRes || typeof defaultsRes !== "object") {
          throw new Error("invalid defaults from server");
        }

        const schema = unhideFields(schemaRes, "");
        if (
          lockedAccountIdRef.current !== undefined &&
          schema?.properties?.account_id
        ) {
          schema.properties.account_id["ui:widget"] = "HiddenWidget";
        }
        if (lockedAgentRef.current !== undefined && schema?.properties) {
          delete schema.properties.agent;
        }
        if (agentTheme) {
          schema["ui:theme"] = "agent";
        }
        setTtsProviderSchema(schema?.properties?.tts?.properties?.provider);
        const defaultSerialized = JSON.stringify(defaultsRes, null, 2);
        defaultSettingsJsonRef.current = defaultSerialized;

        let initialFormData: any = tryParse(settingsJson);
        if (initialFormData === null) {
          initialFormData = defaultsRes;
        }
        const initialSerialized = toSettingsJson(initialFormData);
        if (lastEmittedJsonRef.current !== initialSerialized) {
          lastEmittedJsonRef.current = initialSerialized;
          propsRef.current.onSettingsChange(initialSerialized);
        }
        initialFormData = applyHostConfig(
          initialFormData,
          lockedAccountIdRef.current,
          lockedAgentRef.current,
        );

        if (!hostRef.current) return;

        const mountPoint = document.createElement("div");
        hostRef.current.innerHTML = "";
        hostRef.current.appendChild(mountPoint);

        // VJSF mutates formData in place on oneOf switch; keep an independent
        // snapshot so we can detect discriminator changes and apply new defaults.
        let prevFormDataSnapshot = deepClone(initialFormData);

        const instance = new Vue({
          el: mountPoint,
          data: {
            formData: initialFormData,
            schema,
          },
          render(h: any) {
            return h(VueForm, {
              props: {
                value: this.formData,
                schema: this.schema,
                formProps: {
                  labelPosition: "right",
                  labelWidth: "140px",
                  labelSuffix: "：",
                },
                formFooter: { show: false },
              },
              on: {
                input: (v: any) => {
                  const fixed = applyOneOfSwitchDefaults(
                    schema,
                    prevFormDataSnapshot,
                    v,
                  );
                  prevFormDataSnapshot = deepClone(fixed);
                  this.formData = fixed;
                  const serialized = toSettingsJson(fixed);
                  lastEmittedJsonRef.current = serialized;
                  propsRef.current.onSettingsChange(serialized);
                },
              },
            });
          },
        });

        // Expose snapshot updater for external settingsJson sync / Reset.
        (instance as any).__setPrevFormDataSnapshot = (data: unknown) => {
          prevFormDataSnapshot = deepClone(data);
        };

        vueInstanceRef.current = instance;
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setErrorMessage((e as Error).message || String(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (vueInstanceRef.current) {
        try {
          vueInstanceRef.current.$destroy();
        } catch {
          /* noop */
        }
        vueInstanceRef.current = null;
      }
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
      }
    };
  }, [schemaUrl, defaultsUrl, lockedAccountId, lockedAgentJson, agentTheme]);

  useEffect(() => {
    const instance = vueInstanceRef.current;
    if (!instance) return;
    if (lastEmittedJsonRef.current === settingsJson) return;

    const parsed = tryParse(settingsJson);
    if (parsed === null || typeof parsed !== "object") return;

    const locked = applyHostConfig(
      parsed,
      lockedAccountIdRef.current,
      lockedAgentRef.current,
    );
    const serialized = JSON.stringify(locked, null, 2);
    lastEmittedJsonRef.current = serialized;
    instance.formData = locked;
    instance.__setPrevFormDataSnapshot?.(locked);
    if (serialized !== settingsJson) {
      propsRef.current.onSettingsChange(serialized);
    }
  }, [settingsJson]);

  return (
    <div className="flex flex-col gap-3 p-2 h-full overflow-auto text-xs">
      {showEndpoint ? (
        <div className="flex flex-col gap-1">
          <label className="font-medium text-muted-foreground uppercase tracking-wide">
            Connect Endpoint
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => onEndpointChange(e.target.value)}
            className="w-full font-mono border rounded px-2 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={new URL("/bot/connect", window.location.origin).href}
            spellCheck={false}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1 flex-1 min-h-0">
        

        {status === "loading" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground min-h-[200px]">
            <SpinLoader />
            <div>正在加载配置…</div>
          </div>
        ) : null}

        {status === "error" ? (
          <div
            className={cn(
              "flex-1 border rounded p-3 text-destructive bg-destructive/5",
              "min-h-[100px]",
            )}
          >
            加载设置失败：{errorMessage}
          </div>
        ) : null}

        <div
          ref={hostRef}
          className={cn(
            "vue-island flex-1 min-h-0 overflow-auto",
            status !== "ready" && "hidden",
          )}
        />

        {jsonError ? (
          <p className="text-destructive leading-snug">{jsonError}</p>
        ) : null}
      </div>
    </div>
  );
}
