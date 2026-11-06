---
name: Perfil de empresa y documentos
description: Identidad compartida por negocio, documentos históricos y propiedad de los logos.
---

El perfil, logo, plantilla y color primario pertenecen al negocio, no a cada ejecutivo. El color del negocio personaliza cotizaciones y cobros; no reemplaza la identidad de NextCob en la plataforma o landing.
**Why:** el usuario pidió una configuración de empresa reutilizada automáticamente en los PDF, con tres plantillas y azul #2563EB como color inicial.
**How to apply:** permitir lectura a miembros de la organización y edición a su administrador; resolver el perfil por la organización guardada en el documento, no por una organización distinta a la que posteriormente se mueva su responsable.

Cambiar la presentación no cambia importes, moneda, precisión, fechas ni estados históricos. La fecha de vencimiento guardada es la referencia para expresar la validez de una cotización anterior a los campos comerciales.
**Why:** los documentos existentes deben conservar su contenido financiero; el nuevo default de 30 días no representa necesariamente su vencimiento original.
**How to apply:** usar los importes almacenados y el mismo generador para descarga, vista previa y PDF adjunto al email. Un cobro sigue siendo un cobro, no un DTE certificado por SII.

Los logos son privados, limitados a JPG/PNG de hasta 2 MB al subir, y se copian a una ubicación validada distinta de la URL de carga.
**Why:** una URL de carga sigue pudiendo sobrescribir el objeto temporal hasta expirar; referenciar ese objeto directamente permitiría sustituir el logo después de validarlo.
**How to apply:** verificar propiedad por negocio, decodificar y normalizar los bytes antes de guardar la referencia; nunca aceptar una URL externa como logo del PDF. La limpieza futura debe considerar referencias activas de desarrollo y producción antes de borrar archivos compartidos.
