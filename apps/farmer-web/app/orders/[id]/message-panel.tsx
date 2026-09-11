"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { MessageThread } from "@fasalx/types";
import { Button, Card, CardContent } from "@fasalx/ui";

import { markThreadReadAction, sendMessageAction } from "@/app/actions";

/**
 * Talking to the buyer, and calling them.
 *
 * The phone number is the point. A farmer with produce on a truck at 6am does
 * not want a chat thread — they want to ring the person who is coming to
 * collect it. So the call button is the largest thing here and the messages
 * sit underneath it, rather than the other way round.
 *
 * The number is only here because this farmer is supplying this order; the
 * API will not return a contact to anyone who is not already trading with
 * them.
 */
export function MessagePanel({
  orderId,
  thread: initial,
}: {
  orderId: string;
  thread: MessageThread;
}) {
  const [thread, setThread] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);

  // Opening the screen counts as reading what is on it.
  useEffect(() => {
    if (initial.unread > 0) void markThreadReadAction(orderId, initial.farmerId);
  }, [orderId, initial.farmerId, initial.unread]);

  useEffect(() => {
    if (thread.messages.length > 0) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [thread.messages.length]);

  function send() {
    const body = draft.trim();
    if (!body || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await sendMessageAction(orderId, body);
      if (!result.ok || !result.data?.[0]) {
        setError(result.error ?? "Could not send that message");
        return;
      }
      setDraft("");
      setThread(result.data[0]);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <p className="text-lg font-semibold">Buyer contact</p>
          <p className="text-base text-muted-foreground">
            {thread.contact.subtitle} · {thread.contact.name}
          </p>
        </div>

        {/* Tap to dial. The single most useful control on this screen. */}
        <a
          href={`tel:+91${thread.contact.phone}`}
          className="flex h-14 items-center justify-center gap-2 rounded-lg bg-primary text-lg font-semibold text-primary-foreground"
        >
          <span aria-hidden>📞</span> Call +91 {thread.contact.phone}
        </a>

        <div className="space-y-2">
          <p className="font-medium">Messages</p>
          {thread.messages.length === 0 ? (
            <p className="text-base text-muted-foreground">
              No messages yet. Ask about pickup time, weighment or payment.
            </p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {thread.messages.map((message) => (
                <div
                  key={message.id}
                  className={message.mine ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[17px] leading-relaxed ${
                      message.mine
                        ? "bg-primary text-primary-foreground"
                        : "border bg-muted/50"
                    }`}
                  >
                    {message.body}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

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
            placeholder="Write a message…"
            aria-label="Write a message"
            className="h-14 flex-1 rounded-md border bg-background px-3 text-[17px] outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" disabled={pending || draft.trim().length === 0} className="h-14 px-5">
            {pending ? "Sending…" : "Send"}
          </Button>
        </form>

        {error ? (
          <p role="alert" className="text-base font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
