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
$PLATFORM_EMAIL = if ($env:PLATFORM_ADMIN_EMAIL) { $env:PLATFORM_ADMIN_EMAIL } else { "platform@example.com" }

function Test-GhcrImage([string]$ImageTag) {
    $checkScript = @'
const tag = process.argv[2];
(async () => {
  const tokenResponse = await fetch("https://ghcr.io/token?service=ghcr.io&scope=repository%3Aabdullamattar%2Fsharedaccmanager%3Apull");
  if (!tokenResponse.ok) {
    process.exitCode = 1;
    return;
  }
  const { token } = await tokenResponse.json();
  const manifestResponse = await fetch(`https://ghcr.io/v2/abdullamattar/sharedaccmanager/manifests/${encodeURIComponent(tag)}`, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    },
  });
  process.exitCode = manifestResponse.ok ? 0 : 1;
})().catch(() => {
  process.exitCode = 1;
});
'@
    $checkFile = [IO.Path]::GetTempFileName() + ".mjs"
    try {
        [IO.File]::WriteAllText($checkFile, $checkScript)
        node $checkFile $ImageTag
        return ($LASTEXITCODE -eq 0)
    } finally {
        Remove-Item $checkFile -Force -EA SilentlyContinue
    }
}

function Restore-OldRevisions([string[]]$Revisions) {
    foreach ($revision in $Revisions) {
        az containerapp revision activate --name $APP --resource-group $RG --revision $revision --output none
    }
}

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
Write-Host "-> waiting for GitHub Actions image..."
$imageReady = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
    if (Test-GhcrImage $SHA) {
        $imageReady = $true
        break
    }
    if ($attempt -lt 60) { Start-Sleep -Seconds 10 }
}
if (-not $imageReady) {
    Write-Error "Image $IMAGE is not available in GHCR. Check the GitHub Actions build before deploying."
    exit 1
}
Write-Host "-> image: ready"

# ── Secrets ───────────────────────────────────────────────────────────────────
if (Test-Path $SECRETS) {
    $L = Get-Content $SECRETS
    $SESSION_SECRET  = ($L | Where-Object { $_ -like "SESSION_SECRET=*"        }) -replace "^SESSION_SECRET=",""
    $ENCRYPTION_KEY  = ($L | Where-Object { $_ -like "ENCRYPTION_KEY=*"        }) -replace "^ENCRYPTION_KEY=",""
    $PLATFORM_PASS   = ($L | Where-Object { $_ -like "PLATFORM_ADMIN_PASSWORD=*"}) -replace "^PLATFORM_ADMIN_PASSWORD=",""
    Write-Host "-> secrets: loaded"
} else {
    $SESSION_SECRET = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    $ENCRYPTION_KEY = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    [IO.File]::WriteAllText("$PWD\$SECRETS","SESSION_SECRET=$SESSION_SECRET`nENCRYPTION_KEY=$ENCRYPTION_KEY`n")
    Write-Host "-> secrets: generated"
}

# Platform admin password — generated once on first deploy, never overwritten
if (-not $PLATFORM_PASS) {
    $PLATFORM_PASS = node -e "process.stdout.write(require('crypto').randomBytes(18).toString('base64url'))"
    [IO.File]::AppendAllText("$PWD\$SECRETS","PLATFORM_ADMIN_PASSWORD=$PLATFORM_PASS`n")
    Write-Host "-> platform admin password: generated (saved to $SECRETS)"
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
    # truncate, not delete: journal deletion races SMB metadata caching on Azure
    # Files (SQLITE_IOERR_DELETE_NOENT); truncate never unlinks the journal file
    "SQLITE_JOURNAL_MODE=truncate"
    "SESSION_SECRET=$SESSION_SECRET"
    "ENCRYPTION_KEY=$ENCRYPTION_KEY"
    "ADMIN_EMAIL=$ADMIN_EMAIL"
    "ADMIN_PASSWORD=$ADMIN_PASSWORD"
    "PLATFORM_ADMIN_EMAIL=$PLATFORM_EMAIL"
    "PLATFORM_ADMIN_PASSWORD=$PLATFORM_PASS"
    "COOKIE_SECURE=true"
    "ALLOWED_ORIGINS=$APP_URL,https://account-manager.live"
)

