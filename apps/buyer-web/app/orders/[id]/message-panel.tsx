"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { MessageThread } from "@fasalx/types";
import { Badge, Button, Card, CardContent } from "@fasalx/ui";

import { markThreadReadAction, sendMessageAction } from "@/app/actions";

/**
 * Contacting the farmers on an order.
 *
 * One thread per farmer rather than a single room: an aggregated order has
 * four suppliers, and putting them in one conversation would tell each of
 * them who else is filling the order and — once prices come up — at what
 * price. That is the buyer's information to hold, not something the platform
 * should hand out as a side effect of a chat feature.
 *
 * Phone numbers appear here and nowhere else in the buyer app. Browsing
 * `/supply` shows twelve farmers and no contact details; an order with four
 * of them shows exactly those four.
 */
export function MessagePanel({
  orderId,
  threads: initial,
}: {
  orderId: string;
  threads: MessageThread[];
}) {
  const [threads, setThreads] = useState(initial);
  const [activeId, setActiveId] = useState(initial[0]?.farmerId ?? "");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);

  const active = threads.find((t) => t.farmerId === activeId) ?? threads[0];

  // Opening a thread counts as reading it.
  useEffect(() => {
    if (active && active.unread > 0) void markThreadReadAction(orderId, active.farmerId);
  }, [orderId, active]);

  useEffect(() => {
    if (active && active.messages.length > 0) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [active]);

  if (!active) return null;

  function send() {
    const body = draft.trim();
    if (!body || pending || !active) return;
    setError(null);
    startTransition(async () => {
      const result = await sendMessageAction(orderId, body, active.farmerId);
      if (!result.ok || !result.data) {
        setError(result.error ?? "Could not send that message");
        return;
      }
      setDraft("");
      setThreads(result.data);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="font-semibold">Contact suppliers</h2>
          <p className="text-sm text-muted-foreground">
            {threads.length === 1
              ? "The farmer supplying this order."
              : `${threads.length} farmers supplying this order. Each conversation is private.`}
          </p>
        </div>

        {threads.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {threads.map((thread) => (
              <button
                key={thread.farmerId}
                type="button"
                onClick={() => setActiveId(thread.farmerId)}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium ${
                  thread.farmerId === active.farmerId
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {thread.contact.name}
                {thread.unread > 0 ? (
                  <Badge variant="warning">{thread.unread}</Badge>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <div>
            <p className="font-medium">{active.contact.name}</p>
            <p className="text-sm text-muted-foreground">{active.contact.subtitle}</p>
          </div>
          <a
            href={`tel:+91${active.contact.phone}`}
            className="font-mono text-sm font-medium text-primary hover:underline"
          >
            📞 +91 {active.contact.phone}
          </a>
        </div>

        {active.messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Confirm pickup time, weighment or quality expectations.
          </p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {active.messages.map((message) => (
              <div
                key={message.id}
                className={message.mine ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    message.mine ? "bg-primary text-primary-foreground" : "border bg-muted/50"
                  }`}
                >
                  {message.body}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Message ${active.contact.name}…`}
            aria-label={`Message ${active.contact.name}`}
            className="h-10 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={pending || draft.trim().length === 0}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </form>

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
