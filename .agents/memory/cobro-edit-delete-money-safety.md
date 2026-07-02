---
name: Cobro edit/delete money-safety
description: Invariants for editing/deleting/adjusting a cobro so money-received records can't be mutated or erased.
---

# Cobro edit/delete/ajustar money-safety

Core invariant: a cobro that has received money (estado==pagado OR any confirmed
abono in `pagos_parciales`) must never be freely edited or hard-deleted; amount
changes on such a cobro go only through the audited `POST /cobros/:id/ajustar-monto`.

**Rules that enforce it (all in `routes/cobros.ts`):**
- Full-form EDIT (PATCH) of amount/cliente/etc. is gated on `estado==="pendiente"`.
- Because a manual `estado` change could re-open that gate, PATCH also blocks
  `estado -> "pendiente"` when confirmed abonos > 0. **Why:** without it, a caller
  could do parcial→pendiente then edit the amount, bypassing the audit trail.
- DELETE and ajustar-monto do their read+validate+write **inside one
  `db.transaction`** and lock the cobro row with `.for("update")`
  (Drizzle: `.select()...for("update")`). **Why:** a concurrent payment webhook
  confirming an abono between a non-transactional check and the write would let
  you delete/underprice a cobro that just received money. FOR UPDATE conflicts
  with the FK's FOR KEY SHARE, so a concurrent abono insert blocks until commit,
  then fails against the deleted parent.

**How to apply:** any new path that mutates a cobro's amount or deletes it must
re-check money-received state under the same row lock, and must not add a way to
reset estado to pendiente once money exists. Return early results as a
discriminated union from the transaction callback — TS can't narrow a `let`
mutated inside the closure (infers `never`), which breaks the typecheck.
