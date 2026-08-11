import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { hashPassword, verifyPassword } from "../lib/password";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  consultoresTable,
  consultorSesionesTable,
  consultorAccionesTable,
} from "@workspace/db";
import {
  createSession,
  clearSession,
  getSessionId,
  setSessionCookie,
  SESSION_TTL,
} from "../lib/auth";
import { requireAdmin } from "../middlewares/requireAdmin";

// Acceso de consultores de soporte NextCob (Ley 21.719). El login es PÚBLICO
// (sin sesión previa) y por eso este router se monta antes de los routers con
// blanket auth. Todas las demás rutas se auto-protegen individualmente.
const consultorRouter: IRouter = Router();

// ---- Rate limiting (login público) -----------------------------------------
const WINDOW_MS = 60_000;
const PER_IP_MAX = 5;
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of ipBuckets) if (now > b.resetAt) ipBuckets.delete(ip);
}, WINDOW_MS).unref();

function isRateLimited(req: Request): boolean {
  const now = Date.now();
  // trust proxy está configurado en app.ts, así que req.ip ya resuelve la IP
  // real del cliente sin confiar directamente en X-Forwarded-For.
  const ip = req.ip || "unknown";
  let bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count > PER_IP_MAX;
}

const CONSULTOR_SESSION_MS = 8 * 60 * 60 * 1000;

// Cierra registros de auditoría de sesiones que expiraron sin logout explícito
// (la sesión HTTP dura máximo 8h, así que finEn = inicio + 8h es fiel).
async function cerrarSesionesExpiradas(): Promise<void> {
  const limite = new Date(Date.now() - CONSULTOR_SESSION_MS);
  await db
    .update(consultorSesionesTable)
    .set({ finEn: sql`${consultorSesionesTable.inicioEn} + interval '8 hours'` })
    .where(
      and(
        isNull(consultorSesionesTable.finEn),
        lt(consultorSesionesTable.inicioEn, limite),
      ),
    );
}

// Acepta "NCB-0000000004", "ncb 4", "4"… y lo normaliza al formato almacenado.
function normalizarAccountId(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits || digits.length > 15) return null;
  return `NCB-${digits.padStart(10, "0")}`;
}

// ---- Login de consultor (PÚBLICO, rate-limited) -----------------------------
consultorRouter.post("/consultor/login", async (req: Request, res: Response) => {
  if (isRateLimited(req)) {
    res.status(429).json({ message: "Demasiados intentos. Espera un minuto." });
    return;
  }
  const { accountId, tipo, password } = (req.body ?? {}) as {
    accountId?: string;
    tipo?: string;
    password?: string;
  };
  if (!accountId || !password || (tipo !== "soporte" && tipo !== "admin")) {
    res.status(400).json({ message: "Datos incompletos." });
    return;
  }
  if (tipo === "admin") {
    res.status(403).json({ message: "El acceso Administrador NextCob está reservado." });
    return;
  }

  const genericError = () =>
    res.status(401).json({ message: "Cuenta o contraseña de consultor incorrecta." });

  const normalizado = normalizarAccountId(accountId);
  if (!normalizado) {
    genericError();
    return;
  }

  try {
    await cerrarSesionesExpiradas().catch(() => {});
    const [cliente] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.accountId, normalizado));
    if (!cliente || !cliente.activo) {
      genericError();
      return;
    }

    // Verifica la contraseña contra los consultores activos del tipo pedido.
    const consultores = await db
      .select()
      .from(consultoresTable)
      .where(and(eq(consultoresTable.activo, true), eq(consultoresTable.tipo, tipo)));
    let consultor: typeof consultores[number] | null = null;
    for (const c of consultores) {
      if (await verifyPassword(password, c.passwordHash)) {
        consultor = c;
        break;
      }
    }
    if (!consultor) {
      genericError();
      return;
    }

    // Registro de auditoría de la sesión (Ley 21.719).
    const inicio = new Date();
    const [sesion] = await db
      .insert(consultorSesionesTable)
      .values({
        consultorId: consultor.id,
        consultorNombre: consultor.nombre,
        userId: cliente.id,
        accountId: cliente.accountId,
        inicioEn: inicio,
      })
      .returning({ id: consultorSesionesTable.id });

    const sid = await createSession(
      {
        user: {
          id: cliente.id,
          email: cliente.email,
          firstName: cliente.firstName,
          lastName: cliente.lastName,
          profileImageUrl: cliente.profileImageUrl,
        },
        consultor: {
          sesionId: sesion!.id,
          consultorId: consultor.id,
          nombre: consultor.nombre,
          tipo: consultor.tipo,
          inicioEn: inicio.toISOString(),
        },
      },
      // Sesiones de consultor cortas: 8 horas máximo.
      Math.min(SESSION_TTL, 8 * 60 * 60 * 1000),
    );
    setSessionCookie(res, sid, 8 * 60 * 60 * 1000);
    req.log.info(
      { consultorId: consultor.id, cuenta: cliente.accountId },
      "Sesión de consultor iniciada",
    );
    res.json({
      success: true,
      cuenta: {
        accountId: cliente.accountId,
        nombre:
          [cliente.firstName, cliente.lastName].filter(Boolean).join(" ") ||
          cliente.companyName ||
          cliente.email,
      },
      consultor: { nombre: consultor.nombre, inicioEn: inicio.toISOString() },
    });
  } catch (err) {
    req.log.error({ err }, "Error en login de consultor");
    res.status(500).json({ message: "Error interno." });
  }
});

