import { Router } from "express";
import { db, usersTable, permisosUsuarioTable, type ModuloPermiso, type NivelPermiso } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgAdmin } from "../middlewares/requireOrgAdmin";
import { requireSubscription } from "../middlewares/requireSubscription";

const permisosRouter = Router();

// Todos los módulos disponibles para asignar permisos.
export const MODULOS_DISPONIBLES: ModuloPermiso[] = [
  "cobros",
  "clientes",
  "cotizaciones",
  "pedidos",
  "guias_despacho",
  "inventario",
  "compras",
  "proveedores",
  "informes",
  "workflows",
  "tareas",
  "configuracion",
];

// GET /api/permisos/usuarios
// Lista todos los miembros de la organización con sus permisos actuales.
// Solo admin_org puede consultar.
permisosRouter.get("/usuarios", requireSubscription, requireOrgAdmin, async (req, res) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId!;

    // Obtener todos los miembros activos de la organización.
    const miembros = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        email: usersTable.email,
        orgRole: usersTable.orgRole,
        activo: usersTable.activo,
      })
      .from(usersTable)
      .where(and(eq(usersTable.organizationId, orgId), eq(usersTable.activo, true)));

    // Obtener todos los permisos de la organización.
    const permisos = await db
      .select()
      .from(permisosUsuarioTable)
      .where(eq(permisosUsuarioTable.organizationId, String(orgId)));

    // Construir respuesta con permisos por usuario.
    const resultado = miembros.map((m) => {
      const permisosUsuario = permisos.filter((p) => p.userId === m.id);
      const permisosMap: Record<string, NivelPermiso> = {};
      for (const p of permisosUsuario) {
        permisosMap[p.modulo] = p.nivel;
      }
      return {
        ...m,
        permisos: permisosMap,
      };
    });

    res.json(resultado);
  } catch (err) {
    console.error("[permisos] GET /usuarios error:", err);
    res.status(500).json({ error: "Error al obtener usuarios y permisos." });
  }
});

// GET /api/permisos/mios
// Obtiene los permisos del usuario autenticado.
permisosRouter.get("/mios", requireSubscription, async (req, res) => {
  try {
    const user = req.user!;
    if (!user.organizationId) {
      return res.json({ orgRole: user.orgRole, permisos: {} });
    }

    const permisos = await db
      .select()
      .from(permisosUsuarioTable)
      .where(
        and(
          eq(permisosUsuarioTable.userId, user.id),
          eq(permisosUsuarioTable.organizationId, String(user.organizationId)),
        ),
      );

    const permisosMap: Record<string, NivelPermiso> = {};
    for (const p of permisos) {
      permisosMap[p.modulo] = p.nivel;
    }

    res.json({ orgRole: user.orgRole, permisos: permisosMap });
  } catch (err) {
    console.error("[permisos] GET /mios error:", err);
    res.status(500).json({ error: "Error al obtener permisos." });
  }
});

// PUT /api/permisos/usuario/:userId
// Reemplaza todos los permisos de un usuario.
// Body: { permisos: Record<ModuloPermiso, NivelPermiso | null> }
// Si el valor es null, elimina el permiso para ese módulo.
permisosRouter.put("/usuario/:userId", requireSubscription, requireOrgAdmin, async (req, res) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId!;
    const { userId } = req.params;
    const { permisos } = req.body as { permisos: Record<string, NivelPermiso | null> };

    if (!permisos || typeof permisos !== "object") {
      return res.status(400).json({ error: "Se requiere el objeto 'permisos'." });
    }

    // Verificar que el usuario objetivo pertenece a la organización.
    const [target] = await db
      .select({ id: usersTable.id, orgRole: usersTable.orgRole })
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.organizationId, orgId)));

    if (!target) {
      return res.status(404).json({ error: "Usuario no encontrado en la organización." });
    }

    // No se pueden cambiar permisos a otro admin_org.
    if (target.orgRole === "admin_org") {
      return res.status(400).json({ error: "No se pueden modificar permisos de un admin de organización." });
    }

    await db.transaction(async (tx) => {
      // Eliminar permisos existentes del usuario en esta org.
      await tx
        .delete(permisosUsuarioTable)
        .where(
          and(
            eq(permisosUsuarioTable.userId, userId),
            eq(permisosUsuarioTable.organizationId, String(orgId)),
          ),
        );

      // Insertar los nuevos permisos (solo los que no son null).
      const nuevos = Object.entries(permisos)
        .filter(([, nivel]) => nivel !== null)
        .filter(([modulo]) => MODULOS_DISPONIBLES.includes(modulo as ModuloPermiso))
        .map(([modulo, nivel]) => ({
          userId,
          organizationId: String(orgId),
          modulo: modulo as ModuloPermiso,
          nivel: nivel as NivelPermiso,
          asignadoPor: user.id,
        }));

      if (nuevos.length > 0) {
        await tx.insert(permisosUsuarioTable).values(nuevos);
      }
    });

    res.json({ ok: true, message: "Permisos actualizados correctamente." });
  } catch (err) {
    console.error("[permisos] PUT /usuario/:userId error:", err);
    res.status(500).json({ error: "Error al actualizar permisos." });
  }
});

export default permisosRouter;
