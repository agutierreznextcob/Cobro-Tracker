import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Installed before serving traffic. PostgreSQL makes stock and payment-state
 * changes one transaction across manual payments, abonos, Flow and MP webhooks.
 * A unique (charge, product) movement makes repeated callbacks harmless.
 */
export async function initializeInventarioTriggers() {
  // Extend the tipo_documento enum with all document types used by the frontend.
  // ALTER TYPE … ADD VALUE is idempotent in PG 12+ (IF NOT EXISTS).
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'boleta_manual';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'boleta_electronica';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'boleta_electronica_stock';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'factura_electronica';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'factura_electronica_stock';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'factura_no_afecta';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'liquidacion_factura';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'nota_credito';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'nota_credito_exenta';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'nota_credito_stock';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'nota_debito';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'nota_debito_exenta';
      ALTER TYPE tipo_documento ADD VALUE IF NOT EXISTS 'vale_comprobante';
    EXCEPTION WHEN others THEN NULL; END $$;
  `));

  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nextcob:inventario:triggers'))`);
    await tx.execute(sql.raw(`
      UPDATE productos SET codigo_interno = 'PROD-' || lpad(id::text, greatest(4, length(id::text)), '0')
        WHERE codigo_interno IS NULL OR codigo_interno = '';
      CREATE OR REPLACE FUNCTION validar_items_inventario() RETURNS trigger AS $$
      DECLARE item jsonb; product productos%ROWTYPE; seen integer[] := '{}';
      BEGIN
        IF TG_OP = 'UPDATE' AND NEW.items_inventario IS NOT DISTINCT FROM OLD.items_inventario THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND (OLD.estado = 'pagado' OR EXISTS (
          SELECT 1 FROM movimientos_stock WHERE referencia_cobro_id = OLD.id
        )) THEN RAISE EXCEPTION 'No se pueden modificar ítems de un cobro con stock descontado'; END IF;
        IF jsonb_typeof(NEW.items_inventario) <> 'array' OR jsonb_array_length(NEW.items_inventario) > 100
          THEN RAISE EXCEPTION 'Ítems de inventario inválidos'; END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(NEW.items_inventario) LOOP
          SELECT * INTO product FROM productos WHERE id = (item->>'productoId')::integer;
          IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
          IF product.id = ANY(seen) THEN RAISE EXCEPTION 'Producto duplicado'; END IF;
          seen := array_append(seen, product.id);
          IF (NEW.organization_id IS NOT NULL AND product.organization_id IS DISTINCT FROM NEW.organization_id)
             OR (NEW.organization_id IS NULL AND (product.organization_id IS NOT NULL OR product.usuario_id IS DISTINCT FROM NEW.responsable_id))
            THEN RAISE EXCEPTION 'Producto fuera de la organización del cobro'; END IF;
          IF (item->>'cantidad') IS NULL OR (item->>'cantidad')::numeric <= 0
             OR (item->>'cantidad')::numeric > 1000000000
             OR (item->>'cantidad')::numeric <> round((item->>'cantidad')::numeric, 3)
             OR (item->>'precioUnitario') IS NULL OR (item->>'precioUnitario')::numeric < 0
             OR item->>'tipo' IS DISTINCT FROM product.tipo
            THEN RAISE EXCEPTION 'Cantidad, precio o tipo inválido'; END IF;
          IF item->>'bodegaId' IS NOT NULL AND (
            product.tipo <> 'producto' OR NOT EXISTS (
              SELECT 1 FROM bodegas b JOIN locales l ON l.id = b.local_id
              WHERE b.id = (item->>'bodegaId')::integer AND b.activo AND l.activo
                AND ((product.organization_id IS NOT NULL AND l.organization_id = product.organization_id)
                  OR (product.organization_id IS NULL AND l.organization_id IS NULL AND l.usuario_id = product.usuario_id))
            )) THEN RAISE EXCEPTION 'Bodega fuera de la organización del cobro'; END IF;
        END LOOP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS cobros_validar_inventario ON cobros;
      CREATE TRIGGER cobros_validar_inventario BEFORE INSERT OR UPDATE OF items_inventario ON cobros
        FOR EACH ROW EXECUTE FUNCTION validar_items_inventario();

      CREATE OR REPLACE FUNCTION descontar_stock_cobro_pagado() RETURNS trigger AS $$
      DECLARE item jsonb; movement_id integer; warehouse_id integer; product productos%ROWTYPE;
      BEGIN
        IF NEW.estado <> 'pagado' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.estado = 'pagado' THEN RETURN NEW; END IF;
        -- Stable ordering prevents deadlocks when paid charges share products.
        FOR item IN SELECT value FROM jsonb_array_elements(NEW.items_inventario)
          WHERE value->>'tipo' = 'producto' ORDER BY (value->>'productoId')::integer LOOP
          SELECT * INTO product FROM productos WHERE id = (item->>'productoId')::integer FOR UPDATE;
          warehouse_id := (item->>'bodegaId')::integer;
          IF warehouse_id IS NULL THEN
            SELECT b.id INTO warehouse_id FROM bodegas b
              JOIN locales l ON l.id = b.local_id
              LEFT JOIN stock_por_bodega s ON s.bodega_id = b.id AND s.producto_id = product.id
              WHERE b.activo AND l.activo AND (
                (product.organization_id IS NOT NULL AND l.organization_id = product.organization_id)
                OR (product.organization_id IS NULL AND l.organization_id IS NULL AND l.usuario_id = product.usuario_id)
              ) ORDER BY coalesce(s.stock_actual, 0) DESC, b.id ASC LIMIT 1;
          END IF;
          movement_id := NULL;
          INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, referencia_cobro_id, usuario_id, bodega_origen_id)
            VALUES ((item->>'productoId')::integer, 'salida', (item->>'cantidad')::numeric,
              'Cobro', NEW.id, coalesce(NEW.responsable_id, 'sistema'), warehouse_id)
            ON CONFLICT (referencia_cobro_id, producto_id) DO NOTHING RETURNING id INTO movement_id;
          IF movement_id IS NOT NULL THEN
            IF warehouse_id IS NOT NULL THEN
              INSERT INTO stock_por_bodega (producto_id, bodega_id, stock_actual, stock_critico)
                VALUES (product.id, warehouse_id, 0, product.stock_critico)
                ON CONFLICT (producto_id, bodega_id) DO NOTHING;
              UPDATE stock_por_bodega SET stock_actual = stock_actual - (item->>'cantidad')::numeric, updated_at = now()
                WHERE producto_id = product.id AND bodega_id = warehouse_id;
              UPDATE productos SET stock_actual = (SELECT coalesce(sum(stock_actual), 0) FROM stock_por_bodega WHERE producto_id = product.id),
                updated_at = now() WHERE id = product.id;
            ELSE
              UPDATE productos SET stock_actual = stock_actual - (item->>'cantidad')::numeric, updated_at = now()
                WHERE id = product.id;
            END IF;
          END IF;
        END LOOP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS cobros_descontar_stock ON cobros;
      CREATE TRIGGER cobros_descontar_stock AFTER INSERT OR UPDATE OF estado ON cobros
        FOR EACH ROW EXECUTE FUNCTION descontar_stock_cobro_pagado();
    `));
  });
}
