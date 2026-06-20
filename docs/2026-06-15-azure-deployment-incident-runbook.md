# Azure Deployment Incident and Runbook

**Date:** 2026-06-15  
**Application:** SharedAccManager  
**Platform:** Azure Container Apps, GHCR, Azure Files, SQLite  
**Relevant script:** `deploy.cmd`

## Purpose

This document records what happened during the June 15 deployment incident, the mistakes made while diagnosing and fixing it, and the required procedure for future deployments.

The most important constraint is:

> Only one active Container Apps revision may access the SQLite database mounted from Azure Files.

The Azure Files volume uses `nobrl`, so SQLite locks are client-local. Two active revisions can therefore behave as two independent writers and corrupt the database.

## System Overview

The deployment has three separate stages:

1. A commit is pushed to `main`.
2. GitHub Actions builds the Docker image and pushes two GHCR tags:
   - `ghcr.io/abdullamattar/sharedaccmanager:latest`
   - `ghcr.io/abdullamattar/sharedaccmanager:<full-commit-sha>`
3. `deploy.cmd` updates Azure Container Apps to the exact commit SHA image.

`deploy.cmd` does not build or push the Docker image. It deploys an image that must already exist in GHCR.

## Incident Timeline

### 1. Deployment started before the Docker image was ready

The first deployment used image:

```text
ghcr.io/abdullamattar/sharedaccmanager:bd28b0252a8911ef265dd0b8866c5e7fb20d0669
```

At that time, GitHub Actions had not finished publishing the image.

The script:

- Deactivated old revisions.
- Attempted to update the app.
- Did not check the Azure CLI exit code.
- Printed `OK` even though the deployment had failed.

This could leave the app without a working active revision.

### 2. The new revision crashed because production data had broken foreign keys

Container logs showed:

```text
Foreign key check failed after migrations:
accounts rowids 201-205 referenced missing products
```

The production database contained five account rows whose `product_id` values did not exist in `products`.

The likely cause was an earlier product deletion while SQLite foreign-key enforcement was disabled. The product-delete endpoint also did not explicitly reject products with linked accounts.

The recovery fix:

- Recreated clearly labeled placeholder products for missing product references.
- Preserved all existing accounts and related data.
- Added a product-delete guard that returns `409` when accounts are linked.
- Kept the startup foreign-key check so unknown corruption still stops startup.

### 3. Rollback reactivated an already failed revision

The first rollback implementation remembered every previously active revision, including failed and unhealthy revisions.

When the new deployment failed, it reactivated failed revision `0000023`.

This was unsafe because:

- Failed revisions should not be rollback candidates.
- The restored revision could run alongside the new revision.
- Two active revisions violate the SQLite single-writer requirement.

The rollback fix:

- Remembers at most one previously active, healthy, provisioned revision.
- Deactivates the failed new revision before restoring the previous revision.
- Refuses to activate a rollback revision if deactivating the failed revision fails.

### 4. A healthy revision was incorrectly rolled back

Revision `0000027` was:

```text
Active=True
Replicas=1
TrafficWeight=100
HealthState=Healthy
ProvisioningState=Provisioned
```

The app worked, but `deploy.cmd` remained at:

```text
-> checking revision health...
```

The script required:

```powershell
$revision.properties.runningState -eq "Running"
```

Azure has multiple valid running-state labels. A healthy revision at its maximum replica count may not return the exact string `Running`.

After the timeout, the script incorrectly deactivated healthy revision `0000027` and restored `0000026`.

The health-check fix now accepts a revision when:

```text
active == true
healthState == Healthy
provisioningState == Provisioned
replicas >= 1
```

## Mistakes Made

### Mistake 1: Treating successful command completion as successful deployment

An Azure CLI command returning did not prove the new revision was healthy. The original script also ignored non-zero exit codes.

**Lesson:** Check command exit codes and verify the resulting revision state before printing success.

### Mistake 2: Deactivating the working revision before proving the image existed

The script originally deactivated old revisions before confirming the exact SHA-tagged image was available in GHCR.

**Lesson:** Verify the immutable image tag first. Never take down the current revision while required deployment artifacts are unavailable.

### Mistake 3: Assuming every previously active revision was safe for rollback

Failed revision `0000023` was considered a rollback candidate because it was active.

**Lesson:** Active does not mean healthy. Rollback candidates must be active, healthy, and provisioned before deployment begins.

### Mistake 4: Allowing rollback to create two possible SQLite writers

The first rollback implementation activated the old revision without first ensuring the failed/new revision was inactive.

**Lesson:** With SQLite on Azure Files using `nobrl`, rollback ordering is mandatory:

1. Deactivate the new/failed revision.
2. Confirm deactivation command succeeded.
3. Activate one previously healthy revision.

### Mistake 5: Requiring the exact `runningState` string

The health check used `runningState == "Running"` even though Azure exposes several valid running states.

