import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Blocks access to admin-only routes unless the authenticated user has the
// "admin" role in the database. Must run AFTER the auth middleware that
// populates req.user.
export async function requireAdmin(
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
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!row || row.role !== "admin") {
      res.status(403).json({ error: "Acceso restringido a administradores" });
      return;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "Error checking admin access");
    res.status(500).json({ error: "Error interno del servidor" });
  }
}
