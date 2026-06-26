import { LegalLayout, LegalSection } from "@/components/legal-layout";

export default function TerminosPage() {
  return (
    <LegalLayout title="Términos y Condiciones de Uso" updatedAt="26 de junio de 2026">
      <p>
        Estos Términos y Condiciones regulan el uso de la plataforma NextCob
        (en adelante, el "Servicio"). Al crear una cuenta o utilizar el
        Servicio, aceptas estos Términos y nuestra{" "}
        <a href="/privacidad" className="text-primary hover:underline">
          Política de Privacidad
        </a>
        . Si no estás de acuerdo, no debes utilizar el Servicio.
      </p>

      <LegalSection title="1. Descripción del Servicio">
        <p>
          NextCob es una plataforma para la gestión y cobranza de pagos en
          Chile. Permite crear cobros, generar links de pago, enviar
          recordatorios y comprobantes, administrar clientes y visualizar
          informes. NextCob es una herramienta de gestión; no es un banco ni una
          institución financiera, y no garantiza el pago por parte de tus
          deudores.
        </p>
      </LegalSection>

      <LegalSection title="2. Registro y cuenta">
        <p>
          Para usar el Servicio debes registrarte con datos verídicos,
          completos y actualizados, incluyendo un RUT válido. Eres responsable
          de mantener la confidencialidad de tu contraseña y de toda actividad
          realizada desde tu cuenta. Debes notificarnos de inmediato ante
          cualquier uso no autorizado.
        </p>
      </LegalSection>

      <LegalSection title="3. Prueba gratuita y suscripción">
        <p>
          Ofrecemos un período de prueba gratuito de 14 días por cada RUT, por
          una única vez. Finalizado el período de prueba, el uso continuo del
          Servicio requiere una suscripción de pago vigente. Los precios se
          informan dentro de la plataforma e incluyen IVA cuando corresponde.
          Podemos modificar los precios avisándote con anticipación razonable.
        </p>
      </LegalSection>

      <LegalSection title="4. Uso aceptable">
        <p>Al utilizar el Servicio te comprometes a no:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Usar el Servicio para fines ilícitos o fraudulentos.</li>
          <li>
            Ingresar datos de terceros sin contar con la base legal o el
            consentimiento necesario para tratarlos.
          </li>
          <li>
            Realizar cobranzas que infrinjan la legislación vigente o que sean
            abusivas, hostigadoras o engañosas.
          </li>
          <li>
            Intentar vulnerar la seguridad de la plataforma, acceder a cuentas
            ajenas o interferir con su funcionamiento.
          </li>
        </ul>
        <p>
          Eres el único responsable del contenido y de los datos que ingresas, y
          de su tratamiento conforme a la Ley N° 21.719 respecto de tus propios
          clientes y deudores.
        </p>
      </LegalSection>

      <LegalSection title="5. Pagos y proveedores externos">
        <p>
          Los pagos en línea se procesan a través de proveedores externos como
          Flow y MercadoPago. El uso de esos servicios está sujeto a sus propios
          términos y condiciones. NextCob no es responsable por fallas,
          retrasos o decisiones de dichos proveedores.
        </p>
      </LegalSection>

      <LegalSection title="6. Propiedad intelectual">
        <p>
          El Servicio, su marca, diseño y software son propiedad de NextCob o de
          sus licenciantes. No se te concede ningún derecho sobre ellos salvo la
          licencia limitada, no exclusiva e intransferible de usar el Servicio
          conforme a estos Términos. Los datos que ingresas siguen siendo tuyos.
        </p>
      </LegalSection>

      <LegalSection title="7. Disponibilidad y limitación de responsabilidad">
        <p>
          Nos esforzamos por mantener el Servicio disponible y seguro, pero se
          presta "tal cual" y "según disponibilidad". En la medida permitida por
          la ley, NextCob no será responsable por daños indirectos, lucro
          cesante o pérdida de datos derivados del uso o la imposibilidad de uso
          del Servicio.
        </p>
      </LegalSection>

      <LegalSection title="8. Terminación">
        <p>
          Puedes dejar de usar el Servicio y eliminar tu cuenta en cualquier
          momento desde tu perfil, en la sección "Mis datos y privacidad".
          Podemos suspender o terminar tu cuenta si incumples estos Términos o
          si lo exige la ley. Al eliminar tu cuenta se borran de forma
          permanente tus datos, según se describe en la Política de Privacidad.
        </p>
      </LegalSection>

      <LegalSection title="9. Ley aplicable">
        <p>
          Estos Términos se rigen por la legislación de la República de Chile.
          Cualquier controversia se someterá a los tribunales competentes de
          Chile.
        </p>
      </LegalSection>

      <LegalSection title="10. Contacto">
        <p>
          Para cualquier consulta sobre estos Términos, escríbenos a{" "}
          <a
            href="mailto:contacto@nextcob.com"
            className="text-primary hover:underline"
          >
            contacto@nextcob.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
