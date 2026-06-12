@echo off
setlocal
cd /d "%~dp0"
set "SELF=%~f0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$self=$env:SELF; $tmp=[IO.Path]::GetTempFileName()+'.ps1'; $lines=[IO.File]::ReadAllLines($self,[Text.Encoding]::UTF8); $i=0; while($i -lt $lines.Length -and $lines[$i] -ne ':: ==PS_START=='){$i++}; [IO.File]::WriteAllLines($tmp,$lines[($i+1)..($lines.Length-1)],[Text.Encoding]::UTF8); try{ & $tmp }finally{ Remove-Item $tmp -Force -EA 0 }"

if %ERRORLEVEL% neq 0 ( echo. & echo Deploy failed. )
pause
exit /b

:: ==PS_START==
# SharedAccManager -deploy to Azure Container Apps
# Re-run at any time to push the latest commit.
# Prereqs: az login, Node.js, git

$RG      = "shared-acc-rg"
$LOC     = "francecentral"
$ENV     = "shared-acc-env"
$APP     = "shared-acc-app"
$REPO    = "ghcr.io/abdullamattar/sharedaccmanager"
$SECRETS = ".deploy-secrets"
$SHARE   = "appdata"

$ADMIN_EMAIL    = if ($env:ADMIN_EMAIL)    { $env:ADMIN_EMAIL }    else { "admin@example.com" }
$ADMIN_PASSWORD = if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } else { "admin123" }

# ── Prereqs ───────────────────────────────────────────────────────────────────
foreach ($c in "az","node","git") {
    if (-not (Get-Command $c -EA SilentlyContinue)) { Write-Error "$c not found"; exit 1 }
}
az account show --output none
if ($LASTEXITCODE -ne 0) { Write-Error "Not logged in -run: az login"; exit 1 }

Write-Host "-> subscription: $((az account show --query 'name' -o tsv).Trim())"
Write-Host "   (wrong? run: az account set --subscription NAME)"
Write-Host ""

# ── Image ─────────────────────────────────────────────────────────────────────
$SHA   = (git rev-parse HEAD).Trim()
$IMAGE = "${REPO}:${SHA}"
Write-Host "-> image: $IMAGE"

# ── Secrets ───────────────────────────────────────────────────────────────────
if (Test-Path $SECRETS) {
    $L = Get-Content $SECRETS
    $SESSION_SECRET = ($L | Where-Object { $_ -like "SESSION_SECRET=*" }) -replace "^SESSION_SECRET=",""
    $ENCRYPTION_KEY = ($L | Where-Object { $_ -like "ENCRYPTION_KEY=*"  }) -replace "^ENCRYPTION_KEY=",""
    Write-Host "-> secrets: loaded"
} else {
    $SESSION_SECRET = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    $ENCRYPTION_KEY = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    [IO.File]::WriteAllText("$PWD\$SECRETS","SESSION_SECRET=$SESSION_SECRET`nENCRYPTION_KEY=$ENCRYPTION_KEY`n")
    Write-Host "-> secrets: generated"
}

$L = Get-Content $SECRETS
$sl = $L | Where-Object { $_ -like "STORAGE_ACCOUNT=*" }
if ($sl) {
    $SA = $sl -replace "^STORAGE_ACCOUNT=",""
} else {
    $SA = "sharedacc$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")"
    [IO.File]::AppendAllText("$PWD\$SECRETS","STORAGE_ACCOUNT=$SA`n")
}
Write-Host "-> storage: $SA/$SHARE"

# ── Remove containerapp extension -it breaks az storage + az group ───────────
Write-Host "-> (disabling containerapp ext for storage ops)"
az extension remove --name containerapp --output none

# ── Resource group ────────────────────────────────────────────────────────────
Write-Host "-> resource group..."
az group create --name $RG --location $LOC --output none

# ── Storage account + file share ──────────────────────────────────────────────
Write-Host "-> storage account..."
az storage account create --name $SA --resource-group $RG --location $LOC --sku Standard_LRS --kind StorageV2 --output none

