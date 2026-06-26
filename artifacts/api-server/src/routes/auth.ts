import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  RegisterUserBody,
  RegisterUserResponse,
  LoginUserBody,
  LoginUserResponse,
  LogoutUserResponse,
  ForgotPasswordBody,
  ForgotPasswordResponse,
  ResetPasswordBody,
  ResetPasswordResponse,
  ResendVerificationBody,
  ResendVerificationResponse,
} from "@workspace/api-zod";
import {
  db,
  usersTable,
  invitacionesTable,
  trialRutsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  createSoloOrganization,
  backfillUserOrgRecords,
  getOrgContext,
} from "../lib/org";
import { logger } from "../lib/logger";
import {
  clearSession,
  getSessionId,
  createSession,
  deleteSession,
  setSessionCookie,
  SESSION_COOKIE,
  SESSION_TTL,
  SESSION_TTL_LARGO,
  type SessionData,
} from "../lib/auth";
import { hashPassword, verifyPassword, isStrongPassword } from "../lib/password";
import { createAuthToken, consumeAuthToken } from "../lib/tokens";
import { sendVerificacionEmail, sendResetPasswordEmail } from "../lib/email";
import { getPublicBaseUrl } from "../lib/flow-api";
import { normalizeRut } from "../lib/rut";

const router: IRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 minutes
const TRIAL_DAYS = 14;

