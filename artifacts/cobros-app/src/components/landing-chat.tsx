import { useState, useRef, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

const MORADO = "#6C5CE7";
const AMARILLO = "#FFD166";

type LocalMessage = { id: number; role: "user" | "assistant"; content: string };

const SUGERENCIAS = [
  "¿Cómo funciona?",
  "¿Cuánto cuesta?",
  "¿Es seguro?",
  "¿Cómo empiezo la prueba gratis?",
];

async function streamChat(
  messages: LocalMessage[],
  content: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void,
) {
  const res = await fetch(`${BASE_URL}/api/public/landing-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      content,
    }),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    onError(json.error ?? "Error al enviar el mensaje");
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError("Sin respuesta del servidor");
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const payload = JSON.parse(line.slice(6)) as { content?: string; done?: boolean; error?: string };
        if (payload.error) {
          onError(payload.error);
          return;
        }
        if (payload.content) onChunk(payload.content);
        if (payload.done) {
          onDone();
          return;
        }
      } catch {
        /* ignore parse errors */
      }
    }
  }
  onDone();
}

function MessageBubble({ msg }: { msg: { id: number; role: string; content: string } }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div
          className="h-7 w-7 rounded-full flex items-center justify-center text-white shrink-0 mr-2 mt-0.5"
          style={{ backgroundColor: MORADO }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser ? "text-white rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
        }`}
        style={isUser ? { backgroundColor: MORADO } : undefined}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1.5 [&>ul]:mb-1.5 [&>ol]:mb-1.5 [&_a]:text-[var(--morado)]">
            <ReactMarkdown>{msg.content || "▋"}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function LandingChat() {
  const { login } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || isSending) return;
    setInputValue("");
    setIsSending(true);
    setError(null);

    const userMsg: LocalMessage = { id: Date.now(), role: "user", content };
    const historial = messages;
    setMessages((prev) => [...prev, userMsg]);
    setStreamingContent("");
    scrollToBottom();

    let accumulated = "";
    await streamChat(
      historial,
      content,
      (chunk) => {
        accumulated += chunk;
        setStreamingContent(accumulated);
        scrollToBottom();
      },
      () => {
        const assistantMsg: LocalMessage = { id: Date.now() + 1, role: "assistant", content: accumulated };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent(null);
        setIsSending(false);
        scrollToBottom();
      },
      (msg) => {
        setError(msg);
        setStreamingContent(null);
        setIsSending(false);
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(inputValue);
    }
  };

  return (
    <div style={{ ["--morado" as string]: MORADO }}>
      {/* Floating button — bottom-right */}
      <button
        onClick={() => (open ? setOpen(false) : handleOpen())}
        className="fixed bottom-24 right-6 z-50 h-14 w-14 rounded-full shadow-lg flex items-center justify-center text-white transition-all duration-200 hover:scale-105"
        style={{ backgroundColor: open ? "#4b3fb0" : MORADO }}
        title="¿Dudas? Pregúntale a nuestro asistente"
        aria-label="Abrir chat de ayuda"
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : (
          <span className="relative">
            <MessageCircle className="h-6 w-6" />
            <span
              className="absolute -top-2 -right-2 h-3 w-3 rounded-full border-2 border-white"
              style={{ backgroundColor: AMARILLO }}
            />
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-44 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[540px] max-h-[calc(100vh-13rem)] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 shrink-0 text-white" style={{ backgroundColor: MORADO }}>
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: AMARILLO, color: "#1a1a2e" }}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Asistente Cobro Simple</p>
              <p className="text-xs text-white/80">Resolvemos tus dudas al instante</p>
            </div>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="px-4 py-3">
              {messages.length === 0 && streamingContent === null && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <div
                    className="h-12 w-12 mx-auto mb-3 rounded-full flex items-center justify-center text-white"
                    style={{ backgroundColor: MORADO }}
                  >
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <p className="font-medium text-foreground">¡Hola! 👋 ¿En qué te ayudo?</p>
                  <p className="text-xs mt-1 opacity-80">
                    Pregúntame sobre Cobro Simple: precios, funciones, seguridad o cómo empezar tu prueba gratis.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    {SUGERENCIAS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {streamingContent !== null && (
                <MessageBubble msg={{ id: -1, role: "assistant", content: streamingContent }} />
              )}
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mt-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* CTA */}
          <button
            onClick={login}
            className="mx-3 mb-2 mt-1 shrink-0 rounded-lg py-2 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: AMARILLO, color: "#1a1a2e" }}
          >
            Comenzar prueba gratis de 14 días
          </button>

          {/* Input */}
          <div className="border-t px-3 py-2.5 shrink-0">
            <div className="flex gap-2 items-end">
              <Textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe tu pregunta… (Enter para enviar)"
                className="resize-none min-h-[42px] max-h-[120px] text-sm leading-relaxed"
                rows={1}
                disabled={isSending}
              />
              <Button
                size="icon"
                onClick={() => send(inputValue)}
                disabled={!inputValue.trim() || isSending}
                className="shrink-0 h-10 w-10 text-white hover:opacity-90"
                style={{ backgroundColor: MORADO }}
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              Respuestas generadas por IA · pueden contener imprecisiones
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
