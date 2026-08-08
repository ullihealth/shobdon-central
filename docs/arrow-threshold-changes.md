# Arrow colour threshold changes

Log of direct D1 edits to a tenant's `arrow_tailwind_kt` / `arrow_crosswind_kt`
/ `arrow_headwind_kt` columns on `tenants` (migration 0081). These three
control the compass needle / runway wind widget arrow colour thresholds
(`determineArrowColour` in `src/utils/windCalculations.ts`) and are
developer-editable only - there is no self-service UI for them, by design.

Whenever one of these is changed directly in D1 on a tenant's request, add
an entry below: date, tenant, field(s) changed, old value -> new value, and
who requested it / why. Doesn't need to be more than a few lines - this is
just so there's a record if a tenant's thresholds are ever questioned later.

Defaults (used by every tenant unless a row below says otherwise):
- `arrow_tailwind_kt`: 2
- `arrow_crosswind_kt`: 5
- `arrow_headwind_kt`: 3

## Template

```
## YYYY-MM-DD - <Tenant name> (<tenant slug/org id>)
- <column>: <old value> -> <new value>
- Requested by: <who/why>
```

No changes logged yet - every tenant is still on the migration defaults above.
