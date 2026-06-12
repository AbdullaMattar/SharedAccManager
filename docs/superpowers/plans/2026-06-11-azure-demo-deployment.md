# Azure Demo Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy SharedAccManager as a live HTTPS demo on Azure Container Apps using `az acr build` (no local Docker required), seeded with mock data.

**Architecture:** Local code is uploaded to Azure Container Registry via `az acr build`, which builds the Docker image in the cloud. The image is then deployed to Azure Container Apps (scales to zero when idle). SQLite is ephemeral — resets on restart, which is acceptable for a demo.

**Tech Stack:** Azure CLI, Azure Container Registry (Basic), Azure Container Apps, pnpm, Node.js 22, SQLite (Drizzle ORM)

---

## Files

- **Modify:** `package.json` — add `pnpm.supportedArchitectures` so lock file includes Linux platform binaries
- **Modify:** `pnpm-lock.yaml` — regenerated automatically after package.json change
- **No Dockerfile changes** — existing multi-stage Dockerfile is correct as-is
- **No docker-compose changes** — not used for Azure deployment

---

### Task 1: Fix pnpm lock file for Linux Docker builds

The root `package.json` explicitly installs Windows-only binaries (`@esbuild/win32-x64`, `@rollup/rollup-win32-x64-msvc`, `lightningcss-win32-x64-msvc`, `@tailwindcss/oxide-win32-x64-msvc`). When `pnpm install --frozen-lockfile` runs inside the Linux Docker container on Azure, the Linux equivalents of these packages (`@esbuild/linux-x64` etc.) won't be in the lock file and the build will fail. Fix: tell pnpm to lock binaries for both platforms.

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto-regenerated)

- [ ] **Step 1: Add supportedArchitectures to package.json**

Open `package.json` and add the `pnpm` field so the file looks like this:

```json
{
  "name": "workspace",
  "version": "0.0.0",
  "license": "MIT",
  "scripts": {
    "preinstall": "node -e \"if(!process.env.npm_config_user_agent?.startsWith('pnpm/')){console.error('Use pnpm instead');process.exit(1)}\"",
    "build": "pnpm run typecheck && pnpm -r --if-present run build",
    "typecheck:libs": "tsc --build",
    "typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck"
  },
  "private": true,
  "pnpm": {
    "supportedArchitectures": {
      "os": ["linux", "win32"],
      "cpu": ["x64"]
    }
  },
  "devDependencies": {
    "@esbuild/win32-x64": "^0.27.3",
    "@rollup/rollup-win32-x64-msvc": "^4.61.1",
    "lightningcss-win32-x64-msvc": "1.32.0",
    "prettier": "^3.8.3",
    "typescript": "~5.9.3"
  },
  "dependencies": {
    "@tailwindcss/oxide-win32-x64-msvc": "4.3.0"
  }
}
```

- [ ] **Step 2: Regenerate the lock file**

Run in PowerShell from the project root:

```powershell
pnpm install
```

Expected: pnpm downloads Linux platform binaries and updates `pnpm-lock.yaml`. You'll see new packages like `@esbuild/linux-x64` being fetched. No errors.

- [ ] **Step 3: Commit**

```powershell
git add package.json pnpm-lock.yaml
git commit -m "chore: add pnpm supportedArchitectures for Linux Docker builds"
```

---

### Task 2: Install Azure CLI and required extensions

**Files:** None (system install)

- [ ] **Step 1: Check if Azure CLI is already installed**

```powershell
az version
```

If you see a JSON output with version info, skip to Step 3. If you get "command not found", continue to Step 2.

- [ ] **Step 2: Install Azure CLI via winget**

```powershell
winget install Microsoft.AzureCLI
```

Expected: Azure CLI installs. Close and reopen PowerShell after install, then verify:

```powershell
az version
```

Expected output (versions may differ):
```json
{
  "azure-cli": "2.x.x",
  ...
}
```

