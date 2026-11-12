import {
  BarChart3,
  Bot,
  Building2,
  FileText,
  Package,
  Receipt,
  Settings2,
  ShoppingCart,
  Star,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type Module = {
  id: string;
  code: string;
  name: string;
  short: string;
  group: "Vender" | "Abastecer" | "Medir" | "Configurar";
  icon: LucideIcon;
  points: string[];
  note?: string;
};

/** Source of truth: api-server/src/lib/diana-product-context.ts */
export const MODULES: Module[] = [
  {
    id: "cobros",
    code: "01",
    name: "Ventas y Cobros",
    short: "Cobros con vencimiento, abonos, descuentos, recordatorios y links de pago.",
    group: "Vender",
    icon: Receipt,
    points: [
      "Nuevo cobro, listado y búsqueda agrupados bajo Ventas",
      "Vencimientos, pagos parciales y abonos con saldo al día",
      "Descuentos e IVA opcional por cobro",
      "Recordatorios y links de pago",
      "Flow/Webpay, MercadoPago y datos bancarios según tu configuración",
    ],
  },
  {
    id: "cotizaciones",
    code: "02",
    name: "Cotizaciones",
    short: "Documentos con productos, servicios y líneas libres que se convierten en cobro.",
    group: "Vender",
    icon: FileText,
    points: [
      "Productos, servicios y líneas libres en un mismo documento",
      "Cantidades, descuentos, IVA y moneda por documento",
      "Condiciones comerciales, envío al cliente y PDF",
      "Conversión directa de cotización a cobro",
    ],
    note: "La aceptación la registra tu equipo; no hay aceptación automática del cliente.",
  },
  {
    id: "clientes",
    code: "03",
    name: "Clientes",
    short: "Fichas con RUT, giro, contacto e historial de pago.",
    group: "Vender",
    icon: Users,
    points: [
      "Datos de contacto, RUT y giro",
      "Historial de cobros y seguimiento",
      "Comportamiento de pago de cada cliente",
    ],
  },
  {
    id: "inventario",
    code: "04",
    name: "Inventario",
    short: "Catálogo, existencias, stock crítico, pistola lectora y calculadora de precios.",
    group: "Abastecer",
    icon: Package,
    points: [
      "Catálogo de productos y servicios con existencias y movimientos",
      "Stock crítico e historial de costos",
      "Pistola lectora / lector de códigos de barras para buscar y seleccionar productos",
      "Calculadora de precios: costo unitario, margen, utilidad, IVA configurable y PVP sugerido por proveedor, con o sin IVA",
      "Márgenes comparados siempre sobre valores netos",
    ],
    note: "Al recibir una compra se actualiza el costo y la sugerencia de precio; tu precio de venta vigente no cambia solo.",
  },
  {
    id: "locales",
    code: "05",
    name: "Locales y Bodegas",
    short: "Existencias por ubicación y traslados entre bodegas.",
    group: "Abastecer",
    icon: Warehouse,
    points: [
      "Gestión de locales y bodegas",
      "Existencias separadas por ubicación",
      "Traslados entre bodegas (un traslado no es una venta)",
    ],
  },
  {
    id: "compras",
    code: "06",
    name: "Compras y Proveedores",
    short: "Módulo independiente: facturas, ítems, recepción y actualización de stock y costos.",
    group: "Abastecer",
    icon: ShoppingCart,
    points: [
      "Proveedores con su historial de compras",
      "Facturas e ítems con costos netos, sin IVA",
      "Recepción de mercadería que actualiza stock y costos",
      "Confirmación de recepciones por administradores y supervisores",
    ],
    note: "No incluye integración automática con el SII.",
  },
  {
    id: "informes",
    code: "07",
    name: "Informes",
    short: "Ventas, Compras e Inventario con filtros y exportación a Excel.",
    group: "Medir",
    icon: BarChart3,
    points: [
      "Ventas: resumen, cuentas por cobrar, ranking de clientes, gestiones, recurrentes, más vendidos y menor movimiento",
      "Compras: resumen, compras por proveedor y cuentas por pagar",
      "Inventario: más vendidos, rotación, stock valorizado por local/bodega y quiebres de stock",
      "Filtros y exportación a Excel",
      "Importes analizados por moneda, sin mezclar monedas",
    ],
  },
  {
    id: "satisfaccion",
    code: "08",
    name: "Satisfacción",
    short: "Encuestas post-pago, comentarios privados e invitación a Google Reviews.",
    group: "Medir",
    icon: Star,
    points: [
      "Encuestas después del pago con calificación y comentario",
      "Comentarios privados que se quedan en NextCob",
      "Invitación voluntaria a Google Reviews para todas las calificaciones, no solo las altas",
      "Registro del clic explícito hacia Google",
    ],
    note: "El resumen cuenta clientes únicos que hicieron clic, no reseñas publicadas.",
  },
  {
    id: "configuracion",
    code: "09",
    name: "Configuración",
    short: "Empresa, logo, plantillas PDF, preferencias globales e indicadores UF/UTM/USD/EUR.",
    group: "Configurar",
    icon: Settings2,
    points: [
      "Perfil de empresa y logo para tus documentos",
      "Plantillas PDF con vista previa",
      "Preferencias globales: moneda, decimales, IVA, formato de fecha y prefijos",
      "UF, UTM, dólar y euro automáticos con equivalencias informativas en CLP",
    ],
    note: "Se muestran los últimos valores publicados por mindicador.cl, no cotizaciones en tiempo real. Las plantillas PDF son presentación visual, no emisión tributaria certificada.",
  },
  {
    id: "diana",
    code: "10",
    name: "Diana",
    short: "Asistente que orienta y analiza con los datos autorizados.",
    group: "Configurar",
    icon: Bot,
    points: [
      "Explica dónde está cada función y cómo usarla",
      "Analiza la información de tu negocio que tiene autorizada",
      "Indica cuando le falta información en vez de inventarla",
    ],
    note: "Diana guía y analiza; no ejecuta por sí sola todas las acciones del sistema.",
  },
];

export const GROUPS: { name: Module["group"]; line: string; icon: LucideIcon }[] = [
  { name: "Vender", line: "Cotiza, cobra y conoce a tus clientes", icon: Receipt },
  { name: "Abastecer", line: "Compra, recibe y controla el stock", icon: Building2 },
  { name: "Medir", line: "Informes y satisfacción por área", icon: BarChart3 },
  { name: "Configurar", line: "Tu empresa, tus documentos, tus reglas", icon: Settings2 },
];
