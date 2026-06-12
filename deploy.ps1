# Deploy SharedAccManager to Azure Container Apps.
# Usage:  .\deploy.ps1   (or double-click deploy.cmd)
# Re-run at any time to update the running app to the latest git commit.
#
# Prereqs: Azure CLI (az login), Node.js, git
# Region:  francecentral (Azure for Students allowed regions)
# Image:   pulled from ghcr.io — no local Docker needed
#
# Teardown: az group delete --name shared-acc-rg --yes --no-wait

# Always run from the directory containing this script
Set-Location $PSScriptRoot

$RESOURCE_GROUP     = "shared-acc-rg"
$LOCATION           = "francecentral"
$ENVIRONMENT        = "shared-acc-env"
$APP_NAME           = "shared-acc-app"
$IMAGE_REPO         = "ghcr.io/abdullamattar/sharedaccmanager"
$SECRETS_FILE       = ".deploy-secrets"
$SHARE_NAME         = "appdata"
$STORAGE_MOUNT_NAME = "appdata"

$ADMIN_EMAIL    = if ($env:ADMIN_EMAIL)    { $env:ADMIN_EMAIL }    else { "admin@example.com" }
# Matches the demo button on the login page
$ADMIN_PASSWORD = if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } else { "admin123" }

# ── Prereq checks ─────────────────────────────────────────────────────────────
if (-not (Get-Command az   -ErrorAction SilentlyContinue)) { Write-Error "ERROR: Azure CLI not installed.";  exit 1 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "ERROR: Node.js not installed.";    exit 1 }
if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { Write-Error "ERROR: git not installed.";        exit 1 }

az account show --output none
if ($LASTEXITCODE -ne 0) { Write-Error "ERROR: Not logged in. Run: az login"; exit 1 }

$SUB_NAME = (az account show --query "name" -o tsv).Trim()
$SUB_ID   = (az account show --query "id"   -o tsv).Trim()
Write-Host "-> subscription: $SUB_NAME ($SUB_ID)"
Write-Host "   (if wrong, run: az account set --subscription <name>)"
Write-Host ""

az extension add --name containerapp --upgrade --output none

# ── Image tag — always use the full commit SHA, never 'latest' ────────────────
$SHA   = (git rev-parse HEAD).Trim()
$IMAGE = "${IMAGE_REPO}:${SHA}"
Write-Host "-> image:   $IMAGE"

# ── Secrets — generate once on first run, reuse on re-runs ───────────────────
if (Test-Path $SECRETS_FILE) {
    $lines          = Get-Content $SECRETS_FILE
    $SESSION_SECRET = ($lines | Where-Object { $_ -like "SESSION_SECRET=*" }) -replace "^SESSION_SECRET=", ""
    $ENCRYPTION_KEY = ($lines | Where-Object { $_ -like "ENCRYPTION_KEY=*" }) -replace "^ENCRYPTION_KEY=", ""
    Write-Host "-> secrets: loaded from $SECRETS_FILE"
} else {
    $SESSION_SECRET = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    $ENCRYPTION_KEY = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    [System.IO.File]::WriteAllText(
        (Resolve-Path ".").Path + "\$SECRETS_FILE",
        "SESSION_SECRET=$SESSION_SECRET`nENCRYPTION_KEY=$ENCRYPTION_KEY`n"
    )
    Write-Host "-> secrets: generated and saved to $SECRETS_FILE (gitignored)"
}

# ── Storage account name — generated once, reused (must be globally unique) ──
$lines       = Get-Content $SECRETS_FILE
$storageLine = $lines | Where-Object { $_ -like "STORAGE_ACCOUNT=*" }
if ($storageLine) {
    $STORAGE_ACCOUNT = $storageLine -replace "^STORAGE_ACCOUNT=", ""
} else {
    $hex             = node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))"
    $STORAGE_ACCOUNT = "sharedacc$hex"
    [System.IO.File]::AppendAllText(
        (Resolve-Path ".").Path + "\$SECRETS_FILE",
        "STORAGE_ACCOUNT=$STORAGE_ACCOUNT`n"
    )
}
Write-Host "-> storage:  $STORAGE_ACCOUNT/$SHARE_NAME"

# ── Resource group ────────────────────────────────────────────────────────────
Write-Host "-> resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none

# ── Container Apps environment ────────────────────────────────────────────────
az containerapp env show --name $ENVIRONMENT --resource-group $RESOURCE_GROUP --output none
if ($LASTEXITCODE -ne 0) {
    Write-Host "-> environment (takes ~2 min)..."
    az containerapp env create --name $ENVIRONMENT --resource-group $RESOURCE_GROUP --location $LOCATION --output none
}

$DEFAULT_DOMAIN = (az containerapp env show --name $ENVIRONMENT --resource-group $RESOURCE_GROUP --query "properties.defaultDomain" -o tsv).Trim()
$APP_URL        = "https://${APP_NAME}.${DEFAULT_DOMAIN}"