- [ ] **Step 3: Install Container Apps extension**

```powershell
az extension add --name containerapp --upgrade
```

Expected: Extension installs or is already up to date. No errors.

- [ ] **Step 4: Register required Azure providers**

```powershell
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
```

Expected: Both return `"Registering is still on-going"` or `"Registered"`. Registration can take 1-2 minutes in the background — continue to the next task.

---

### Task 3: Login to Azure

**Files:** None

- [ ] **Step 1: Login**

```powershell
az login
```

Expected: A browser window opens. Sign in with your Azure student account. PowerShell will show your subscriptions as JSON.

- [ ] **Step 2: Confirm the right subscription is active**

```powershell
az account show --query "{name:name, id:id, state:state}" -o table
```

Expected output shows your student subscription with state `Enabled`. If it shows the wrong one, list all and set the right one:

```powershell
az account list -o table
az account set --subscription "<subscription-id-or-name>"
```

---

### Task 4: Create Resource Group and Container Registry

**Files:** None

- [ ] **Step 1: Create Resource Group**

```powershell
az group create --name shared-acc-rg --location eastus
```

Expected:
```json
{
  "location": "eastus",
  "name": "shared-acc-rg",
  "properties": { "provisioningState": "Succeeded" }
}
```

- [ ] **Step 2: Create Azure Container Registry**

ACR names must be globally unique and alphanumeric only. If `sharedaccreg` is taken, append a random suffix like `sharedaccreg42`.

```powershell
az acr create --resource-group shared-acc-rg --name sharedaccreg --sku Basic
```

Expected: JSON output with `"provisioningState": "Succeeded"` and `"loginServer": "sharedaccreg.azurecr.io"`.

- [ ] **Step 3: Enable admin credentials on ACR**

Container Apps needs credentials to pull the image from ACR.

```powershell
az acr update --name sharedaccreg --admin-enabled true
```

Expected: JSON output showing `"adminUserEnabled": true`.

---

### Task 5: Build Docker image in Azure

`az acr build` uploads your local code to Azure and builds the Docker image there. No Docker Desktop needed.

**Files:** None (uses existing `Dockerfile`)

- [ ] **Step 1: Run the cloud build**

From the project root (where `Dockerfile` is):

```powershell
az acr build --registry sharedaccreg --image shared-acc-manager:latest .
```

Expected: Uploads your code (~a few MB, node_modules excluded by `.dockerignore`), then shows build logs streamed live. The multi-stage build takes 3-6 minutes. Final line should say:

```
Run ID: ca1 was successful after Xm Xs
```

If the build fails, check the logs for errors. Common issue: if you see an error about missing Linux platform binaries, ensure Task 1 was completed and the lock file was regenerated.

- [ ] **Step 2: Verify the image is in ACR**

```powershell
az acr repository list --name sharedaccreg -o table
```

Expected:
```
Result
--------------------
shared-acc-manager
```

---

### Task 6: Create Container Apps Environment

**Files:** None

- [ ] **Step 1: Create the environment**

This is the networking/infrastructure layer that Container Apps runs inside.

```powershell
az containerapp env create `
  --name shared-acc-env `
  --resource-group shared-acc-rg `
  --location eastus
