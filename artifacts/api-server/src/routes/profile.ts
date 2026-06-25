import { Router } from "express";
import { z } from "zod";
import { db, flowCredencialesTable, mpCredencialesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CompletarPerfilBody } from "@workspace/api-zod";
import { encrypt, decrypt } from "../lib/encrypt";
import { normalizeRut } from "../lib/rut";

const profileRouter = Router();

profileRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
});

// Save the mandatory profile data collected on first login and mark the
// profile as completed so the user can access the rest of the platform.
profileRouter.put("/profile/datos", async (req, res) => {
  const userId = req.user!.id;
  const parsed = CompletarPerfilBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de perfil inválidos" });
    return;
  }

  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();
  const phone = parsed.data.phone.trim();
  const address = parsed.data.address.trim();
  const companyName = parsed.data.companyName?.trim() || null;

  // Reject required fields that are blank after trimming (e.g. "   "), which
  // would otherwise pass min(1) and mark the profile complete with empty data.
  if (!firstName || !lastName || !phone || !address) {
    res.status(400).json({ error: "Todos los campos obligatorios deben tener contenido" });
    return;
  }

  // Validate the optional profile photo. `undefined` means "leave unchanged";
  // an empty string or null clears it. Accepts an http(s) URL (OIDC picture) or
  // a data:image/ URL (client-resized upload), capped to keep payloads small.
  const rawPhoto = parsed.data.profileImageUrl;
  let nextPhoto: string | null | undefined = undefined;
  if (rawPhoto !== undefined) {
    if (rawPhoto === null || rawPhoto === "") {
      nextPhoto = null;
    } else {
      const isData = rawPhoto.startsWith("data:image/");
      const isHttp = /^https?:\/\//.test(rawPhoto);
      if (!isData && !isHttp) {
        res.status(400).json({ error: "La imagen de perfil no es válida" });
        return;
      }
      if (isData && rawPhoto.length > 1_500_000) {
        res.status(400).json({ error: "La imagen es demasiado grande" });
        return;
      }
      nextPhoto = rawPhoto;
    }
  }

  try {
    // RUT is read-only once saved: keep the stored value and ignore any change
    // sent in the body. Only the very first profile completion sets (and thus
    // validates) the RUT — edits by users who already have one skip validation.
    const [current] = await db
      .select({ rut: usersTable.rut })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    let rutToSave = current?.rut ?? null;
    if (!rutToSave) {
      rutToSave = normalizeRut(parsed.data.rut);
      if (!rutToSave) {
        res.status(400).json({ error: "El RUT ingresado no es válido" });
        return;
      }
    }

    const [updated] = await db
      .update(usersTable)
      .set({
        firstName,
        lastName,
        rut: rutToSave,
        phone,
        address,
        companyName,
        ...(nextPhoto !== undefined ? { profileImageUrl: nextPhoto } : {}),
        profileCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId))
      .returning();

    if (!updated) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }

    res.json({
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      profileImageUrl: updated.profileImageUrl,
      role: updated.role,
      profileCompleted: updated.profileCompleted,
      rut: updated.rut,
      phone: updated.phone,
      address: updated.address,
      companyName: updated.companyName,
    });
  } catch (err) {
    req.log.error({ err }, "Error saving profile data");
    res.status(500).json({ error: "Error interno del servidor" });
  }
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
