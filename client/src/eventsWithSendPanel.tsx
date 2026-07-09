import {
  Button,
  EventsPanel,
  Panel,
  PanelContent,
  PanelHeader,
  PanelTitle,
  Textarea,
  cn,
} from "@pipecat-ai/voice-ui-kit";
import { RTVIMessage } from "@pipecat-ai/client-js";
import {
  usePipecatClient,
  usePipecatClientTransportState,
} from "@pipecat-ai/client-react";
import { Send } from "lucide-react";
import { useCallback, useState } from "react";

const DEFAULT_MESSAGE = `{
  "label": "rtvi-ai",
  "type": "client-message",
  "id": "",
  "data": {
    "t": "ping",
    "d": { "hello": "world" }
  }
}`;

export interface EventsWithSendPanelProps {
  collapsed?: boolean;
}

export function EventsWithSendPanel({
  collapsed = false,
}: EventsWithSendPanelProps) {
  const client = usePipecatClient();
  const transportState = usePipecatClientTransportState();
  const canSend =
    transportState === "ready" || transportState === "connected";

  const [draft, setDraft] = useState(DEFAULT_MESSAGE);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleSend = useCallback(() => {
    setError(null);
    setStatus(null);

    if (!client) {
      setError("Client not ready");
      return;
    }
    if (!canSend) {
      setError(`Cannot send while transport is "${transportState}"`);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError("Message must be a JSON object");
      return;
    }

    const msg = parsed as {
      type?: unknown;
      data?: unknown;
      id?: unknown;
    };

    if (typeof msg.type !== "string" || !msg.type) {
      setError('Missing required string field "type"');
      return;
    }

    const id =
      typeof msg.id === "string" && msg.id.trim()
        ? msg.id.trim()
        : crypto.randomUUID();

    try {
      const rtviMessage = new RTVIMessage(msg.type, msg.data ?? {}, id);
      client.transport.sendMessage(rtviMessage);
      setStatus(`Sent ${rtviMessage.type} (${rtviMessage.id})`);

      setDraft(
        JSON.stringify(
          {
            label: rtviMessage.label,
            type: rtviMessage.type,
            id: rtviMessage.id,
            data: rtviMessage.data,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  }, [canSend, client, draft, transportState]);

  if (collapsed) {
    return <EventsPanel collapsed />;
  }

  return (
    <div
      className="h-full min-h-0"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 38%)",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div className="min-w-0 min-h-0 overflow-hidden">
        <EventsPanel collapsed={false} />
      </div>

      <Panel
        className={cn(
          "h-full min-h-0 min-w-0 overflow-hidden rounded-none! border-l",
          "bg-background flex flex-col",
        )}
      >
        <PanelHeader className="gap-4 justify-between items-center bg-background shrink-0">
          <PanelTitle>Send Message</PanelTitle>
          <Button
            type="button"
            size="sm"
            disabled={!canSend}
            onClick={handleSend}
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </Button>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
              setStatus(null);
            }}
            spellCheck={false}
            className="flex-1 min-h-0 font-mono text-xs resize-none"
            style={{ minHeight: 0, height: "100%" }}
            placeholder={DEFAULT_MESSAGE}
          />
          {error ? (
            <p className="text-destructive text-xs leading-snug shrink-0">
              {error}
            </p>
          ) : null}
          {status ? (
            <p className="text-muted-foreground text-xs leading-snug shrink-0">
              {status}
            </p>
          ) : null}
          {!canSend ? (
            <p className="text-muted-foreground text-xs leading-snug shrink-0">
              Connect first to send messages (state: {transportState})
            </p>
          ) : null}
        </PanelContent>
      </Panel>
    </div>
  );
}
