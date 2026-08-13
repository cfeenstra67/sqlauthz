---
"sqlauthz": minor
---

Add incremental privilege and restrictive RLS policy reconciliation with the `--reconcile` CLI option and `reconcile` library option. Reapplying unchanged rules now produces no permission mutations, while changed direct privileges and RLS policies are updated transactionally.

Reconciliation-only privilege and role-membership metadata is fetched only when reconciliation is enabled.
