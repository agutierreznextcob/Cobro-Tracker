import { Router } from "express";
import Groq from "groq-sdk";
import { db, conversationsTable, messagesTable, cobrosTable, clientesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { requireSubscription } from "../middlewares/requireSubscription";

const aiRouter = Router();

aiRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});
aiRouter.use(requireSubscription);

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY no configurado");
  return new Groq({ apiKey });
}

const ConversationInputSchema = z.object({
  title: z.string().min(1).max(200),
});

const MessageInputSchema = z.object({
  content: z.string().min(1).max(10000),
});

async function buildUserContext(userId: string): Promise<string> {
  const [cobros, clientes] = await Promise.all([
    db
      .select()
      .from(cobrosTable)
      .where(eq(cobrosTable.responsableId, userId))
      .orderBy(desc(cobrosTable.creadoEn))
      .limit(150),
    db
      .select()
      .from(clientesTable)
      .where(eq(clientesTable.userId, userId))
      .orderBy(desc(clientesTable.creadoEn)),
  ]);

  const resumen = {
    total: cobros.length,
    pendiente: cobros.filter((c) => c.estado === "pendiente"),
    pagado: cobros.filter((c) => c.estado === "pagado"),
    fallido: cobros.filter((c) => c.estado === "fallido"),
    cancelado: cobros.filter((c) => c.estado === "cancelado"),
  };

  const montoPagado = resumen.pagado.reduce((s, c) => s + Number(c.monto), 0);
  const montoPendiente = resumen.pendiente.reduce((s, c) => s + Number(c.monto), 0);

  const formatCLP = (n: number) =>
    new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n);

  const cobrosLines = cobros.slice(0, 100).map((c) => {
    const fecha = c.creadoEn.toISOString().split("T")[0];
    const cliente = c.clienteNombre || c.emailPagador || "Sin cliente";
    return `  - ID:${c.id} | ${fecha} | ${c.estado.toUpperCase()} | ${formatCLP(Number(c.monto))} | "${c.descripcion}" | Cliente: ${cliente}`;
  });

  const clientesLines = clientes.map(
    (cl) => `  - ID:${cl.id} | ${cl.nombre}${cl.rut ? ` (RUT: ${cl.rut})` : ""}${cl.email ? ` | ${cl.email}` : ""}`
  );

  return `## Contexto del usuario

### Resumen de cobros
- Total de cobros: ${resumen.total}
- Pagados: ${resumen.pagado.length} — Monto recaudado: ${formatCLP(montoPagado)}
- Pendientes: ${resumen.pendiente.length} — Monto pendiente: ${formatCLP(montoPendiente)}
- Fallidos: ${resumen.fallido.length}
- Cancelados: ${resumen.cancelado.length}

### Cobros recientes (últimos ${cobrosLines.length})
${cobrosLines.join("\n") || "  (sin cobros)"}

### Clientes registrados (${clientes.length})
${clientesLines.join("\n") || "  (sin clientes)"}`;
}

const SYSTEM_BASE = `Eres un asistente de gestión de cobros integrado en la plataforma "Cobros App".
Tu rol es ayudar al usuario a entender el estado de sus cobros, responder preguntas sobre montos recaudados, cobros pendientes, información de clientes y generar resúmenes.

Reglas importantes:
- Responde siempre en español, de forma concisa y directa.
- Usa el contexto de datos proporcionado para responder preguntas específicas.
- Si el usuario pregunta algo que no está en el contexto, dilo claramente.
- Puedes hacer cálculos sobre los datos (sumas, promedios, filtros por fecha, etc.).
- Formato: usa markdown simple cuando sea útil (listas, negritas). Evita tablas largas.
- Los montos son en pesos chilenos (CLP).
- Las fechas están en formato YYYY-MM-DD.
- El estado de cobros puede ser: pendiente, pagado, fallido, cancelado.`;

// GET /ai/conversations
aiRouter.get("/ai/conversations", async (req, res) => {
  const userId = req.user!.id;
  try {
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.userId, userId))
      .orderBy(desc(conversationsTable.actualizadoEn));
    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        creadoEn: r.creadoEn.toISOString(),
        actualizadoEn: r.actualizadoEn.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error listing conversations");
    res.status(500).json({ error: "Error interno" });
  }
});

