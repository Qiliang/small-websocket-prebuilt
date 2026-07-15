import { SpinLoader, cn } from "@pipecat-ai/voice-ui-kit";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface SettingsEditorProps {
  endpoint: string;
  onEndpointChange: (v: string) => void;
  settingsJson: string;
  onSettingsChange: (v: string) => void;
  jsonError: string | null;
  schemaUrl?: string;
  defaultsUrl?: string;
}

const CDN = {
  vueJs: "https://cdn.jsdelivr.net/npm/vue@2.7.16/dist/vue.min.js",
  elUiJs: "https://cdn.jsdelivr.net/npm/element-ui@2.15.14/lib/index.js",
  elUiCss:
    "https://cdn.jsdelivr.net/npm/element-ui@2.15.14/lib/theme-chalk/index.css",
  vjsfJs:
    "https://cdn.jsdelivr.net/npm/@lljj/vue-json-schema-form@1.19.0/dist/vueJsonSchemaForm.umd.min.js",
};

declare global {
  interface Window {
    Vue?: any;
    ELEMENT?: any;
    vueJsonSchemaForm?: any;
  }
}

let loadPromise: Promise<void> | null = null;

function injectStylesheet(href: string): void {
  if (document.querySelector(`link[data-vue-island="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-vue-island", href);
  document.head.appendChild(link);
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[data-vue-island="${src}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error(`Failed to load ${src}`)),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.setAttribute("data-vue-island", src);
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () =>
      reject(new Error(`Failed to load ${src}`)),
    );
    document.head.appendChild(script);
  });
}

function ensureVueLibs(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    injectStylesheet(CDN.elUiCss);
    await injectScript(CDN.vueJs);
    await injectScript(CDN.elUiJs);
    await injectScript(CDN.vjsfJs);
    if (!window.Vue || !window.ELEMENT || !window.vueJsonSchemaForm) {
      throw new Error("Vue / ElementUI / vueJsonSchemaForm failed to load");
    }
    if (!(window.Vue as any)._elementInstalled) {
      window.Vue.use(window.ELEMENT);
      (window.Vue as any)._elementInstalled = true;
    }
  })();
  return loadPromise;
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

  useEffect(() => {
    propsRef.current.onSettingsChange = onSettingsChange;
  }, [onSettingsChange]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await ensureVueLibs();
        if (cancelled) return;

        const [schemaRes, defaultsRes] = await Promise.all([
          fetch(schemaUrl).then((r) => {
            if (!r.ok) throw new Error(`schema HTTP ${r.status}`);
            return r.json();
          }),
          fetch(defaultsUrl).then((r) => {
            if (!r.ok) throw new Error(`defaults HTTP ${r.status}`);
            return r.json();
          }),
        ]);
        if (cancelled) return;

        if (!defaultsRes || typeof defaultsRes !== "object") {
          throw new Error("invalid defaults from server");
        }

        const schema = unhideFields(schemaRes, "");
        const defaultSerialized = JSON.stringify(defaultsRes, null, 2);
        defaultSettingsJsonRef.current = defaultSerialized;

        let initialFormData: any = tryParse(settingsJson);
        if (initialFormData === null) {
          initialFormData = defaultsRes;
          lastEmittedJsonRef.current = defaultSerialized;
          propsRef.current.onSettingsChange(defaultSerialized);
        }

        if (!hostRef.current) return;

        const Vue = window.Vue;
        const VueForm = window.vueJsonSchemaForm.default;

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
                  const serialized = JSON.stringify(fixed, null, 2);
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
  }, [schemaUrl, defaultsUrl]);

  useEffect(() => {
    const instance = vueInstanceRef.current;
    if (!instance) return;
    if (lastEmittedJsonRef.current === settingsJson) return;

    const parsed = tryParse(settingsJson);
    if (parsed === null || typeof parsed !== "object") return;

    lastEmittedJsonRef.current = settingsJson;
    instance.formData = parsed;
    instance.__setPrevFormDataSnapshot?.(parsed);
  }, [settingsJson]);

  const handleReset = () => {
    if (defaultSettingsJsonRef.current) {
      onSettingsChange(defaultSettingsJsonRef.current);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-2 h-full overflow-auto text-xs">
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

      <div className="flex flex-col gap-1 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <label className="font-medium text-muted-foreground uppercase tracking-wide">
            Client Settings
          </label>
          <button
            type="button"
            title="Reset to defaults"
            onClick={handleReset}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>

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
