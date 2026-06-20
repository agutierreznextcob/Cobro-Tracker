import * as oidc from "openid-client";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable, invitacionesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  createSoloOrganization,
  backfillUserOrgRecords,
  getOrgContext,
} from "../lib/org";
import { logger } from "../lib/logger";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as
      | string
      | null,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        ...userData,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Multi-tenant onboarding: a user with no organization either joins one via a
  // pending invitation matching their email, or gets their own solo org.
  if (user.organizationId == null) {
    await assignOrganization(user);
  }

  // Self-heal legacy data: link the user's pre-organizations cobros/clientes to
  // their org. Idempotent (only touches null-org rows), so it costs nothing once
  // healed but fixes environments where the one-time backfill never ran (prod).
  // Restricted to org owners (admin_org): an invited member's pre-existing
  // personal records must NOT be absorbed into the inviting org — they stay
  // private to the member, who still sees them via responsableId scoping.
  const ctx = await getOrgContext(user.id);
  if (ctx.organizationId != null && ctx.isOrgAdmin) {
    try {
      const healed = await backfillUserOrgRecords(user.id, ctx.organizationId);
      if (healed.cobros > 0 || healed.clientes > 0) {
        logger.info(
          { userId: user.id, organizationId: ctx.organizationId, ...healed },
          "Backfilled organizationId on legacy records",
        );
      }
    } catch (err) {
      logger.warn({ err, userId: user.id }, "No se pudo backfillear organizationId");
    }
  }

  return user;
}

// Resolves the organization a newly-seen user should belong to. If a pending
// invitation matches their email, they join that org with the invited role and
// the invitation is marked accepted. Otherwise they become admin_org of a new
// solo organization. Best-effort: failures are swallowed so login still works.
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

router.get("/auth/user", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.json(GetCurrentAuthUserResponse.parse({ user: null }));
    return;
  }

  // Enrich the session user with the current DB role and profile data so the
  // frontend can gate admin-only UI and the mandatory profile-completion flow.
  // The session only stores identity fields populated from the OIDC claims.
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
    }
  } catch (err) {
    req.log.error({ err }, "Error loading user profile");
  }

  res.json(
    GetCurrentAuthUserResponse.parse({
      user: {
        ...req.user,
        firstName,
        lastName,
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

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    // OIDC state cookies missing (expired or blocked).
    // Restart login pointing to /dashboard so user doesn't land on landing page.
    res.redirect(`/api/login?returnTo=${encodeURIComponent("/dashboard")}`);
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  const dbUser = await upsertUser(
    claims as unknown as Record<string, unknown>,
  );

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get("/logout", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const origin = getOrigin(req);

  const sid = getSessionId(req);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: origin,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  "/mobile-auth/token-exchange",
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required parameters" });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("iss", ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: "No claims in ID token" });
        return;
      }

      const dbUser = await upsertUser(
        claims as unknown as Record<string, unknown>,
      );

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error({ err }, "Mobile token exchange error");
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

export default router;