// POST /ai/conversations
aiRouter.post("/ai/conversations", async (req, res) => {
  const userId = req.user!.id;
  const parsed = ConversationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [conv] = await db
      .insert(conversationsTable)
      .values({ userId, title: parsed.data.title })
      .returning();
    res.status(201).json({
      id: conv.id,
      title: conv.title,
      creadoEn: conv.creadoEn.toISOString(),
      actualizadoEn: conv.actualizadoEn.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating conversation");
    res.status(500).json({ error: "Error interno" });
  }
});

// GET /ai/conversations/:id
aiRouter.get("/ai/conversations/:id", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)));
    if (!conv) {
      res.status(404).json({ error: "Conversación no encontrada" });
      return;
    }
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, id))
      .orderBy(messagesTable.creadoEn);
    res.json({
      id: conv.id,
      title: conv.title,
      creadoEn: conv.creadoEn.toISOString(),
      messages: msgs.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        creadoEn: m.creadoEn.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting conversation");
    res.status(500).json({ error: "Error interno" });
  }
});

// DELETE /ai/conversations/:id
aiRouter.delete("/ai/conversations/:id", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)));
    if (!conv) {
      res.status(404).json({ error: "Conversación no encontrada" });
      return;
    }
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Error deleting conversation");
    res.status(500).json({ error: "Error interno" });
  }
});

// POST /ai/conversations/:id/messages  — SSE streaming
aiRouter.post("/ai/conversations/:id/messages", async (req, res) => {
  const userId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const parsed = MessageInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userContent = parsed.data.content;

  try {
    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.id, id), eq(conversationsTable.userId, userId)));
    if (!conv) {
      res.status(404).json({ error: "Conversación no encontrada" });
      return;
    }

    // Save user message
    await db.insert(messagesTable).values({ conversationId: id, role: "user", content: userContent });

    // Load full history + fresh context
    const [history, userContext] = await Promise.all([
      db.select().from(messagesTable).where(eq(messagesTable.conversationId, id)).orderBy(messagesTable.creadoEn),
      buildUserContext(userId),
    ]);

    const systemPrompt = `${SYSTEM_BASE}\n\n${userContext}\n\n---\nFecha y hora actual: ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}`;

    const chatMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Stream SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let fullResponse = "";

    try {
      const groq = getGroqClient();
      const stream = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        max_tokens: 2048,
        messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          fullResponse += delta;
          res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
        }
      }
    } catch (groqErr) {
      req.log.error({ groqErr }, "Groq streaming error");
      res.write(`data: ${JSON.stringify({ error: "Error al comunicarse con el modelo de IA" })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // Save assistant response & update conversation timestamp
    await Promise.all([
      db.insert(messagesTable).values({ conversationId: id, role: "assistant", content: fullResponse || "(sin respuesta)" }),
      db.update(conversationsTable).set({ actualizadoEn: new Date() }).where(eq(conversationsTable.id, id)),
    ]);

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error in AI message endpoint");
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Error interno" })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  }
});

// POST /ai/chat — stateless, no DB persistence
const ChatInputSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
  content: z.string().min(1).max(10000),
});

aiRouter.post("/ai/chat", async (req, res) => {
  const userId = req.user!.id;
  const parsed = ChatInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { messages, content } = parsed.data;

  try {
    const userContext = await buildUserContext(userId);
    const systemPrompt = `${SYSTEM_BASE}\n\n${userContext}\n\n---\nFecha y hora actual: ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}`;

    const chatMessages = [...messages, { role: "user" as const, content }];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      const groq = getGroqClient();
      const stream = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        max_tokens: 2048,
        messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    } catch (groqErr) {
      req.log.error({ groqErr }, "Groq streaming error in /ai/chat");
      res.write(`data: ${JSON.stringify({ error: "Error al comunicarse con el modelo de IA" })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error in stateless AI chat endpoint");
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Error interno" })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  }
});

export default aiRouter;