// ---- Cierre de sesión de consultor ------------------------------------------
consultorRouter.post("/consultor/logout", async (req: Request, res: Response) => {
  if (!req.consultor) {
    res.status(400).json({ message: "No hay una sesión de consultor activa." });
    return;
  }
  try {
    await db
      .update(consultorSesionesTable)
      .set({ finEn: new Date() })
      .where(
        and(
          eq(consultorSesionesTable.id, req.consultor.sesionId),
          sql`${consultorSesionesTable.finEn} is null`,
        ),
      );
    await clearSession(res, getSessionId(req));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error cerrando sesión de consultor");
    res.status(500).json({ message: "Error interno." });
  }
});

// ---- El cliente ve los accesos de soporte a SU cuenta (Ley 21.719) ----------
consultorRouter.get("/consultor/mis-accesos", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ message: "No autorizado" });
    return;
  }
  try {
    await cerrarSesionesExpiradas().catch(() => {});
    const sesiones = await db
      .select({
        id: consultorSesionesTable.id,
        consultorNombre: consultorSesionesTable.consultorNombre,
        inicioEn: consultorSesionesTable.inicioEn,
        finEn: consultorSesionesTable.finEn,
        acciones: sql<number>`(select count(*)::int from ${consultorAccionesTable} where ${consultorAccionesTable.sesionId} = ${consultorSesionesTable.id})`,
      })
      .from(consultorSesionesTable)
      .where(eq(consultorSesionesTable.userId, req.user.id))
      .orderBy(desc(consultorSesionesTable.inicioEn))
      .limit(50);
    res.json({
      sesiones: sesiones.map((s) => ({
        ...s,
        inicioEn: s.inicioEn.toISOString(),
        finEn: s.finEn ? s.finEn.toISOString() : null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Error listando accesos de consultor");
    res.status(500).json({ message: "Error interno." });
  }
});

// ---- Superadmin: gestión de consultores y auditoría global ------------------
consultorRouter.get(
  "/consultor/consultores",
  requireAdmin,
  async (req: Request, res: Response) => {
    const rows = await db
      .select({
        id: consultoresTable.id,
        nombre: consultoresTable.nombre,
        tipo: consultoresTable.tipo,
        activo: consultoresTable.activo,
        creadoEn: consultoresTable.creadoEn,
      })
      .from(consultoresTable)
      .orderBy(desc(consultoresTable.creadoEn));
    res.json({
      consultores: rows.map((c) => ({ ...c, creadoEn: c.creadoEn.toISOString() })),
    });
  },
);

consultorRouter.post(
  "/consultor/consultores",
  requireAdmin,
  async (req: Request, res: Response) => {
    const { nombre } = (req.body ?? {}) as { nombre?: string };
    if (!nombre || !nombre.trim()) {
      res.status(400).json({ message: "El nombre del consultor es obligatorio." });
      return;
    }
    // Contraseña segura generada en el servidor; se muestra UNA sola vez.
    const password = crypto.randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(password);
    const [row] = await db
      .insert(consultoresTable)
      .values({ nombre: nombre.trim(), tipo: "soporte", passwordHash })
      .returning({ id: consultoresTable.id, nombre: consultoresTable.nombre });
    req.log.info({ consultorId: row!.id }, "Consultor creado");
    res.status(201).json({ id: row!.id, nombre: row!.nombre, password });
  },
);

consultorRouter.patch(
  "/consultor/consultores/:id",
  requireAdmin,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { activo } = (req.body ?? {}) as { activo?: boolean };
    if (!Number.isFinite(id) || typeof activo !== "boolean") {
      res.status(400).json({ message: "Datos inválidos." });
      return;
    }
    const [row] = await db
      .update(consultoresTable)
      .set({ activo })
      .where(eq(consultoresTable.id, id))
      .returning({ id: consultoresTable.id, activo: consultoresTable.activo });
    if (!row) {
      res.status(404).json({ message: "Consultor no encontrado." });
      return;
    }
    res.json(row);
  },
);

consultorRouter.get(
  "/consultor/sesiones",
  requireAdmin,
  async (req: Request, res: Response) => {
    await cerrarSesionesExpiradas().catch(() => {});
    const sesiones = await db
      .select({
        id: consultorSesionesTable.id,
        consultorNombre: consultorSesionesTable.consultorNombre,
        userId: consultorSesionesTable.userId,
        accountId: consultorSesionesTable.accountId,
        inicioEn: consultorSesionesTable.inicioEn,
        finEn: consultorSesionesTable.finEn,
        clienteNombre: sql<string | null>`(select coalesce(nullif(trim(concat(${usersTable.firstName}, ' ', ${usersTable.lastName})), ''), ${usersTable.email}) from ${usersTable} where ${usersTable.id} = ${consultorSesionesTable.userId})`,
        acciones: sql<number>`(select count(*)::int from ${consultorAccionesTable} where ${consultorAccionesTable.sesionId} = ${consultorSesionesTable.id})`,
      })
      .from(consultorSesionesTable)
      .orderBy(desc(consultorSesionesTable.inicioEn))
      .limit(200);
    res.json({
      sesiones: sesiones.map((s) => ({
        ...s,
        inicioEn: s.inicioEn.toISOString(),
        finEn: s.finEn ? s.finEn.toISOString() : null,
      })),
    });
  },
);

consultorRouter.get(
  "/consultor/sesiones/:id/acciones",
  requireAdmin,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "ID inválido." });
      return;
    }
    const acciones = await db
      .select()
      .from(consultorAccionesTable)
      .where(eq(consultorAccionesTable.sesionId, id))
      .orderBy(desc(consultorAccionesTable.fecha))
      .limit(500);
    res.json({
      acciones: acciones.map((a) => ({ ...a, fecha: a.fecha.toISOString() })),
    });
  },
);

export default consultorRouter;