```

Expected: Takes 1-2 minutes. Final output shows `"provisioningState": "Succeeded"`.

---

### Task 7: Generate secrets and deploy the Container App

**Files:** None

- [ ] **Step 1: Get ACR credentials**

```powershell
az acr credential show --name sharedaccreg --query "{username:username, password:passwords[0].value}" -o table
```

Expected: A table with `Username` and `Password`. Copy both values — you'll need them in Step 3.

- [ ] **Step 2: Generate SESSION_SECRET and ENCRYPTION_KEY**

These must be random 64-character hex strings. Run in PowerShell:

```powershell
$SESSION_SECRET = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
$ENCRYPTION_KEY = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
Write-Host "SESSION_SECRET=$SESSION_SECRET"
Write-Host "ENCRYPTION_KEY=$ENCRYPTION_KEY"
```

Copy both output lines — you'll need them in Step 3.

- [ ] **Step 3: Deploy the Container App**

Replace the placeholders:
- `<ACR_USERNAME>` — from Step 1
- `<ACR_PASSWORD>` — from Step 1
- `<SESSION_SECRET>` — from Step 2
- `<ENCRYPTION_KEY>` — from Step 2
- `<YOUR_ADMIN_EMAIL>` — your chosen login email (e.g. `admin@example.com`)
- `<YOUR_ADMIN_PASSWORD>` — your chosen login password (min 8 chars)

```powershell
az containerapp create `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --environment shared-acc-env `
  --image sharedaccreg.azurecr.io/shared-acc-manager:latest `
  --registry-server sharedaccreg.azurecr.io `
  --registry-username <ACR_USERNAME> `
  --registry-password "<ACR_PASSWORD>" `
  --target-port 5000 `
  --ingress external `
  --env-vars `
    NODE_ENV=production `
    PORT=5000 `
    SQLITE_URL=file:/app/data/app.db `
    SESSION_SECRET=<SESSION_SECRET> `
    ENCRYPTION_KEY=<ENCRYPTION_KEY> `
    ADMIN_EMAIL=<YOUR_ADMIN_EMAIL> `
    ADMIN_PASSWORD=<YOUR_ADMIN_PASSWORD> `
    COOKIE_SECURE=true `
    ALLOWED_ORIGINS=https://shared-acc-app.<RANDOM>.eastus.azurecontainerapps.io `
  --cpu 0.5 `
  --memory 1.0Gi `
  --min-replicas 0 `
  --max-replicas 1
```

Expected: Deployment takes 1-2 minutes. Final output includes `"provisioningState": "Succeeded"`.

- [ ] **Step 4: Get the public URL**

```powershell
az containerapp show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --query "properties.configuration.ingress.fqdn" `
  -o tsv
```

Expected: A URL like `shared-acc-app.redfield-abc123.eastus.azurecontainerapps.io`

The app is accessible at `https://<that-url>` — Azure provides HTTPS automatically.

- [ ] **Step 5: Update ALLOWED_ORIGINS with the real FQDN**

Replace `<FQDN>` with the URL from Step 4:

```powershell
az containerapp update `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --set-env-vars "ALLOWED_ORIGINS=https://<FQDN>"
```

This fixes CORS so login works from the real domain. Then restart the container to pick up the change:

```powershell
az containerapp revision restart `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --revision $(az containerapp revision list --name shared-acc-app --resource-group shared-acc-rg --query "[0].name" -o tsv)
```

---

### Task 8: Verify the app is live

**Files:** None

- [ ] **Step 1: Open the app in your browser**

Navigate to `https://<url-from-task-7-step-4>`.

Expected: The login page loads. If you see a blank page or error, wait 30 seconds — the container may be cold-starting from zero replicas.

- [ ] **Step 2: Login with admin credentials**

Use the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set in Task 7. Expected: You land on the dashboard. The seed data (Netflix, Spotify, ChatGPT products) should be visible.

- [ ] **Step 3: Check app logs if something looks wrong**

```powershell
az containerapp logs show `
  --name shared-acc-app `
  --resource-group shared-acc-rg `
  --follow
```

Press `Ctrl+C` to stop streaming. Look for any ERROR lines. A successful boot shows lines like:
```
Server listening on port 5000
Admin user created
Sample products created
```

---

## Cost Summary

| Resource | Est. Monthly Cost |
|---|---|
| ACR Basic | ~$5 |
| Container Apps (scales to zero) | ~$0-2 |
| **Total** | **~$5-7 / month** |

Your $100 student credit covers ~14-20 months of this demo.

## Tear Down (when done)

Delete everything at once:
```powershell
az group delete --name shared-acc-rg --yes --no-wait
```
