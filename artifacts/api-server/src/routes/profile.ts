import { Router } from "express";
import { z } from "zod";
import {
  db,
  flowCredencialesTable,
  mpCredencialesTable,
  usersTable,
  cobrosTable,
  clientesTable,
  comprobantesTable,
  notificacionesTable,
  gestionesCobranzaTable,
  recordatoriosDefaultTable,
  conversationsTable,
  organizacionesTable,
  authTokensTable,
  invitacionesTable,
} from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { CompletarPerfilBody, EliminarCuentaBody } from "@workspace/api-zod";
import { encrypt, decrypt } from "../lib/encrypt";
import { normalizeRut } from "../lib/rut";
import { getOrgContext } from "../lib/org";
import { deleteSession, getSessionId, SESSION_COOKIE } from "../lib/auth";

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

// ── Ley 21.719: data portability & account deletion ────────────────────────

// GET /profile/exportar-datos — returns all of the user's personal data so they
// can download it (ARCO "acceso" / portability). Scoped by org role: admin_org
// sees the whole organization's cobros/clientes; ejecutivo only their own. No
// secrets (password hash, encrypted credentials) are ever included.
profileRouter.get("/profile/exportar-datos", async (req, res) => {
  const userId = req.user!.id;
  try {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!u) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }

    const ctx = await getOrgContext(userId);

    const cobrosCond =
      ctx.isOrgAdmin && ctx.organizationId != null
        ? eq(cobrosTable.organizationId, ctx.organizationId)
        : eq(cobrosTable.responsableId, userId);
    const clientesCond =
      ctx.isOrgAdmin && ctx.organizationId != null
        ? eq(clientesTable.organizationId, ctx.organizationId)
        : eq(clientesTable.userId, userId);

    const [cobros, clientes] = await Promise.all([
      db.select().from(cobrosTable).where(cobrosCond),
      db.select().from(clientesTable).where(clientesCond),
    ]);

    // Whitelist profile fields: never expose passwordHash, lockout internals or
    // anything sensitive.
    const perfil = {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      rut: u.rut,
      phone: u.phone,
      address: u.address,
      companyName: u.companyName,
      profileImageUrl: u.profileImageUrl,
      role: u.role,
      orgRole: u.orgRole,
      organizationId: u.organizationId,
      emailVerified: u.emailVerified,
      subscriptionStatus: u.subscriptionStatus,
      trialEndsAt: u.trialEndsAt,
      politicaAceptadaEn: u.politicaAceptadaEn,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    };

    res.json({
      exportadoEn: new Date().toISOString(),
      perfil,
      cobros,
      clientes,
    });
  } catch (err) {
    req.log.error({ err }, "Error exporting user data");
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// DELETE /profile/cuenta — permanently and irreversibly deletes the user's
// account and all associated data (ARCO "cancelación"). Demo and platform-admin
// accounts cannot self-delete. An org owner with other members is blocked until
// those members are removed (so their data is not destroyed). trial_ruts is
// deliberately preserved to keep the 1-RUT-1-trial anti-abuse guarantee.
profileRouter.delete("/profile/cuenta", async (req, res) => {
  const userId = req.user!.id;
  const parsed = EliminarCuentaBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirmacion !== "ELIMINAR") {
    res.status(400).json({ error: "Confirmación inválida" });
    return;
  }

  // Sentinel thrown inside the deletion transaction to roll back and surface a
  // 409 when the org gained members after the initial check (race condition).
  const ORG_HAS_MEMBERS = "ORG_HAS_MEMBERS";

  try {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!u) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }

    if (u.esDemo || u.role === "admin") {
      res.status(403).json({
        error:
          "Las cuentas de demostración o administración no pueden eliminarse desde aquí.",
      });
      return;
    }

    const ctx = await getOrgContext(userId);
    const orgId = ctx.organizationId;

    // Is this user the owner of their organization?
    let isOwner = false;
    if (orgId != null) {
      const [org] = await db
        .select({ ownerId: organizacionesTable.ownerId })
        .from(organizacionesTable)
        .where(eq(organizacionesTable.id, orgId));
      isOwner = org?.ownerId === userId;
    }

    // An owner cannot delete while other members still belong to the org —
    // deleting the org would destroy their data. We do a cheap pre-check here
    // for a fast 409, but the authoritative check is re-run inside the
    // transaction below to avoid a race where a member is added between the
    // check and the org-wide delete.
    if (isOwner && orgId != null) {
      const otrosMiembros = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(eq(usersTable.organizationId, orgId), ne(usersTable.id, userId)),
        );
      if (otrosMiembros.length > 0) {
        res.status(409).json({
          error:
            "Tu cuenta administra una organización con otros usuarios. Elimina o transfiere esos usuarios antes de eliminar tu cuenta.",
        });
        return;
      }
    }

    // Decide which cobros/clientes get deleted. Owner of a solo org → the whole
    // org's data. Non-owner (ejecutivo) → only their own records.
    const deleteOrgWide = isOwner && orgId != null;

    await db.transaction(async (tx) => {
      // 0. Authoritative re-check inside the transaction: if any other member
      // belongs to the org now, abort the whole deletion (rolls back). Guards
      // against a race where a member is added after the pre-check above.
      if (deleteOrgWide) {
        const otrosMiembros = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.organizationId, orgId),
              ne(usersTable.id, userId),
            ),
          );
        if (otrosMiembros.length > 0) {
          throw new Error(ORG_HAS_MEMBERS);
        }
      }

      // 1. Resolve the cobros to delete.
      const cobrosCond = deleteOrgWide
        ? eq(cobrosTable.organizationId, orgId)
        : eq(cobrosTable.responsableId, userId);
      const cobros = await tx
        .select({ id: cobrosTable.id })
        .from(cobrosTable)
        .where(cobrosCond);
      const cobroIds = cobros.map((c) => c.id);

      // 2. comprobantes has no FK cascade → delete manually by cobroId.
      if (cobroIds.length > 0) {
        await tx
          .delete(comprobantesTable)
          .where(inArray(comprobantesTable.cobroId, cobroIds));
        // 3. Deleting cobros cascades to pagos_parciales, recordatorios,
        // recordatorios_enviados, cobro_descuentos, seguimientos_cobranza,
        // gestiones_cobranza and notificaciones tied to those cobros.
        await tx.delete(cobrosTable).where(inArray(cobrosTable.id, cobroIds));
      }

      // 4. clientes (org-wide or own).
      const clientesCond = deleteOrgWide
        ? eq(clientesTable.organizationId, orgId)
        : eq(clientesTable.userId, userId);
      await tx.delete(clientesTable).where(clientesCond);

      // 5. User-scoped data (these reference the user directly).
      await tx
        .delete(notificacionesTable)
        .where(eq(notificacionesTable.userId, userId));
      await tx
        .delete(gestionesCobranzaTable)
        .where(eq(gestionesCobranzaTable.usuarioId, userId));
      await tx
        .delete(recordatoriosDefaultTable)
        .where(eq(recordatoriosDefaultTable.userId, userId));
      await tx
        .delete(flowCredencialesTable)
        .where(eq(flowCredencialesTable.userId, userId));
      await tx
        .delete(mpCredencialesTable)
        .where(eq(mpCredencialesTable.userId, userId));
      // conversations → messages cascade via conversation_id.
      await tx
        .delete(conversationsTable)
        .where(eq(conversationsTable.userId, userId));
      await tx
        .delete(authTokensTable)
        .where(eq(authTokensTable.userId, userId));

      // 6. Organization-level cleanup (owner of a solo org only).
      if (deleteOrgWide) {
        await tx
          .delete(invitacionesTable)
          .where(eq(invitacionesTable.organizationId, orgId));
        await tx
          .delete(organizacionesTable)
          .where(eq(organizacionesTable.id, orgId));
      }

      // 7. Finally the user. trial_ruts is intentionally left untouched.
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
    });

    // Clear the now-orphaned session so the client is logged out.
    const sid = getSessionId(req);
    if (sid) {
      await deleteSession(sid);
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === ORG_HAS_MEMBERS) {
      res.status(409).json({
        error:
          "Tu cuenta administra una organización con otros usuarios. Elimina o transfiere esos usuarios antes de eliminar tu cuenta.",
      });
      return;
    }
    req.log.error({ err }, "Error deleting account");
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