# ── Deploy ────────────────────────────────────────────────────────────────────
$oldRevs = @()
az containerapp show --name $APP --resource-group $RG --output none
if ($LASTEXITCODE -eq 0) {
    # Deactivate old revisions first. With nobrl, SQLite locks are client-local,
    # so an old replica must never write the DB while the new revision migrates.
    # Costs ~30s of downtime; guarantees a single writer.
    Write-Host "-> deactivating old revisions (brief downtime)..."
    $oldRevs = (az containerapp revision list --name $APP --resource-group $RG --query "[?properties.active].name" -o tsv) -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($r in $oldRevs) {
        az containerapp revision deactivate --name $APP --resource-group $RG --revision $r --output none
    }
    Write-Host "-> updating app..."
    az containerapp update --name $APP --resource-group $RG --image $IMAGE --set-env-vars $VARS --min-replicas 1 --max-replicas 1 --output none
    if ($LASTEXITCODE -ne 0) {
        Restore-OldRevisions $oldRevs
        Write-Error "Container App update failed. Previous revisions were reactivated."
        exit 1
    }
} else {
    Write-Host "-> creating app..."
    az containerapp create --name $APP --resource-group $RG --environment $ENV --image $IMAGE --target-port 5000 --ingress external --min-replicas 1 --max-replicas 1 --cpu 0.5 --memory 1.0Gi --env-vars $VARS --output none
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Container App creation failed."
        exit 1
    }
}

# ── Mount Azure Files volume if not already mounted with nobrl ────────────────
# nobrl is REQUIRED: SQLite byte-range lock requests fail on SMB ("database is
# locked" / SQLITE_BUSY on the first write). nobrl keeps locks client-side —
# safe because max-replicas 1 guarantees a single writer.
# Use full JSON + PowerShell parsing — az --query returns empty string (not "null") for null values
$appObj = (az containerapp show --name $APP --resource-group $RG -o json) | ConvertFrom-Json
$vols   = $appObj.properties.template.volumes
$MOUNTED = if (-not $vols) { "0" } else {
    ($vols | Where-Object { $_.name -eq $SHARE -and $_.mountOptions -like "*nobrl*" } | Measure-Object).Count.ToString()
}
if ($MOUNTED -eq "0") {
    Write-Host "-> mounting volume (nobrl)..."
    $TMP  = [IO.Path]::GetTempFileName() + ".json"
    $TMPS = [IO.Path]::GetTempFileName() + ".js"
    [IO.File]::WriteAllText($TMP, (az containerapp show --name $APP --resource-group $RG -o json) -join "`n")
    [IO.File]::WriteAllText($TMPS, 'const fs=require("fs");const[,,f,m]=process.argv;const a=JSON.parse(fs.readFileSync(f,"utf8"));const t=a.properties.template;t.volumes=[{name:m,storageName:m,storageType:"AzureFile",mountOptions:"nobrl"}];t.containers[0].volumeMounts=[{volumeName:m,mountPath:"/app/data"}];fs.writeFileSync(f,JSON.stringify(a));')
    node $TMPS $TMP $SHARE
    az containerapp update --name $APP --resource-group $RG --yaml $TMP --output none
    Remove-Item $TMP,$TMPS -Force -EA SilentlyContinue
    if ($LASTEXITCODE -ne 0) {
        Restore-OldRevisions $oldRevs
        Write-Error "Container App volume mount update failed. Previous revisions were reactivated."
        exit 1
    }
}

Write-Host "-> checking revision health..."
$healthy = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    $latestRev = (az containerapp show --name $APP --resource-group $RG --query "properties.latestRevisionName" -o tsv).Trim()
    if ($latestRev) {
        $revisionJson = az containerapp revision show --name $APP --resource-group $RG --revision $latestRev -o json
        if ($LASTEXITCODE -eq 0 -and $revisionJson) {
            $revision = $revisionJson | ConvertFrom-Json
            if ($revision.properties.runningState -eq "Running" -and $revision.properties.healthState -eq "Healthy") {
                $healthy = $true
                break
            }
        }
    }
    if ($attempt -lt 30) { Start-Sleep -Seconds 10 }
}
if (-not $healthy) {
    Restore-OldRevisions $oldRevs
    Write-Error "The new Container App revision did not become healthy. Previous revisions were reactivated."
    exit 1
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "OK  $APP_URL"
Write-Host ""
Write-Host "  Login:           $ADMIN_EMAIL / $ADMIN_PASSWORD"
Write-Host "  Platform admin:  $PLATFORM_EMAIL / $PLATFORM_PASS"
Write-Host "  Logs:     az containerapp logs show --name $APP --resource-group $RG --tail 50"
Write-Host "  Teardown: az group delete --name $RG --yes --no-wait"
Write-Host ""
Write-Host "  Data persisted on Azure Files ($SA/$SHARE) -survives restarts and redeployments."
