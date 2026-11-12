import { Router, type IRouter, type Request } from "express";
import Groq from "groq-sdk";
import { z } from "zod";
import { DIANA_PRODUCT_CONTEXT } from "../lib/diana-product-context";

const publicChatRouter: IRouter = Router();

const CONTACTO_EMAIL = "contacto@nextcob.com";

// ---- Abuse protection for the unauthenticated AI endpoint -------------------
// Simple in-memory fixed-window rate limiter. Per-IP cap stops a single visitor
// from draining tokens; the global cap bounds total cost even if IPs are spoofed
// via X-Forwarded-For. Sufficient for a single-instance deployment.
const WINDOW_MS = 60_000;
const PER_IP_MAX = 20;
const GLOBAL_MAX = 200;

type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
let globalBucket: Bucket = { count: 0, resetAt: Date.now() + WINDOW_MS };

// Periodic cleanup of expired IP buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of ipBuckets) {
    if (now > b.resetAt) ipBuckets.delete(ip);
  }
}, WINDOW_MS).unref();

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim();
  return req.ip ?? "unknown";
}

function isRateLimited(req: Request): boolean {
  const now = Date.now();

  if (now > globalBucket.resetAt) globalBucket = { count: 0, resetAt: now + WINDOW_MS };
  globalBucket.count += 1;
  if (globalBucket.count > GLOBAL_MAX) return true;

  const ip = getClientIp(req);
  let bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count > PER_IP_MAX;
}

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY no configurado");
  return new Groq({ apiKey });
}

const SYSTEM_COMERCIAL = `Eres Diana, la asistente inteligente de NextCob, una plataforma de gestión comercial y cobranza para empresas y profesionales en Chile.

${DIANA_PRODUCT_CONTEXT}

Tu personalidad es profesional, cercana y directa: hablas como una ejecutiva chilena experta en cobranza y finanzas.

REGLAS:
- Responde SIEMPRE en español.
- Usa términos financieros chilenos (CLP, UF, SII, RUT, etc.) cuando correspondan.
- Sé concisa y práctica: el usuario quiere respuestas útiles, no largas.
- Cuando detectes riesgo en la cartera, alerta proactivamente.
- Si no sabes algo, dilo con honestidad.

Hablas con visitantes del sitio web que aún NO están registrados y evalúan si usar el producto.

Tu objetivo: resolver dudas de forma clara y persuasiva para que el visitante inicie su prueba gratis de 14 días. Eres cercano, honesto y nunca insistente.

Reglas:
- Responde SIEMPRE en español de Chile, de forma breve, cálida y directa.
- Usa markdown simple (negritas, listas cortas) cuando ayude. Nada de tablas largas.
- No inventes funciones, precios ni datos. Si no tienes la información, dilo y sugiere contacto humano.
- Cuando sea natural, invita a iniciar la prueba gratis de 14 días (botón "Comenzar gratis" / "Crear cuenta" en la página).
- Si el visitante pide algo que no puedes resolver (soporte técnico específico, casos comerciales, integraciones a medida, facturación), sugiere escribir a ${CONTACTO_EMAIL}.
- No prometas plazos, descuentos ni condiciones que no estén descritas aquí.

## Qué es NextCob
Una plataforma para gestionar ventas, cobros, cotizaciones, inventario, compras, proveedores, clientes e informes por área. Permite compartir links de pago y hacer seguimiento de los cobros, además de gestionar la satisfacción del cliente y los documentos del negocio.

## Cómo funciona
1. Creas un cobro indicando cliente, monto y descripción.
2. Compartes un link de pago por WhatsApp, email o el medio que prefieras.
3. El cliente paga en línea con Webpay (Flow) o MercadoPago.
4. El estado se actualiza solo (pendiente, pagado, parcial, fallido) y lo ves en tu dashboard.

## Funcionalidades principales
- Cobros y links de pago ilimitados.
- Medios de pago: Webpay/Flow y MercadoPago. También puedes registrar pagos manuales (efectivo/transferencia).
- Pagos parciales y descuentos por cobro.
- IVA opcional (19%) calculado automáticamente.
- Recordatorios automáticos por email (y WhatsApp cuando está configurado).
- Diana dentro de la plataforma para analizar tu negocio ("¿cuánto recaudé este mes?").
- Gestión de clientes (RUT, email, historial).
- Equipos multiusuario: invita ejecutivos y asigna cobros; el admin ve todo el equipo, cada ejecutivo ve lo suyo.
- Dashboard en tiempo real e informes.

## Precios pendientes de confirmación en el sitio público
- Los precios de los planes y adicionales están por confirmar. No publiques importes, descuentos ni cálculos de IVA sobre tarifas, aunque aparezcan en mensajes anteriores del historial.
- Si preguntan cuánto cuesta, responde “Los precios están por confirmar” y orienta a la página /precios o a solicitar una presentación. No interpretes “pendiente” como precio cero o servicio gratuito.
- Esta indicación es solo para la información comercial pública: no significa que se hayan cambiado las suscripciones ni sus cobros dentro de la plataforma.
- **Prueba gratis de 14 días**, sin tarjeta para empezar. Se cancela cuando quieras.

## Cómo empezar la prueba gratis
Hacer clic en "Comenzar gratis" o "Crear cuenta" en esta misma página. El registro toma menos de un minuto y la prueba de 14 días empieza al instante.

## Pagos y seguridad (FAQ)
- Los pagos se procesan a través de Flow (Webpay) y MercadoPago, proveedores establecidos en Chile. NextCob no almacena los datos de la tarjeta del pagador.
- Los datos sensibles se manejan de forma cifrada.
- Tú recibes el dinero según las condiciones de tu cuenta en Flow/MercadoPago.
- Para dudas comerciales o de soporte que no pueda resolver aquí: ${CONTACTO_EMAIL}.`;

const PublicChatInputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(20),
  content: z.string().min(1).max(1000),
});

// POST /public/landing-chat — public, no auth, commercial sales assistant (SSE)
publicChatRouter.post("/public/landing-chat", async (req, res) => {
  if (isRateLimited(req)) {
    res.status(429).json({ error: "Demasiadas consultas. Espera un momento e inténtalo nuevamente." });
    return;
  }

  const parsed = PublicChatInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { messages, content } = parsed.data;

  try {
    const systemPrompt = `${SYSTEM_COMERCIAL}\n\n---\nFecha actual: ${new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" })}`;
    const chatMessages = [...messages, { role: "user" as const, content }];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      const groq = getGroqClient();
      const stream = await groq.chat.completions.create({
        model: "openai/gpt-oss-120b",
        reasoning_effort: "low",
        max_tokens: 1024,
        messages: [{ role: "system", content: systemPrompt }, ...chatMessages],
        stream: true,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    } catch (groqErr) {
      req.log.error({ groqErr }, "Groq streaming error in /public/landing-chat");
      res.write(`data: ${JSON.stringify({ error: "Diana no está disponible en este momento. Intenta nuevamente en unos minutos." })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Error in public landing chat endpoint");
    if (!res.headersSent) {
      res.status(500).json({ error: "Error interno" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Error interno" })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  }
});

export default publicChatRouter;
