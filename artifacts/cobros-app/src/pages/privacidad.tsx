import { LegalLayout, LegalSection } from "@/components/legal-layout";

export default function PrivacidadPage() {
  return (
    <LegalLayout title="Política de Privacidad" updatedAt="26 de junio de 2026">
      <p>
        En NextCob nos comprometemos a proteger tus datos personales de acuerdo
        con la Ley N° 21.719 que regula la protección y el tratamiento de los
        datos personales en Chile. Esta Política explica qué datos recopilamos,
        para qué los usamos, por cuánto tiempo los conservamos, con quiénes los
        compartimos y cómo puedes ejercer tus derechos.
      </p>

      <LegalSection title="1. Quién es el responsable de tus datos">
        <p>
          El responsable del tratamiento de los datos personales es NextCob
          (en adelante, "NextCob", "nosotros"). Para cualquier consulta
          relacionada con tus datos personales o esta Política, puedes
          escribirnos a{" "}
          <a
            href="mailto:contacto@nextcob.com"
            className="text-primary hover:underline"
          >
            contacto@nextcob.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. Qué datos recopilamos">
        <p>Recopilamos las siguientes categorías de datos personales:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            <strong>Datos de la cuenta:</strong> nombre, RUT, correo
            electrónico, contraseña (almacenada de forma cifrada), teléfono,
            dirección y nombre de empresa.
          </li>
          <li>
            <strong>Datos de tus clientes y cobros:</strong> nombre, RUT,
            correo, teléfono de tus deudores, montos, fechas de vencimiento,
            estado de pago y comprobantes que tú ingresas para gestionar tus
            cobranzas.
          </li>
          <li>
            <strong>Datos de pago de tu suscripción:</strong> gestionados por
            nuestros proveedores de pago; NextCob no almacena los datos
            completos de tu tarjeta.
          </li>
          <li>
            <strong>Datos técnicos:</strong> registros de acceso, dirección IP,
            tipo de dispositivo y navegador, necesarios para la seguridad y el
            funcionamiento del servicio.
          </li>
          <li>
            <strong>Comunicaciones:</strong> mensajes que intercambias con
            nuestro asistente o soporte.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Para qué usamos tus datos">
        <p>Tratamos tus datos personales con las siguientes finalidades:</p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>Crear y administrar tu cuenta y autenticarte de forma segura.</li>
          <li>
            Prestar el servicio de gestión de cobros: emitir links de pago,
            enviar recordatorios y comprobantes, y mostrar informes.
          </li>
          <li>Procesar el cobro de tu suscripción.</li>
          <li>
            Enviarte comunicaciones operativas (verificación de correo,
            recuperación de contraseña, notificaciones del servicio).
          </li>
          <li>Prevenir fraudes y abusos, y cumplir obligaciones legales.</li>
          <li>Mejorar y mantener la seguridad de la plataforma.</li>
        </ul>
        <p>
          La base de licitud del tratamiento es la ejecución del contrato de
          prestación del servicio, tu consentimiento (otorgado al registrarte),
          el interés legítimo en la seguridad de la plataforma y el cumplimiento
          de obligaciones legales.
        </p>
      </LegalSection>

      <LegalSection title="4. Por cuánto tiempo conservamos tus datos">
        <p>
          Conservamos tus datos mientras tu cuenta se encuentre activa. Si
          eliminas tu cuenta, borraremos de forma permanente tus datos
          personales y los de tus clientes y cobros asociados, salvo aquella
          información que debamos conservar por obligaciones legales,
          tributarias o contables, o para la prevención de fraude (por ejemplo,
          el registro de que un RUT ya utilizó su período de prueba gratuito).
          Los registros técnicos se conservan por plazos acotados con fines de
          seguridad.
        </p>
      </LegalSection>

      <LegalSection title="5. Con quién compartimos tus datos">
        <p>
          No vendemos tus datos personales. Los compartimos únicamente con
          proveedores que nos ayudan a prestar el servicio (encargados de
          tratamiento), bajo obligaciones de confidencialidad y seguridad:
        </p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            <strong>Resend:</strong> envío de correos electrónicos
            (verificación, recuperación de contraseña, recordatorios y
            comprobantes).
          </li>
          <li>
            <strong>Groq:</strong> procesamiento de las consultas que realizas a
            nuestro asistente de inteligencia artificial.
          </li>
          <li>
            <strong>Flow:</strong> procesamiento de pagos en línea y de tu
            suscripción.
          </li>
          <li>
            <strong>MercadoPago:</strong> procesamiento de pagos en línea de tus
            cobros (cuando lo configuras).
          </li>
        </ul>
        <p>
          Algunos de estos proveedores pueden tratar datos fuera de Chile. En
          esos casos adoptamos resguardos para que tus datos mantengan un nivel
          adecuado de protección.
        </p>
      </LegalSection>

      <LegalSection title="6. Tus derechos (derechos ARCO)">
        <p>
          Conforme a la Ley N° 21.719, puedes ejercer en cualquier momento los
          siguientes derechos sobre tus datos personales:
        </p>
        <ul className="list-disc pl-6 space-y-1.5">
          <li>
            <strong>Acceso:</strong> conocer qué datos tuyos tratamos. Puedes
            descargar una copia de tus datos desde tu perfil, en la sección "Mis
            datos y privacidad".
          </li>
          <li>
            <strong>Rectificación:</strong> corregir datos inexactos o
            desactualizados, desde tu perfil o escribiéndonos.
          </li>
          <li>
            <strong>Cancelación (supresión):</strong> eliminar tus datos. Puedes
            eliminar tu cuenta y todos tus datos de forma permanente desde tu
            perfil, en "Mis datos y privacidad".
          </li>
          <li>
            <strong>Oposición:</strong> oponerte a determinados tratamientos de
            tus datos.
          </li>
        </ul>
        <p>
          También puedes solicitar la portabilidad de tus datos y revocar tu
          consentimiento. Para ejercer estos derechos escríbenos a{" "}
          <a
            href="mailto:contacto@nextcob.com"
            className="text-primary hover:underline"
          >
            contacto@nextcob.com
          </a>
          . Responderemos en los plazos que establece la ley. Si consideras que
          tus derechos no fueron respetados, puedes recurrir ante la autoridad
          de protección de datos competente.
        </p>
      </LegalSection>

      <LegalSection title="7. Seguridad de la información">
        <p>
          Aplicamos medidas técnicas y organizativas para proteger tus datos:
          cifrado de contraseñas y credenciales sensibles, conexiones seguras,
          control de acceso por roles y bloqueo de cuenta tras múltiples
          intentos fallidos de inicio de sesión. Ningún sistema es
          completamente infalible, pero trabajamos para resguardar tu
          información.
        </p>
      </LegalSection>

      <LegalSection title="8. Cambios en esta Política">
        <p>
          Podemos actualizar esta Política para reflejar cambios legales o del
          servicio. Cuando los cambios sean relevantes, te lo informaremos por
          los medios disponibles. La fecha de la última actualización aparece al
          inicio de este documento.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
