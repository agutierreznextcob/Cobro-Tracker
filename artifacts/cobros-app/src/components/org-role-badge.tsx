const ROLE_META: Record<string, { label: string; bg: string; fg: string }> = {
  admin_org: { label: "Administrador de organización", bg: "#F4A800", fg: "#3A2A00" },
  gerente:   { label: "Gerente", bg: "#1E3A5F", fg: "#FFFFFF" },
  supervisor: { label: "Supervisor", bg: "#1A1333", fg: "#FFFFFF" },
  ejecutivo: { label: "Ejecutivo de cobranza", bg: "#666666", fg: "#FFFFFF" },
};

export function orgRoleLabel(orgRole?: string | null): string | null {
  return orgRole ? (ROLE_META[orgRole]?.label ?? null) : null;
}

/** Badge visual del cargo organizacional (Admin dorado, Supervisor azul oscuro, Ejecutivo gris). */
export function OrgRoleBadge({
  orgRole,
  short = false,
  className = "",
}: {
  orgRole?: string | null;
  short?: boolean;
  className?: string;
}) {
  const meta = orgRole ? ROLE_META[orgRole] : undefined;
  if (!meta) return null;
  const label = short
    ? orgRole === "admin_org"
      ? "Administrador"
      : orgRole === "gerente"
        ? "Gerente"
        : orgRole === "supervisor"
          ? "Supervisor"
          : orgRole === "ejecutivo"
            ? "Ejecutivo"
            : meta.label
    : meta.label;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${className}`}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
    >
      {label}
    </span>
  );
}
