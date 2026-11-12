import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { MarketingShell, usePageMeta, PageHeader, RegisterButton, ClosingBand } from "@/components/marketing/marketing-shell";

const STEPS = [
  { n: "01", t: "Configura tu empresa", d: "Datos, logo, plantillas PDF y preferencias globales: moneda, decimales, IVA, formato de fecha y prefijos. Los indicadores UF, UTM, dólar y euro se cargan solos con los últimos valores publicados.", where: "Configuración" },
  { n: "02", t: "Arma catálogo y ubicaciones", d: "Productos y servicios con stock crítico. Crea locales y bodegas, y mueve existencias con traslados que no cuentan como venta.", where: "Inventario · Locales y Bodegas" },
  { n: "03", t: "Compra a tus proveedores", d: "Registra facturas e ítems con costos netos. Al confirmar la recepción se actualizan stock, costo e historial, y la calculadora sugiere precio sin tocar tu precio vigente.", where: "Compras · Proveedores" },
  { n: "04", t: "Cotiza y convierte en cobro", d: "Arma cotizaciones con productos, servicios y líneas libres. Envíalas en PDF y, cuando tu equipo registre la aceptación, conviértelas en cobro.", where: "Cotizaciones · Clientes" },
  { n: "05", t: "Cobra y haz seguimiento", d: "Vencimientos, abonos, descuentos y recordatorios. Links de pago con Flow/Webpay o MercadoPago, o datos bancarios, según lo que configures.", where: "Ventas · Cobros" },
  { n: "06", t: "Mide y escucha", d: "Informes de Ventas, Compras e Inventario exportables a Excel. Encuestas post-pago con comentarios privados e invitación opcional a Google Reviews.", where: "Informes · Satisfacción" },
];

export default function ComoFuncionaPage() {
  usePageMeta(
    "Cómo funciona NextCob · De la compra al cobro",
    "El flujo de NextCob en seis pasos: configuración, inventario y bodegas, compras a proveedores, cotizaciones, cobros e informes.",
  );
  return (
    <MarketingShell>
      <PageHeader
        kicker="Cómo funciona"
        title={<>Del proveedor al cliente, <span className="text-[#0D6E6E]">sin cambiar de sistema.</span></>}
        lead="Seis pasos que siguen el recorrido real de la mercadería y del dinero en tu negocio."
      >
        <RegisterButton className="px-5 py-3" label="Comenzar prueba" />
      </PageHeader>

      <section>
        <ol className="max-w-7xl mx-auto">
          {STEPS.map((s, i) => (
            <li key={s.n} className="grid md:grid-cols-12 border-b nc-rule">
              <div className={`md:col-span-2 px-5 sm:px-8 pt-10 md:py-12 ${i % 2 ? "text-[#0D6E6E]" : "text-[#E86B2A]"}`}>
                <span className="nc-display text-5xl md:text-6xl">{s.n}</span>
              </div>
              <div className="md:col-span-6 px-5 sm:px-8 py-6 md:py-12">
                <h2 className="nc-display text-2xl sm:text-3xl">{s.t}</h2>
                <p className="mt-3 text-neutral-700 leading-relaxed max-w-xl">{s.d}</p>
              </div>
              <div className="md:col-span-4 px-5 sm:px-8 pb-10 md:py-12 md:border-l nc-rule">
                <p className="nc-kicker mb-2">Dónde</p>
                <p className="font-semibold">{s.where}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-[#FBFAF7] border-t border-[#0A0A0A]">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 py-16 grid md:grid-cols-12 gap-8">
          <div className="md:col-span-5">
            <p className="nc-kicker mb-3">Durante todo el recorrido</p>
            <h2 className="nc-display text-3xl sm:text-4xl">Diana te orienta.</h2>
          </div>
          <div className="md:col-span-7 border-l-4 border-[#F4A800] pl-6">
            <p className="text-neutral-700 leading-relaxed">
              Diana explica dónde está cada función y analiza los datos de tu negocio que tiene autorizados.
              Te dice cuando le falta información. No ejecuta sola todas las acciones: las decisiones
              y los registros los haces tú y tu equipo.
            </p>
            <Link href="/caracteristicas#diana" className="mt-5 inline-flex items-center gap-2 font-semibold text-[#0D6E6E] hover:text-[#E86B2A]">
              Ver detalle de Diana <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
      <ClosingBand />
    </MarketingShell>
  );
}
