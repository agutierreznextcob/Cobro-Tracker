---
name: Notification durability
description: Durable reconciliation, retention, and read-state rules for notification producers.
---

# Notification durability

Reconcile notification source facts incrementally in the background rather than rescanning synchronously from the inbox read path. Persist the scan **start** time as the successful watermark, not its finish time.

**Why:** Business-state changes and notification insertion are separate transactions. A producer can fail after the business event commits, and an event can also commit while reconciliation is running. A finish-time watermark can skip that concurrent event forever.

**How to apply:** Every reconstructable source needs a durable success/update timestamp. New source types must be included in incremental reconciliation using that timestamp; date milestones use durable event keys and catch-up semantics.

Serialize notification claim, insert, and pruning per user so concurrent producers cannot exceed the physical 100-row retention bound. Keep event claims after visible rows are pruned.

**Why:** Independent transactions can both insert before either prunes, leaving more than 100 visible rows and allowing deleted history to be recreated.

**How to apply:** All notification writers must use the central creation service. “Mark all read” must persist a per-user read cursor so historical rows inserted later by another process are born read.