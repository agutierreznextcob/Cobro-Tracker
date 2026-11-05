import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Installed before serving traffic. PostgreSQL makes stock and payment-state
 * changes one transaction across manual payments, abonos, Flow and MP webhooks.
 * A unique (charge, product) movement makes repeated callbacks harmless.
 */
export async function initializeInventarioTriggers() {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nextcob:inventario:triggers'))`);
    await tx.execute(sql.raw(`
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
        END LOOP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS cobros_validar_inventario ON cobros;
      CREATE TRIGGER cobros_validar_inventario BEFORE INSERT OR UPDATE OF items_inventario ON cobros
        FOR EACH ROW EXECUTE FUNCTION validar_items_inventario();

      CREATE OR REPLACE FUNCTION descontar_stock_cobro_pagado() RETURNS trigger AS $$
      DECLARE item jsonb; movement_id integer;
      BEGIN
        IF NEW.estado <> 'pagado' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.estado = 'pagado' THEN RETURN NEW; END IF;
        -- Stable ordering prevents deadlocks when paid charges share products.
        FOR item IN SELECT value FROM jsonb_array_elements(NEW.items_inventario)
          WHERE value->>'tipo' = 'producto' ORDER BY (value->>'productoId')::integer LOOP
          PERFORM 1 FROM productos WHERE id = (item->>'productoId')::integer FOR UPDATE;
          movement_id := NULL;
          INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, referencia_cobro_id, usuario_id)
            VALUES ((item->>'productoId')::integer, 'salida', (item->>'cantidad')::numeric,
              'Cobro pagado #' || NEW.id, NEW.id, coalesce(NEW.responsable_id, 'sistema'))
            ON CONFLICT (referencia_cobro_id, producto_id) DO NOTHING RETURNING id INTO movement_id;
          IF movement_id IS NOT NULL THEN
            UPDATE productos SET stock_actual = stock_actual - (item->>'cantidad')::numeric, updated_at = now()
              WHERE id = (item->>'productoId')::integer AND tipo = 'producto';
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
