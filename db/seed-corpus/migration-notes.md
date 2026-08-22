# Platform Migration Notes — Sprint 12

## Decisions
- Freeze schema changes after Wednesday; migration window is Saturday 02:00–06:00 ET.
- The legacy import service will run in shadow mode for two weeks before cutover.
- Rollback plan: repoint DNS to the blue cluster, verified load-tested at 2x peak.

## Open risks
- Vendor API rate limit is 120 req/min; we need 300. Escalation ticket NET-4471.
- Two stored procedures still emit deprecation warnings on Postgres 17.

## Next steps
1. Dry-run migration on staging Friday night.
2. Confirm sign-off from the data owner.
3. Publish the cutover runbook to the team wiki.
