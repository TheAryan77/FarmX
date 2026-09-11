"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ChatAnswer, ChatLanguage } from "@fasalx/types";
import { Button } from "@fasalx/ui";

import { askAssistantAction } from "@/app/actions";

/**
 * The assistant bubble.
 *
 * Two things shape it. First, it answers only from the signed-in person's own
 * rows — the API gathers them and the model is forbidden from using any number
 * that is not in them — so this component never has to guard against a
 * confidently wrong rupee figure appearing in it.
 *
 * Second, the language toggle is not a setting buried somewhere. A farmer in
 * Karnal reads Hindi; the toggle sits in the header where it can be changed
 * mid-conversation, and the next answer arrives in the new language.
 *
 * The panel is sized for a cheap Android phone held in one hand: it fills the
 * screen, the text is 17-18px, and the send target is comfortably past 44px.
 */

const COPY = {
  en: {
    title: "FasalX Assistant",
    subtitle: "Ask about your crop, price or payment",
    placeholder: "Type your question…",
    send: "Send",
    thinking: "Thinking…",
    open: "Open assistant",
    close: "Close",
    suggestions: ["My crop summary", "Should I sell now?", "When do I get paid?"],
    offline: "Offline summary — the assistant is over its daily limit.",
  },
  hi: {
    title: "FasalX सहायक",
    subtitle: "फसल, भाव या भुगतान के बारे में पूछें",
    placeholder: "अपना सवाल लिखें…",
    send: "भेजें",
    thinking: "सोच रहा हूँ…",
    open: "सहायक खोलें",
    close: "बंद करें",
    suggestions: ["मेरी फसल का सारांश", "क्या अभी बेचूँ?", "पैसा कब मिलेगा?"],
    offline: "ऑफ़लाइन सारांश — सहायक की दैनिक सीमा पूरी हो गई है।",
  },
} as const;

interface Turn {
  role: "you" | "assistant";
  text: string;
  offline?: boolean;
}

export function Assistant({ defaultLanguage = "hi" }: { defaultLanguage?: ChatLanguage }) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<ChatLanguage>(defaultLanguage);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const copy = COPY[language];
  const endRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  function send(question: string) {
    const text = question.trim();
    if (!text || pending) return;

    setError(null);
    setDraft("");
    setTurns((prev) => [...prev, { role: "you", text }]);

    startTransition(async () => {
      const result = await askAssistantAction(text, language);
      if (!result.ok || !result.data) {
        setError(result.error ?? "Could not get an answer");
        return;
      }
      const data: ChatAnswer = result.data;
      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: data.answer, offline: data.offline },
      ]);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={copy.open}
        className="fixed right-4 bottom-4 z-50 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:brightness-110 active:scale-95"
      >
        <span aria-hidden className="text-3xl">💬</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(36rem,85vh)] sm:w-[26rem] sm:rounded-xl sm:border sm:shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-lg font-semibold">{copy.title}</p>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Switchable mid-conversation; the next answer arrives translated. */}
          <div className="flex overflow-hidden rounded-md border text-sm">
            {(["hi", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLanguage(code)}
                aria-pressed={language === code}
                className={`px-2.5 py-1.5 font-medium ${
                  language === code
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {code === "hi" ? "हिं" : "EN"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={copy.close}
            className="flex size-9 items-center justify-center rounded-md text-xl text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="space-y-2">
            {copy.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="w-full rounded-lg border bg-muted/40 px-4 py-3 text-left text-base font-medium hover:bg-muted"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={turn.role === "you" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[17px] leading-relaxed whitespace-pre-line ${
                turn.role === "you"
                  ? "bg-primary text-primary-foreground"
                  : "border bg-muted/50"
              }`}
            >
              {turn.text}
              {turn.offline ? (
                <span className="mt-2 block text-xs text-muted-foreground">{copy.offline}</span>
              ) : null}
            </div>
          </div>
        ))}

        {pending ? (
          <p className="text-base text-muted-foreground">{copy.thinking}</p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-base font-medium text-destructive"
          >
            {error}
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      <form
        className="flex items-center gap-2 border-t px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          className="h-12 flex-1 rounded-md border bg-background px-3 text-[17px] outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" disabled={pending || draft.trim().length === 0} className="h-12 px-5">
          {copy.send}
        </Button>
      </form>
    </div>
  );
}
