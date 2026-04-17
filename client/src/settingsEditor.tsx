import { cn } from "@pipecat-ai/voice-ui-kit";
import { RotateCcw } from "lucide-react";

export interface SettingsEditorProps {
  endpoint: string;
  onEndpointChange: (v: string) => void;
  settingsJson: string;
  onSettingsChange: (v: string) => void;
  jsonError: string | null;
  defaultSettingsJson: string;
}

export function SettingsEditor({
  endpoint,
  onEndpointChange,
  settingsJson,
  onSettingsChange,
  jsonError,
  defaultSettingsJson,
}: SettingsEditorProps) {
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
          placeholder="http://localhost:8080/bot/connect"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <label className="font-medium text-muted-foreground uppercase tracking-wide">
            Client Settings (JSON)
          </label>
          <button
            type="button"
            title="Reset to defaults"
            onClick={() => onSettingsChange(defaultSettingsJson)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>
        <textarea
          value={settingsJson}
          onChange={(e) => onSettingsChange(e.target.value)}
          className={cn(
            "flex-1 w-full font-mono border rounded px-2 py-1.5 bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring",
            "min-h-[320px]",
            jsonError && "border-destructive focus:ring-destructive",
          )}
          spellCheck={false}
        />
        {jsonError && (
          <p className="text-destructive leading-snug">{jsonError}</p>
        )}
      </div>
    </div>
  );
}
