import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Blocks access to organization-admin routes unless the authenticated user has
// the "admin_org" role within their organization. Must run AFTER the auth
// middleware that populates req.user. Distinct from requireAdmin, which gates
// platform-staff ("admin") access.
export async function requireOrgAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }

  try {
    const [row] = await db
      .select({ orgRole: usersTable.orgRole })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!row || row.orgRole !== "admin_org") {
      res
        .status(403)
        .json({ error: "Acceso restringido a administradores de la organización" });
      return;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "Error checking org admin access");
    res.status(500).json({ error: "Error interno del servidor" });
  }
}
