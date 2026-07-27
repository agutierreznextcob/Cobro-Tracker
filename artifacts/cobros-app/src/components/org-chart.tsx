import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network } from "lucide-react";
import { OrgRoleBadge } from "@/components/org-role-badge";

type Miembro = {
  id: string;
  nombre?: string | null;
  email?: string | null;
  orgRole?: string | null;
  supervisorId?: string | null;
  activo?: boolean;
};

function NodeCard({ m }: { m: Miembro }) {
  return (
    <div
      className={`rounded-lg border border-border/60 bg-card px-3 py-2 shadow-sm min-w-[220px] ${
        m.activo === false ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold truncate">{m.nombre ?? m.email ?? "—"}</p>
        <Badge
          variant="outline"
          className={`text-[10px] shrink-0 ${
            m.activo === false
              ? "border-destructive/40 text-destructive"
              : "border-emerald-300 text-emerald-700"
          }`}
        >
          {m.activo === false ? "Inactivo" : "Activo"}
        </Badge>
      </div>
      <div className="mt-1">
        <OrgRoleBadge orgRole={m.orgRole} short />
      </div>
      {m.email && <p className="mt-1 text-xs text-muted-foreground truncate">{m.email}</p>}
    </div>
  );
}

function Branch({ nodo, hijos }: { nodo: Miembro; hijos: (m: Miembro) => Miembro[] }) {
  const children = hijos(nodo);
  return (
    <div>
      <NodeCard m={nodo} />
      {children.length > 0 && (
        <div className="ml-5 mt-2 space-y-2 border-l-2 border-border/60 pl-4">
          {children.map((c) => (
            <Branch key={c.id} nodo={c} hijos={hijos} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Organigrama jerárquico de la organización (Admin → Supervisores → Ejecutivos).
 * Solo se renderiza para el Administrador de la organización; el backend además
 * limita los datos de /organization/usuarios según el rol del solicitante.
 */
export function OrgChart({ miembros }: { miembros: Miembro[] }) {
  const { raices, hijosDe, huerfanos } = useMemo(() => {
    const admins = miembros.filter((m) => m.orgRole === "admin_org");
    // Anclamos supervisores/ejecutivos sin supervisor bajo un único admin
    // determinista (el "principal": primer admin activo, orden alfabético)
    // para que con varios admins el árbol no reparta ramas arbitrariamente.
    const adminPrincipal =
      [...admins].sort(
        (a, b) =>
          Number(b.activo !== false) - Number(a.activo !== false) ||
          (a.nombre ?? "").localeCompare(b.nombre ?? ""),
      )[0] ?? null;
    // Un ejecutivo solo cuelga de su supervisorId si ese miembro es realmente
    // un supervisor; relaciones inválidas se muestran como inconsistencias en
    // vez de normalizarse en silencio.
    const supervisoresValidos = new Set(
      miembros.filter((m) => m.orgRole === "supervisor").map((m) => m.id),
    );
    const porPadre = new Map<string, Miembro[]>();
    const sueltos: Miembro[] = [];
    for (const m of miembros) {
      if (m.orgRole === "admin_org") continue;
      let parent: string | undefined;
      if (m.orgRole === "supervisor") {
        parent = adminPrincipal?.id;
      } else if (m.supervisorId && supervisoresValidos.has(m.supervisorId)) {
        parent = m.supervisorId;
      } else if (!m.supervisorId) {
        // Ejecutivo sin supervisor asignado: cuelga del nivel admin.
        parent = adminPrincipal?.id;
      }
      if (!parent) {
        sueltos.push(m);
        continue;
      }
      porPadre.set(parent, [...(porPadre.get(parent) ?? []), m]);
    }
    const orden = (a: Miembro, b: Miembro) => {
      const peso = (r?: string | null) => (r === "supervisor" ? 0 : 1);
      return peso(a.orgRole) - peso(b.orgRole) || (a.nombre ?? "").localeCompare(b.nombre ?? "");
    };
    for (const lista of porPadre.values()) lista.sort(orden);
    sueltos.sort(orden);
    return {
      raices: admins,
      hijosDe: (m: Miembro) => porPadre.get(m.id) ?? [],
      huerfanos: sueltos,
    };
  }, [miembros]);

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="bg-muted/20 border-b border-border/50">
        <CardTitle className="flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          Organigrama del equipo
        </CardTitle>
        <CardDescription>
          Estructura jerárquica de tu organización: Administrador, Supervisores y Ejecutivos.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-2">
        {raices.length === 0 && huerfanos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay miembros en la organización.</p>
        ) : (
          <>
            {raices.map((r) => (
              <Branch key={r.id} nodo={r} hijos={hijosDe} />
            ))}
            {huerfanos.length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  Sin ubicación en la jerarquía (supervisor inválido o sin administrador)
                </p>
                <div className="space-y-2">
                  {huerfanos.map((m) => (
                    <NodeCard key={m.id} m={m} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <p className="pt-4 text-[11px] leading-snug text-muted-foreground border-t border-border/50 mt-4">
          Los datos mostrados corresponden a miembros de tu organización y son tratados conforme a
          la Ley 21.719 de Protección de Datos Personales.
        </p>
      </CardContent>
    </Card>
  );
}
