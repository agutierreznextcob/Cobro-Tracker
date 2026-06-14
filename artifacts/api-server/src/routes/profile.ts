import { Router } from "express";
import { z } from "zod";
import { db, flowCredencialesTable, mpCredencialesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/encrypt";

const profileRouter = Router();

profileRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

const FlowCredencialesInput = z.object({
  apiKey: z.string().min(1, "API Key requerida"),
  secretKey: z.string().min(1, "Secret Key requerida"),
});

profileRouter.get("/profile/flow-credentials", async (req, res) => {
  const userId = req.user!.id;
  try {
    const [row] = await db
      .select()
      .from(flowCredencialesTable)
      .where(eq(flowCredencialesTable.userId, userId));

    if (!row) {
      res.json({ configurado: false });
      return;
    }

    res.json({ configurado: true });
  } catch (err) {
    req.log.error({ err }, "Error getting flow credentials");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

profileRouter.put("/profile/flow-credentials", async (req, res) => {
  const userId = req.user!.id;
  const parsed = FlowCredencialesInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { apiKey, secretKey } = parsed.data;

  try {
    const encApiKey = encrypt(apiKey);
    const encSecretKey = encrypt(secretKey);

    await db
      .insert(flowCredencialesTable)
      .values({
        userId,
        apiKeyEncrypted: encApiKey.encrypted,
        apiKeyIv: encApiKey.iv,
        apiKeyAuthTag: encApiKey.authTag,
        secretKeyEncrypted: encSecretKey.encrypted,
        secretKeyIv: encSecretKey.iv,
        secretKeyAuthTag: encSecretKey.authTag,
        actualizadoEn: new Date(),
      })
      .onConflictDoUpdate({
        target: flowCredencialesTable.userId,
        set: {
          apiKeyEncrypted: encApiKey.encrypted,
          apiKeyIv: encApiKey.iv,
          apiKeyAuthTag: encApiKey.authTag,
          secretKeyEncrypted: encSecretKey.encrypted,
          secretKeyIv: encSecretKey.iv,
          secretKeyAuthTag: encSecretKey.authTag,
          actualizadoEn: new Date(),
        },
      });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error saving flow credentials");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

profileRouter.delete("/profile/flow-credentials", async (req, res) => {
  const userId = req.user!.id;
  try {
    await db
      .delete(flowCredencialesTable)
      .where(eq(flowCredencialesTable.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting flow credentials");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ── MercadoPago credentials ─────────────────────────────────────────────────

const MpCredencialesInput = z.object({
  accessToken: z.string().min(1, "Access Token requerido"),
});

profileRouter.get("/profile/mp-credentials", async (req, res) => {
  const userId = req.user!.id;
  try {
    const [row] = await db
      .select()
      .from(mpCredencialesTable)
      .where(eq(mpCredencialesTable.userId, userId));
    res.json({ configurado: !!row });
  } catch (err) {
    req.log.error({ err }, "Error getting MP credentials");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

profileRouter.put("/profile/mp-credentials", async (req, res) => {
  const userId = req.user!.id;
  const parsed = MpCredencialesInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const enc = encrypt(parsed.data.accessToken);

  try {
    await db
      .insert(mpCredencialesTable)
      .values({
        userId,
        accessTokenEncrypted: enc.encrypted,
        accessTokenIv: enc.iv,
        accessTokenAuthTag: enc.authTag,
        actualizadoEn: new Date(),
      })
      .onConflictDoUpdate({
        target: mpCredencialesTable.userId,
        set: {
          accessTokenEncrypted: enc.encrypted,
          accessTokenIv: enc.iv,
          accessTokenAuthTag: enc.authTag,
          actualizadoEn: new Date(),
        },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error saving MP credentials");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

profileRouter.delete("/profile/mp-credentials", async (req, res) => {
  const userId = req.user!.id;
  try {
    await db
      .delete(mpCredencialesTable)
      .where(eq(mpCredencialesTable.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting MP credentials");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

export { profileRouter };

export async function getMpCredentials(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(mpCredencialesTable)
    .where(eq(mpCredencialesTable.userId, userId));
  if (!row) return null;
  return decrypt(row.accessTokenEncrypted, row.accessTokenIv, row.accessTokenAuthTag);
}

export async function getFlowCredentials(userId: string): Promise<{ apiKey: string; secretKey: string } | null> {
  const [row] = await db
    .select()
    .from(flowCredencialesTable)
    .where(eq(flowCredencialesTable.userId, userId));

  if (!row) return null;

  return {
    apiKey: decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyAuthTag),
    secretKey: decrypt(row.secretKeyEncrypted, row.secretKeyIv, row.secretKeyAuthTag),
  };
}