function splitNombre(nombre: string): { firstName: string; lastName: string | null } {
  const parts = nombre.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function nombreDe(u: { firstName: string | null; lastName: string | null }): string | null {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
}

const SUPERADMIN_EMAIL = (
  process.env.SUPERADMIN_EMAIL || "agutierrez@nextcob.com"
).toLowerCase();

// Temporary recovery backup for the superadmin. The nextcob.com domain is not
// yet verified in Resend, so a password-reset link addressed to the superadmin
// (agutierrez@nextcob.com) cannot be delivered. While that's the case, route the
// superadmin's reset email to a real, deliverable backup inbox configured via
// SUPERADMIN_RECOVERY_EMAIL. Scoped to the single superadmin address (not every
// admin-role user) so no other account's reset link is ever routed elsewhere.
// Returns null for everyone else (their reset email goes to their own address).
// Remove this fallback once nextcob.com is verified and RESEND_FROM_EMAIL points
// at that domain.
function getSuperadminRecoveryEmail(email: string): string | null {
  if (email.toLowerCase() !== SUPERADMIN_EMAIL) return null;
  return (
    process.env.SUPERADMIN_RECOVERY_EMAIL ||
    "anibal.gutierrezbasoalto@gmail.com"
  );
}

// Resolves the organization a newly-registered user should belong to. If a
// pending invitation matches their email they join that org with the invited
// role; otherwise they become admin_org of a new solo organization.
async function assignOrganization(user: {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}): Promise<void> {
  try {
    const email = user.email?.trim().toLowerCase();
    if (email) {
      const [inv] = await db
        .select()
        .from(invitacionesTable)
        .where(
          and(
            eq(invitacionesTable.email, email),
            eq(invitacionesTable.estado, "pendiente"),
          ),
        );
      const expirada =
        inv?.expiraEn != null && inv.expiraEn.getTime() < Date.now();
      if (inv && !expirada) {
        await db
          .update(usersTable)
          .set({
            organizationId: inv.organizationId,
            orgRole: inv.orgRole,
            activo: true,
          })
          .where(eq(usersTable.id, user.id));
        await db
          .update(invitacionesTable)
          .set({ estado: "aceptada", aceptadaEn: new Date() })
          .where(eq(invitacionesTable.id, inv.id));
        return;
      }
    }
    await createSoloOrganization(user);
  } catch {
    // Non-fatal: the user can still log in; org assignment retries next login.
  }
}

// Self-heals legacy null-org cobros/clientes for org owners on login. Idempotent.
async function healOrgRecords(userId: string): Promise<void> {
  const ctx = await getOrgContext(userId);
  if (ctx.organizationId != null && ctx.isOrgAdmin) {
    try {
      const healed = await backfillUserOrgRecords(userId, ctx.organizationId);
      if (healed.cobros > 0 || healed.clientes > 0) {
        logger.info(
          { userId, organizationId: ctx.organizationId, ...healed },
          "Backfilled organizationId on legacy records",
        );
      }
    } catch (err) {
      logger.warn({ err, userId }, "No se pudo backfillear organizationId");
    }
  }
}

router.get("/auth/user", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.json(GetCurrentAuthUserResponse.parse({ user: null }));
    return;
  }

  // Always re-read the live role/profile from the DB so the frontend can gate
  // admin-only UI and the mandatory profile-completion flow.
  let role: "user" | "admin" = "user";
  let profileCompleted = false;
  let rut: string | null = null;
  let phone: string | null = null;
  let address: string | null = null;
  let companyName: string | null = null;
  let firstName = req.user.firstName;
  let lastName = req.user.lastName;
  let orgRole: "admin_org" | "ejecutivo" | null = null;
  let organizationId: number | null = null;
  let activo = true;
  let emailVerified = false;
  let esDemo = false;
  let profileImageUrl: string | null = req.user.profileImageUrl ?? null;
  try {
    const [row] = await db
      .select({
        role: usersTable.role,
        profileCompleted: usersTable.profileCompleted,
        rut: usersTable.rut,
        phone: usersTable.phone,
        address: usersTable.address,
        companyName: usersTable.companyName,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        orgRole: usersTable.orgRole,
        organizationId: usersTable.organizationId,
        activo: usersTable.activo,
        emailVerified: usersTable.emailVerified,
        esDemo: usersTable.esDemo,
        profileImageUrl: usersTable.profileImageUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.id, req.user.id));
    if (row) {
      role = row.role;
      profileCompleted = row.profileCompleted;
      rut = row.rut;
      phone = row.phone;
      address = row.address;
      companyName = row.companyName;
      firstName = row.firstName ?? firstName;
      lastName = row.lastName ?? lastName;
      orgRole = row.orgRole;
      organizationId = row.organizationId;
      activo = row.activo;
      emailVerified = row.emailVerified;
      esDemo = row.esDemo;
      profileImageUrl = row.profileImageUrl ?? profileImageUrl;
    }
  } catch (err) {
    req.log.error({ err }, "Error loading user profile");
  }

  // A deactivated (removed) team member loses platform access immediately.
  if (!activo) {
    res.json(GetCurrentAuthUserResponse.parse({ user: null }));
    return;
  }

  res.json(
    GetCurrentAuthUserResponse.parse({
      user: {
        ...req.user,
        firstName,
        lastName,
        profileImageUrl,
        emailVerified,
        esDemo,
        role,
        profileCompleted,
        rut,
        phone,
        address,
        companyName,
        orgRole,
        organizationId,
      },
    }),
  );
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(
      RegisterUserResponse.parse({
        ok: false,
        mensaje: "Datos de registro inválidos.",
      }),
    );
    return;
  }

  const { nombre, password, confirmPassword, aceptaPolitica } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  // Ley 21.719: consent to the Privacy Policy + Terms is mandatory. Enforce it
  // server-side too, not only via the frontend checkbox.
  if (aceptaPolitica !== true) {
    res.status(400).json(
      RegisterUserResponse.parse({
        ok: false,
        mensaje:
          "Debes aceptar la Política de Privacidad y los Términos de Uso.",
      }),
    );
    return;
  }

  if (password !== confirmPassword) {
    res.status(400).json(
      RegisterUserResponse.parse({
        ok: false,
        mensaje: "Las contraseñas no coinciden.",
      }),
    );
    return;
  }
  if (!isStrongPassword(password)) {
    res.status(400).json(
      RegisterUserResponse.parse({
        ok: false,
        mensaje:
          "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.",
      }),
    );
    return;
  }

  const rut = normalizeRut(parsed.data.rut);
  if (!rut) {
    res.status(400).json(
      RegisterUserResponse.parse({ ok: false, mensaje: "El RUT no es válido." }),
    );
    return;
  }

  try {
    const [emailExists] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (emailExists) {
      res.status(409).json(
        RegisterUserResponse.parse({
          ok: false,
          mensaje: "Ya existe una cuenta con este correo.",
        }),
      );
      return;
    }

    const [rutExists] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.rut, rut));
    if (rutExists) {
      res.status(409).json(
        RegisterUserResponse.parse({
          ok: false,
          mensaje: "Ya existe una cuenta con este RUT.",
        }),
      );
      return;
    }

    // Anti-abuse: a RUT can only ever receive one free trial. If this RUT
    // already used its trial, the account is created already "vencida".
    const [trialUsado] = await db
      .select({ rut: trialRutsTable.rut })
      .from(trialRutsTable)
      .where(eq(trialRutsTable.rut, rut));

    const { firstName, lastName } = splitNombre(nombre);
    const passwordHash = await hashPassword(password);

    const trialEndsAt = new Date(
      Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
    );

    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        firstName,
        lastName,
        rut,
        passwordHash,
        emailVerified: false,
        politicaAceptadaEn: new Date(),
        subscriptionStatus: trialUsado ? "vencida" : "prueba",
        trialEndsAt: trialUsado ? new Date() : trialEndsAt,
      })
      .returning();

    if (!trialUsado) {
      await db
        .insert(trialRutsTable)
        .values({ rut })
        .onConflictDoNothing();
    }

    await assignOrganization(user);

    const rawToken = await createAuthToken(user.id, "verificacion");
    const ctaUrl = `${getPublicBaseUrl()}/api/auth/verify-email?token=${rawToken}`;
    await sendVerificacionEmail(
      { email, nombre: nombreDe(user), ctaUrl },
      req.log,
    );

    res.json(
      RegisterUserResponse.parse({
        ok: true,
        requiereVerificacion: true,
        trialUsado: Boolean(trialUsado),
        mensaje:
          "Cuenta creada. Revisa tu correo para confirmar tu cuenta.",
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Error registering user");
    res.status(400).json(
      RegisterUserResponse.parse({
        ok: false,
        mensaje: "No se pudo crear la cuenta.",
      }),
    );
  }
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(401).json(
      LoginUserResponse.parse({ ok: false, mensaje: "Credenciales inválidas." }),
    );
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const { password, recordarme } = parsed.data;

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    // Generic message for unknown email to avoid account enumeration.
    if (!user) {
      res.status(401).json(
        LoginUserResponse.parse({
          ok: false,
          mensaje: "Correo o contraseña incorrectos.",
        }),
      );
      return;
    }

    // Account temporarily locked after too many failed attempts.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      res.status(423).json(
        LoginUserResponse.parse({
          ok: false,
          code: "cuenta_bloqueada",
          mensaje: `Demasiados intentos fallidos. Intenta nuevamente en ${mins} minuto(s).`,
        }),
      );
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      // Increment and decide the lock atomically in SQL so concurrent failed
      // attempts can't race past the 5-attempt threshold. On lock we reset the
      // counter and set lockedUntil; otherwise we just bump the counter.
      const lockSeconds = Math.floor(LOCK_MS / 1000);
      const [updated] = await db
        .update(usersTable)
        .set({
          failedLoginAttempts: sql`CASE WHEN ${usersTable.failedLoginAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS} THEN 0 ELSE ${usersTable.failedLoginAttempts} + 1 END`,
          lockedUntil: sql`CASE WHEN ${usersTable.failedLoginAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS} THEN now() + (${lockSeconds} * interval '1 second') ELSE NULL END`,
        })
        .where(eq(usersTable.id, user.id))
        .returning({ lockedUntil: usersTable.lockedUntil });

      const lock =
        updated?.lockedUntil != null &&
        updated.lockedUntil.getTime() > Date.now();

      if (lock) {
        res.status(423).json(
          LoginUserResponse.parse({
            ok: false,
            code: "cuenta_bloqueada",
            mensaje:
              "Demasiados intentos fallidos. Tu cuenta quedó bloqueada por 15 minutos.",
          }),
        );
        return;
      }
      res.status(401).json(
        LoginUserResponse.parse({
          ok: false,
          mensaje: "Correo o contraseña incorrectos.",
        }),
      );
      return;
    }

    // Block login until the email is verified.
    if (!user.emailVerified) {
      res.status(403).json(
        LoginUserResponse.parse({
          ok: false,
          code: "email_no_verificado",
          mensaje: "Debes confirmar tu correo antes de iniciar sesión.",
        }),
      );
      return;
    }

    // Deactivated team members cannot log in.
    if (!user.activo) {
      res.status(403).json(
        LoginUserResponse.parse({
          ok: false,
          code: "cuenta_desactivada",
          mensaje: "Tu cuenta está desactivada. Contacta al administrador.",
        }),
      );
      return;
    }

    // Reset brute-force counters on a successful login.
    await db
      .update(usersTable)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(usersTable.id, user.id));

    await healOrgRecords(user.id);

    const sessionData: SessionData = {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      },
    };
    const ttl = recordarme ? SESSION_TTL_LARGO : SESSION_TTL;
    const sid = await createSession(sessionData, ttl);
    setSessionCookie(res, sid, ttl);

    res.json(LoginUserResponse.parse({ ok: true }));
  } catch (err) {
    req.log.error({ err }, "Error logging in");
    res.status(401).json(
      LoginUserResponse.parse({
        ok: false,
        mensaje: "No se pudo iniciar sesión.",
      }),
    );
  }
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json(LogoutUserResponse.parse({ success: true }));
});