# ── Azure Files share for persistent SQLite data ─────────────────────────────
az storage account create `
    --name $STORAGE_ACCOUNT --resource-group $RESOURCE_GROUP --location $LOCATION `
    --sku Standard_LRS --kind StorageV2 --output none

$STORAGE_KEY = (az storage account keys list `
    --account-name $STORAGE_ACCOUNT --resource-group $RESOURCE_GROUP `
    --query "[0].value" -o tsv).Trim()

# Create share — ignore error if it already exists
az storage share-rm create `
    --resource-group $RESOURCE_GROUP --storage-account $STORAGE_ACCOUNT `
    --name $SHARE_NAME --quota 5 --output none
$global:LASTEXITCODE = 0   # share already existing is not fatal

az containerapp env storage set `
    --name $ENVIRONMENT --resource-group $RESOURCE_GROUP `
    --storage-name $STORAGE_MOUNT_NAME `
    --azure-file-account-name $STORAGE_ACCOUNT `
    --azure-file-account-key $STORAGE_KEY `
    --azure-file-share-name $SHARE_NAME `
    --access-mode ReadWrite --output none

# ── Env vars ──────────────────────────────────────────────────────────────────
$ENV_VARS = @(
    "NODE_ENV=production"
    "PORT=5000"
    "SQLITE_URL=file:/app/data/app.db"
    "SQLITE_JOURNAL_MODE=delete"
    "SESSION_SECRET=$SESSION_SECRET"
    "ENCRYPTION_KEY=$ENCRYPTION_KEY"
    "ADMIN_EMAIL=$ADMIN_EMAIL"
    "ADMIN_PASSWORD=$ADMIN_PASSWORD"
    "COOKIE_SECURE=true"
    "ALLOWED_ORIGINS=$APP_URL"
)

# ── Deploy (create on first run, update on re-runs) ───────────────────────────
az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP --output none
if ($LASTEXITCODE -eq 0) {
    Write-Host "-> updating existing app..."
    az containerapp update `
        --name $APP_NAME --resource-group $RESOURCE_GROUP `
        --image $IMAGE --set-env-vars $ENV_VARS --output none
} else {
    Write-Host "-> creating app..."
    az containerapp create `
        --name $APP_NAME --resource-group $RESOURCE_GROUP `
        --environment $ENVIRONMENT --image $IMAGE `
        --target-port 5000 --ingress external `
        --min-replicas 0 --max-replicas 1 `
        --cpu 0.5 --memory 1.0Gi `
        --env-vars $ENV_VARS --output none
}

# ── Ensure the Azure Files volume is mounted at /app/data ────────────────────
$NEEDS_MOUNT = (az containerapp show `
    --name $APP_NAME --resource-group $RESOURCE_GROUP `
    --query "properties.template.volumes[?name=='$STORAGE_MOUNT_NAME'] | length(@)" -o tsv).Trim()

if ($NEEDS_MOUNT -eq "0") {
    Write-Host "-> mounting Azure Files volume..."

    $TMP_JSON = [System.IO.Path]::GetTempFileName() + ".json"
    $jsonOut  = az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP -o json
    [System.IO.File]::WriteAllText($TMP_JSON, $jsonOut -join "`n")

    $PATCH_SCRIPT = [System.IO.Path]::GetTempFileName() + ".js"
    [System.IO.File]::WriteAllText($PATCH_SCRIPT, @'
const fs = require("fs");
const [,, file, mountName] = process.argv;
const app = JSON.parse(fs.readFileSync(file, "utf8"));
const t = app.properties.template;
t.volumes = [{ name: mountName, storageName: mountName, storageType: "AzureFile" }];
t.containers[0].volumeMounts = [{ volumeName: mountName, mountPath: "/app/data" }];
fs.writeFileSync(file, JSON.stringify(app));
'@)

    node $PATCH_SCRIPT $TMP_JSON $STORAGE_MOUNT_NAME

    az containerapp update `
        --name $APP_NAME --resource-group $RESOURCE_GROUP `
        --yaml $TMP_JSON --output none

    Remove-Item $TMP_JSON, $PATCH_SCRIPT -Force -ErrorAction SilentlyContinue
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "OK Live: $APP_URL"
Write-Host ""
Write-Host "  Login:    $ADMIN_EMAIL / $ADMIN_PASSWORD"
Write-Host "  Logs:     az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --tail 50"
Write-Host "  Teardown: az group delete --name $RESOURCE_GROUP --yes --no-wait"
Write-Host ""
Write-Host "  Note: First visit may take 10-20 s (cold start from 0 replicas)."
Write-Host "  Data:     persisted on Azure Files ($STORAGE_ACCOUNT/$SHARE_NAME) - survives updates and restarts."
