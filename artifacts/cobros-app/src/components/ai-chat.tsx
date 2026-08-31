import { useState, useRef, useCallback } from "react";
import { Bot, X, Send, Loader2, AlertCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type LocalMessage = { id: number; role: "user" | "assistant"; content: string };

async function streamChat(
  messages: LocalMessage[],
  content: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
) {
  const res = await fetch(`${BASE_URL}/api/ai/chat`, {
    method: "POST",
    credentials: "include",
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
  if (!reader) { onError("Sin respuesta del servidor"); return; }
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
        if (payload.error) { onError(payload.error); return; }
        if (payload.content) onChunk(payload.content);
        if (payload.done) { onDone(); return; }
      } catch { /* ignore parse errors */ }
    }
  }
  onDone();
}

function MessageBubble({ msg }: { msg: LocalMessage | { id: number; role: string; content: string } }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0 mr-2 mt-0.5">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1.5 [&>ul]:mb-1.5 [&>ol]:mb-1.5">
            <ReactMarkdown>{msg.content || "▋"}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function AiChat() {
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

  const handleClose = () => setOpen(false);

  const handleNewChat = () => {
    setMessages([]);
    setStreamingContent(null);
    setError(null);
    setInputValue("");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;
    const content = inputValue.trim();
    setInputValue("");
    setIsSending(true);
    setError(null);

    const userMsg: LocalMessage = { id: Date.now(), role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setStreamingContent("");
    scrollToBottom();

    let accumulated = "";
    await streamChat(
      messages,
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
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating button — bottom-right and raised to clear the Replit feedback button */}
      <button
        onClick={() => (open ? handleClose() : handleOpen())}
        className={`fixed bottom-4 right-4 z-50 h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
        title="Abrir chat con Diana"
        aria-label="Abrir chat con Diana"
      >
        {open ? <X className="h-6 w-6" /> : <span className="text-lg font-bold">D</span>}
      </button>

      {/* Chat panel — anchored bottom-right */}
      {open && (
        <div className="fixed bottom-24 right-4 z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[520px] max-h-[calc(100vh-8rem)] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-card shrink-0">
            <div className="h-8 w-8 rounded-full bg-black flex items-center justify-center text-[#F2A900] font-bold">
              D
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Diana · Asistente NextCob</p>
              <p className="text-xs text-muted-foreground">Experta en cobranza y finanzas</p>
            </div>
            <button
              onClick={handleNewChat}
              className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
              title="Nueva conversación"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1">
            <div className="px-4 py-3">
              {messages.length === 0 && streamingContent === null && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <div className="h-12 w-12 mx-auto mb-3 rounded-full bg-black flex items-center justify-center text-[#F2A900] text-xl font-bold">
                    D
                  </div>
                  <p className="font-medium text-foreground">Hola, soy Diana, tu asistente de NextCob.</p>
                  <p className="text-xs mt-2 opacity-80 leading-relaxed">
                    Puedo ayudarte a analizar tu cartera, identificar clientes prioritarios y responder cualquier pregunta sobre tu cobranza.
                  </p>
                </div>
              )}
              {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
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
                onClick={handleSend}
                disabled={!inputValue.trim() || isSending}
                className="shrink-0 h-10 w-10"
              >
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              Shift+Enter para nueva línea · conversación local sin historial
            </p>
          </div>
        </div>
      )}
    </>
  );
}