$STORAGE_KEY = (az storage account keys list --account-name $SA --resource-group $RG --query "[0].value" -o tsv).Trim()
if (-not $STORAGE_KEY) { Write-Error "Could not get storage key -check az errors above"; exit 1 }

Write-Host "-> file share..."
az storage share-rm create --resource-group $RG --storage-account $SA --name $SHARE --quota 5 --output none
$global:LASTEXITCODE = 0  # not fatal if share already exists

# ── Restore containerapp extension ────────────────────────────────────────────
Write-Host "-> (restoring containerapp ext)"
az extension add --name containerapp --output none

# ── Container Apps environment ────────────────────────────────────────────────
az containerapp env show --name $ENV --resource-group $RG --output none
if ($LASTEXITCODE -ne 0) {
    Write-Host "-> environment (takes ~2 min)..."
    az containerapp env create --name $ENV --resource-group $RG --location $LOC --output none
}

$DOMAIN  = (az containerapp env show --name $ENV --resource-group $RG --query "properties.defaultDomain" -o tsv).Trim()
$APP_URL = "https://${APP}.${DOMAIN}"

# ── Register Azure Files with the environment ─────────────────────────────────
Write-Host "-> registering Azure Files..."
az containerapp env storage set --name $ENV --resource-group $RG --storage-name $SHARE --azure-file-account-name $SA --azure-file-account-key $STORAGE_KEY --azure-file-share-name $SHARE --access-mode ReadWrite --output none

# ── Env vars ──────────────────────────────────────────────────────────────────
$VARS = @(
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

# ── Deploy ────────────────────────────────────────────────────────────────────
az containerapp show --name $APP --resource-group $RG --output none
if ($LASTEXITCODE -eq 0) {
    Write-Host "-> updating app..."
    az containerapp update --name $APP --resource-group $RG --image $IMAGE --set-env-vars $VARS --output none
} else {
    Write-Host "-> creating app..."
    az containerapp create --name $APP --resource-group $RG --environment $ENV --image $IMAGE --target-port 5000 --ingress external --min-replicas 0 --max-replicas 1 --cpu 0.5 --memory 1.0Gi --env-vars $VARS --output none
}

# ── Mount Azure Files volume if not already mounted ───────────────────────────
# volumes can be null (never set) or an array — handle both
$volJson = (az containerapp show --name $APP --resource-group $RG --query "properties.template.volumes" -o json).Trim()
$MOUNTED = if ($volJson -eq "null" -or -not $volJson) {
    "0"
} else {
    ($volJson | ConvertFrom-Json | Where-Object { $_.name -eq $SHARE } | Measure-Object).Count.ToString()
}
if ($MOUNTED -eq "0") {
    Write-Host "-> mounting volume..."
    $TMP  = [IO.Path]::GetTempFileName() + ".json"
    $TMPS = [IO.Path]::GetTempFileName() + ".js"
    [IO.File]::WriteAllText($TMP, (az containerapp show --name $APP --resource-group $RG -o json) -join "`n")
    [IO.File]::WriteAllText($TMPS, 'const fs=require("fs");const[,,f,m]=process.argv;const a=JSON.parse(fs.readFileSync(f,"utf8"));const t=a.properties.template;t.volumes=[{name:m,storageName:m,storageType:"AzureFile"}];t.containers[0].volumeMounts=[{volumeName:m,mountPath:"/app/data"}];fs.writeFileSync(f,JSON.stringify(a));')
    node $TMPS $TMP $SHARE
    az containerapp update --name $APP --resource-group $RG --yaml $TMP --output none
    Remove-Item $TMP,$TMPS -Force -EA SilentlyContinue
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "OK  $APP_URL"
Write-Host ""
Write-Host "  Login:    $ADMIN_EMAIL / $ADMIN_PASSWORD"
Write-Host "  Logs:     az containerapp logs show --name $APP --resource-group $RG --tail 50"
Write-Host "  Teardown: az group delete --name $RG --yes --no-wait"
Write-Host ""
Write-Host "  Data persisted on Azure Files ($SA/$SHARE) -survives restarts and redeployments."
