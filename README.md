# Shared Accounts Manager

## SQLite backups

The API process runs daily maintenance at `00:05` server time. It persists expired
subscriptions, frees slots after the live `grace_days` setting, and creates a
consistent SQLite backup under `data/backups/app-YYYY-MM-DD.db`. The newest 14
daily backups are retained.

Set `SQLITE_URL` when the database is not at the default `data/app.db` path.

### Restore

1. Stop the API process so no writes can occur.
2. Keep a copy of the current database and its `-wal` and `-shm` files.
3. Replace `data/app.db` with the selected file from `data/backups/`.
4. Remove stale `data/app.db-wal` and `data/app.db-shm` files if present.
5. Start the API and verify `/api/healthz`, login, dashboard totals, and a recent subscription.

Never restore while the API process is running.