**Lesson:** Use stable readiness indicators that match the deployment requirement. For this app, healthy, provisioned, active, and at least one replica are sufficient.

### Mistake 6: Recommending waiting after Azure already reported failure

When a revision has:

```text
HealthState=Unhealthy
ProvisioningState=Failed
```

waiting will not recover it.

**Lesson:** Immediately inspect console and system logs when provisioning is failed.

### Mistake 7: Making deployment fixes without first validating production-specific states

Mock tests initially covered only the expected happy path and missed Azure's real health-state variations.

**Lesson:** Before changing orchestration logic, inspect the actual Azure JSON:

```powershell
az containerapp revision show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision REVISION_NAME `
  -o json
```

## Correct Deployment Procedure

### Before deployment

1. Ensure the working tree is clean:

```powershell
git status --short --branch
```

2. Ensure `main` is pushed:

```powershell
git rev-parse HEAD
git rev-parse origin/main
```

The two SHA values must match.

3. Run verification for code changes:

```powershell
pnpm --filter @workspace/api-server test
pnpm run typecheck
pnpm run build
```

4. Run deployment:

```powershell
cd D:\Abdulla\SharedAccManager
.\deploy.cmd
```

The script waits for the exact SHA image in GHCR before changing Azure revisions.

### During deployment

Monitor from a second PowerShell window:

```powershell
az containerapp revision list `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  -o table
```

Expected final state:

- Exactly one active revision.
- `Replicas` is at least `1`.
- `TrafficWeight` is `100`.
- `HealthState` is `Healthy`.
- `ProvisioningState` is `Provisioned`.

Inspect the exact revision state when needed:

```powershell
az containerapp revision show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision REVISION_NAME `
  --query "properties.{active:active,replicas:replicas,health:healthState,provisioning:provisioningState,running:runningState,error:provisioningError}" `
  -o json
```

### After deployment

1. Confirm only one active revision:

```powershell
az containerapp revision list `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --query "[?properties.active].{name:name,replicas:properties.replicas,health:properties.healthState,provisioning:properties.provisioningState}" `
  -o table
```

2. Open the application and test login and one normal read operation.

3. Check recent application logs:

```powershell
az containerapp logs show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --tail 50
```

## Failure Recovery

### If a revision is unhealthy or provisioning failed

Do not wait. Inspect logs:

```powershell
az containerapp logs show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision REVISION_NAME `
  --type console `
  --tail 100
```

```powershell
az containerapp logs show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision REVISION_NAME `
  --type system `
  --tail 100
```

Inspect revision details:

```powershell
az containerapp revision show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision REVISION_NAME `
  -o json
```

### Manual rollback

Only use a revision that was previously confirmed healthy.

First deactivate the failed/new revision:

```powershell
az containerapp revision deactivate `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision FAILED_REVISION
```

Confirm it is inactive before activating the old revision:

```powershell
az containerapp revision list `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  -o table
```

Then activate exactly one known healthy revision:

```powershell
az containerapp revision activate `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision HEALTHY_REVISION
```

Never activate two revisions at once for this application.

## Database Integrity

Startup applies migrations and then runs SQLite `foreign_key_check`.

Known orphaned account-product references are repaired by recreating placeholder products. The recovery intentionally preserves accounts rather than deleting them.

If startup still reports foreign-key violations after this repair, do not disable the integrity check. Inspect the reported table, row ID, parent table, and foreign-key ID before deciding how to repair the data.

Useful log pattern:

```text
Foreign key check failed after migrations:
[{"table":"...","rowid":...,"parent":"...","fkid":...}]
```

## Deployment Script Requirements

Any future change to `deploy.cmd` must preserve these invariants:

1. Verify the exact SHA image exists before deactivating revisions.
2. Never print `OK` before the new revision is verified.
3. Treat only active, healthy, provisioned revisions as rollback candidates.
4. Deactivate the failed/new revision before activating a rollback revision.
5. Refuse rollback if failed-revision deactivation fails.
6. Never leave more than one active revision.
7. Accept a new revision when it is active, healthy, provisioned, and has at least one replica.
8. Do not depend on one exact `runningState` string.
9. Surface Azure CLI failures instead of continuing silently.
10. Preserve production data during automated repairs.

## Relevant Fix Commits

- `ed6a72c` - Wait for GHCR image and add deployment failure handling.
- `df1b1ce` - Repair orphaned account-product references and prevent unsafe product deletion.
- `312872f` - Preserve the SQLite single-writer rule during rollback.
- `1f48acb` - Accept healthy provisioned revisions without requiring exact `runningState`.

## Final Checklist

Before declaring a deployment successful:

- [ ] Exact SHA image exists in GHCR.
- [ ] Deployment command completed without errors.
- [ ] Exactly one revision is active.
- [ ] Active revision has at least one replica.
- [ ] Active revision is healthy and provisioned.
- [ ] Active revision receives 100% traffic.
- [ ] Application login works.
- [ ] Recent logs contain no startup or database-integrity errors.

