import { useState, useEffect, useRef, useCallback } from "react";
import { Bot, X, Plus, Send, Trash2, MessageSquare, ChevronLeft, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useListAiConversations,
  useCreateAiConversation,
  useDeleteAiConversation,
  getListAiConversationsQueryKey,
  type AiConversation,
  type AiMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type ConversationWithMessages = AiConversation & { messages: AiMessage[] };

async function fetchConversation(id: number): Promise<ConversationWithMessages> {
  const res = await fetch(`${BASE_URL}/api/ai/conversations/${id}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Error cargando conversación");
  return res.json() as Promise<ConversationWithMessages>;
}

async function streamMessage(
  conversationId: number,
  content: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
) {
  const res = await fetch(`${BASE_URL}/api/ai/conversations/${conversationId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
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

function MessageBubble({ msg }: { msg: AiMessage | { role: string; content: string; id: number; streaming?: boolean } }) {
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

function ConversationList({
  conversations,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: AiConversation[];
  onSelect: (c: AiConversation) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="font-semibold text-sm">Conversaciones</span>
        <Button size="sm" variant="ghost" onClick={onNew} className="h-8 w-8 p-0">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm px-4">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>Sin conversaciones.<br />Crea una nueva para comenzar.</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {conversations.map((c) => (
              <div
                key={c.id}
                className="group flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                onClick={() => onSelect(c)}
              >
                <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm truncate flex-1">{c.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export function AiChat() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"list" | "chat">("list");
  const [activeConv, setActiveConv] = useState<ConversationWithMessages | null>(null);
  const [streamingMsg, setStreamingMsg] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  const { data: conversations = [] } = useListAiConversations();
  const createConv = useCreateAiConversation();
  const deleteConv = useDeleteAiConversation();

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(() => { if (streamingMsg !== null) scrollToBottom(); }, [streamingMsg, scrollToBottom]);
  useEffect(() => { if (view === "chat") scrollToBottom(); }, [view, activeConv?.messages?.length, scrollToBottom]);

  async function openConversation(c: AiConversation) {
    setLoadingConv(true);
    setError(null);
    try {
      const full = await fetchConversation(c.id);
      setActiveConv(full);
      setView("chat");
    } catch {
      setError("No se pudo cargar la conversación");
    } finally {
      setLoadingConv(false);
    }
  }

  async function handleNewConversation() {
    const title = `Chat ${new Date().toLocaleDateString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    createConv.mutate(
      { data: { title } },
      {
        onSuccess: (conv) => {
          queryClient.invalidateQueries({ queryKey: getListAiConversationsQueryKey() });
          setActiveConv({ ...conv, messages: [] });
          setView("chat");
          setTimeout(() => textareaRef.current?.focus(), 100);
        },
      }
    );
  }

  async function handleDelete(id: number) {
    deleteConv.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAiConversationsQueryKey() });
          if (activeConv?.id === id) { setActiveConv(null); setView("list"); }
        },
      }
    );
  }

  async function handleSend() {
    if (!inputValue.trim() || isSending || !activeConv) return;
    const content = inputValue.trim();
    setInputValue("");
    setIsSending(true);
    setError(null);

    const userMsg: AiMessage = {
      id: Date.now(),
      conversationId: activeConv.id,
      role: "user",
      content,
      creadoEn: new Date().toISOString(),
    };
    setActiveConv((prev) => prev ? { ...prev, messages: [...prev.messages, userMsg] } : prev);
    setStreamingMsg("");
    scrollToBottom();

    await streamMessage(
      activeConv.id,
      content,
      (chunk) => setStreamingMsg((prev) => (prev ?? "") + chunk),
      async () => {
        const updated = await fetchConversation(activeConv.id).catch(() => null);
        if (updated) setActiveConv(updated);
        setStreamingMsg(null);
        setIsSending(false);
        queryClient.invalidateQueries({ queryKey: getListAiConversationsQueryKey() });
      },
      (msg) => {
        setError(msg);
        setStreamingMsg(null);
        setIsSending(false);
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const allMessages = activeConv?.messages ?? [];

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
          open ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
        title="Asistente IA"
        aria-label="Asistente IA"
      >
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-8rem)] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b bg-card shrink-0">
            {view === "chat" && (
              <button
                onClick={() => { setView("list"); setError(null); }}
                className="p-1 rounded hover:bg-muted transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Asistente IA</p>
              {view === "chat" && activeConv && (
                <p className="text-xs text-muted-foreground truncate">{activeConv.title}</p>
              )}
            </div>
            {view === "chat" && activeConv && (
              <button
                onClick={() => handleDelete(activeConv.id)}
                className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground"
                title="Eliminar conversación"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            {view === "list" ? (
              loadingConv ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <ConversationList
                  conversations={conversations}
                  onSelect={openConversation}
                  onNew={handleNewConversation}
                  onDelete={handleDelete}
                />
              )
            ) : (
              <div className="flex flex-col h-full">
                <ScrollArea className="flex-1">
                  <div className="px-4 py-3">
                    {allMessages.length === 0 && streamingMsg === null && (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <Bot className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">¿En qué puedo ayudarte?</p>
                        <p className="text-xs mt-1 opacity-70">Pregúntame sobre tus cobros, clientes o montos recaudados.</p>
                      </div>
                    )}
                    {allMessages.map((msg) => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ))}
                    {streamingMsg !== null && (
                      <MessageBubble
                        msg={{ id: -1, conversationId: activeConv!.id, role: "assistant", content: streamingMsg, creadoEn: "", streaming: true }}
                      />
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
                    Llama 3.3 70B · Shift+Enter para nueva línea
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
