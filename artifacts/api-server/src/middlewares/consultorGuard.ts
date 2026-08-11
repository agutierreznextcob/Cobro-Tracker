import { type Request, type Response, type NextFunction } from "express";
import { db, consultorAccionesTable } from "@workspace/db";

// Restricciones y auditoría para sesiones de consultor de soporte NextCob.
// Corre después de authMiddleware (montado global antes de /api en app.ts),
// por lo que las rutas llegan con el prefijo /api.
//
// El consultor puede operar la cuenta del cliente (cobros, recordatorios,
// workflows, informes) pero NO puede:
// - ver/cambiar la contraseña del cliente
// - ver/modificar credenciales de Flow/MercadoPago
// - ver/modificar datos bancarios
// - eliminar la cuenta ni exportar los datos completos del cliente (PII)
//
// IMPORTANTE: Express rutea case-insensitive y decodifica percent-encoding,
// así que la comparación se hace sobre el path canonicalizado (decodificado,
// en minúsculas, sin slashes duplicados ni trailing slash) y con límite de
// segmento (\/|$) para que /api/profile/Flow-Credentials o /x%2Dy no evadan
// el bloqueo.
const RUTAS_BLOQUEADAS: RegExp[] = [
  /^\/api\/auth\/change-password(\/|$)/,
  /^\/api\/auth\/forgot-password(\/|$)/,
  /^\/api\/auth\/reset-password(\/|$)/,
  /^\/api\/profile\/flow-credentials(\/|$)/,
  /^\/api\/profile\/mp-credentials(\/|$)/,
  /^\/api\/profile\/datos-bancarios(\/|$)/,
  /^\/api\/profile\/cuenta(\/|$)/,
  /^\/api\/profile\/exportar-datos(\/|$)/,
];

// Vistas auditadas: cualquier lectura de detalle de cobro/cliente, incluidos
// subrecursos (abonos, descuentos, historial, etc.).
const VISTAS_AUDITADAS = /^\/api\/(cobros|clientes|liquidaciones)\/\d+(\/|$)/;

const DESCRIPCIONES: Array<[RegExp, string]> = [
  [/^\/api\/cobros\/\d+\/abonos/, "Abonos de un cobro"],
  [/^\/api\/cobros\/\d+\/descuentos/, "Descuento de un cobro"],
  [/^\/api\/cobros\/\d+/, "Detalle de cobro"],
  [/^\/api\/cobros/, "Cobros"],
  [/^\/api\/clientes\/\d+/, "Detalle de cliente"],
  [/^\/api\/clientes/, "Clientes"],
  [/^\/api\/recordatorios/, "Recordatorios"],
  [/^\/api\/workflows/, "Workflows de cobranza"],
  [/^\/api\/gestiones/, "Gestiones"],
  [/^\/api\/tareas/, "Tareas"],
  [/^\/api\/profile/, "Perfil"],
];

function describir(metodo: string, ruta: string): string {
  const base = DESCRIPCIONES.find(([re]) => re.test(ruta))?.[1] ?? ruta;
  if (metodo === "GET") return `Vio: ${base}`;
  if (metodo === "POST") return `Creó/ejecutó: ${base}`;
  if (metodo === "PUT" || metodo === "PATCH") return `Editó: ${base}`;
  if (metodo === "DELETE") return `Eliminó: ${base}`;
  return `${metodo} ${base}`;
}

// Canonicaliza el path igual que lo vería el router de Express al matchear:
// decodificado, en minúsculas, sin // dobles ni trailing slash.
function canonicalizarPath(rawPath: string): string {
  let p = rawPath;
  try {
    p = decodeURIComponent(p);
  } catch {
    // path malformado: se compara tal cual (el router tampoco lo matcheará)
  }
  p = p.toLowerCase().replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

export function consultorGuard(req: Request, res: Response, next: NextFunction) {
  const consultor = req.consultor;
  if (!consultor) {
    next();
    return;
  }

  const ruta = canonicalizarPath(req.path);
  if (RUTAS_BLOQUEADAS.some((re) => re.test(ruta))) {
    res.status(403).json({
      message:
        "Acción no disponible en modo consultor: esta sección está protegida (credenciales, datos bancarios, privacidad y contraseña del cliente).",
    });
    return;
  }

  // Auditoría: toda mutación + lecturas de detalle. Se registra al terminar
  // la respuesta y solo si fue exitosa; fire-and-forget con catch.
  const esMutacion = req.method !== "GET";
  const esVistaAuditada = req.method === "GET" && VISTAS_AUDITADAS.test(ruta);
  if (esMutacion || esVistaAuditada) {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      db.insert(consultorAccionesTable)
        .values({
          sesionId: consultor.sesionId,
          metodo: req.method,
          ruta,
          detalle: describir(req.method, ruta),
        })
        .catch((err) => req.log.error({ err }, "No se pudo auditar acción de consultor"));
    });
  }

  next();
}
