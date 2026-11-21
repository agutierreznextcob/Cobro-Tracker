import { Link } from "wouter";
import { FileText, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SUB_MODULES = [
  {
    href: "/configuracion/ventas/documentos",
    icon: FileText,
    title: "Configuración de Documento",
    description: "Personaliza el nombre, activa o desactiva documentos de venta (boleta, factura, nota de crédito, etc.) y configura si actualizan el stock.",
  },
];

export default function ConfiguracionVentas() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 py-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Configuración de Ventas</h1>
        <p className="text-muted-foreground mt-1">
          Administra los parámetros de ventas de tu negocio.
        </p>
      </div>

      <div className="grid gap-3">
        {SUB_MODULES.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href}>
            <Card className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/30">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-base">{title}</CardTitle>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{description}</CardDescription>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