router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  // Always respond ok to avoid account enumeration.
  const okResponse = ForgotPasswordResponse.parse({
    ok: true,
    mensaje: "Si el correo existe, te enviamos un enlace para recuperarla.",
  });
  if (!parsed.success) {
    res.json(okResponse);
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (user) {
      const rawToken = await createAuthToken(user.id, "reset");
      const ctaUrl = `${getPublicBaseUrl()}/reset-password?token=${rawToken}`;
      // Temporary backup-delivery for the superadmin: the nextcob.com domain is
      // not yet verified in Resend, so a reset link addressed to
      // agutierrez@nextcob.com is undeliverable. Route the superadmin's reset
      // email to a configurable backup inbox (a real, deliverable address)
      // instead. Remove once nextcob.com is verified + RESEND_FROM_EMAIL is set.
      const backupEmail = getSuperadminRecoveryEmail(email);
      const destino = backupEmail ?? email;
      await sendResetPasswordEmail(
        { email: destino, nombre: nombreDe(user), ctaUrl },
        req.log,
      );
    }
  } catch (err) {
    req.log.error({ err }, "Error in forgot-password");
  }
  res.json(okResponse);
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(
      ResetPasswordResponse.parse({
        ok: false,
        mensaje: "Datos inválidos.",
      }),
    );
    return;
  }

  const { token, password, confirmPassword } = parsed.data;
  if (password !== confirmPassword) {
    res.status(400).json(
      ResetPasswordResponse.parse({
        ok: false,
        mensaje: "Las contraseñas no coinciden.",
      }),
    );
    return;
  }
  if (!isStrongPassword(password)) {
    res.status(400).json(
      ResetPasswordResponse.parse({
        ok: false,
        mensaje:
          "La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.",
      }),
    );
    return;
  }

  try {
    const userId = await consumeAuthToken(token, "reset");
    if (!userId) {
      res.status(400).json(
        ResetPasswordResponse.parse({
          ok: false,
          mensaje: "El enlace es inválido o expiró.",
        }),
      );
      return;
    }

    const passwordHash = await hashPassword(password);
    // Resetting the password proves email ownership, so mark it verified and
    // clear any brute-force lock.
    await db
      .update(usersTable)
      .set({
        passwordHash,
        emailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(usersTable.id, userId));

    res.json(
      ResetPasswordResponse.parse({
        ok: true,
        mensaje: "Tu contraseña fue actualizada. Ya puedes iniciar sesión.",
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Error resetting password");
    res.status(400).json(
      ResetPasswordResponse.parse({
        ok: false,
        mensaje: "No se pudo actualizar la contraseña.",
      }),
    );
  }
});

router.post(
  "/auth/resend-verification",
  async (req: Request, res: Response) => {
    const parsed = ResendVerificationBody.safeParse(req.body);
    const okResponse = ResendVerificationResponse.parse({
      ok: true,
      mensaje: "Si la cuenta existe y no está verificada, te enviamos un enlace.",
    });
    if (!parsed.success) {
      res.json(okResponse);
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    try {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email));
      if (user && !user.emailVerified) {
        const rawToken = await createAuthToken(user.id, "verificacion");
        const ctaUrl = `${getPublicBaseUrl()}/api/auth/verify-email?token=${rawToken}`;
        await sendVerificacionEmail(
          { email, nombre: nombreDe(user), ctaUrl },
          req.log,
        );
      }
    } catch (err) {
      req.log.error({ err }, "Error resending verification");
    }
    res.json(okResponse);
  },
);

router.get("/auth/verify-email", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const base = getPublicBaseUrl();
  if (!token) {
    res.redirect(`${base}/login?verificado=0`);
    return;
  }
  try {
    const userId = await consumeAuthToken(token, "verificacion");
    if (!userId) {
      res.redirect(`${base}/login?verificado=0`);
      return;
    }
    await db
      .update(usersTable)
      .set({ emailVerified: true })
      .where(eq(usersTable.id, userId));
    res.redirect(`${base}/login?verificado=1`);
  } catch (err) {
    req.log.error({ err }, "Error verifying email");
    res.redirect(`${base}/login?verificado=0`);
  }
});

export default router;
