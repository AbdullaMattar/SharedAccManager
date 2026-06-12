#!/usr/bin/env bash
# Deploy SharedAccManager to Azure Container Apps.
# Usage:  bash deploy.sh
# Re-run at any time to update the running app to the latest git commit.
#
# Prereqs: Azure CLI (az login), Node.js, git
# Region:  francecentral (Azure for Students allowed regions)
# Image:   pulled from ghcr.io — no local Docker needed
# Data:    SQLite is ephemeral (resets on container restart) — acceptable for demo
#
# Teardown: az group delete --name shared-acc-rg --yes --no-wait
set -euo pipefail

RESOURCE_GROUP="shared-acc-rg"
LOCATION="francecentral"
ENVIRONMENT="shared-acc-env"
APP_NAME="shared-acc-app"
IMAGE_REPO="ghcr.io/abdullamattar/sharedaccmanager"
SECRETS_FILE=".deploy-secrets"
SHARE_NAME="appdata"
STORAGE_MOUNT_NAME="appdata"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
# Matches the «استخدم حساب تجريبي» demo button on the login page
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

# ── Prereq checks ─────────────────────────────────────────────────────────────
command -v az   >/dev/null 2>&1 || { echo "ERROR: Azure CLI not installed."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js not installed (needed to generate secrets)."; exit 1; }
az account show --output none 2>/dev/null || { echo "ERROR: Not logged in. Run: az login"; exit 1; }
az extension add --name containerapp --upgrade --output none 2>/dev/null || true

# ── Image tag — always use the full commit SHA, never 'latest' ────────────────
SHA=$(git rev-parse HEAD)
IMAGE="${IMAGE_REPO}:${SHA}"
echo "→ image:   $IMAGE"

# ── Secrets — generate once on first run, reuse on re-runs ───────────────────
if [ -f "$SECRETS_FILE" ]; then
  SESSION_SECRET=$(grep "^SESSION_SECRET=" "$SECRETS_FILE" | cut -d= -f2-)
  ENCRYPTION_KEY=$(grep "^ENCRYPTION_KEY=" "$SECRETS_FILE" | cut -d= -f2-)
  echo "→ secrets: loaded from $SECRETS_FILE"
else
  SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  ENCRYPTION_KEY=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  printf "SESSION_SECRET=%s\nENCRYPTION_KEY=%s\n" "$SESSION_SECRET" "$ENCRYPTION_KEY" > "$SECRETS_FILE"
  echo "→ secrets: generated and saved to $SECRETS_FILE (gitignored)"
fi

# ── Storage account name — generated once, reused (must be globally unique) ──
if grep -q "^STORAGE_ACCOUNT=" "$SECRETS_FILE" 2>/dev/null; then
  STORAGE_ACCOUNT=$(grep "^STORAGE_ACCOUNT=" "$SECRETS_FILE" | cut -d= -f2-)
else
  STORAGE_ACCOUNT="sharedacc$(node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))")"
  printf "STORAGE_ACCOUNT=%s\n" "$STORAGE_ACCOUNT" >> "$SECRETS_FILE"
fi
echo "→ storage:  $STORAGE_ACCOUNT/$SHARE_NAME"

# ── Resource group ────────────────────────────────────────────────────────────
echo "→ resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

# ── Container Apps environment ────────────────────────────────────────────────
if ! az containerapp env show \
     --name "$ENVIRONMENT" \
     --resource-group "$RESOURCE_GROUP" \
     --output none 2>/dev/null; then
  echo "→ environment (takes ~2 min)..."
  az containerapp env create \
    --name "$ENVIRONMENT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output none
fi

DEFAULT_DOMAIN=$(az containerapp env show \
  --name "$ENVIRONMENT" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.defaultDomain" -o tsv)

APP_URL="https://${APP_NAME}.${DEFAULT_DOMAIN}"

# ── Azure Files share for persistent SQLite data ─────────────────────────────
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --output none

STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[0].value" -o tsv)

az storage share-rm create \
  --resource-group "$RESOURCE_GROUP" \
  --storage-account "$STORAGE_ACCOUNT" \
  --name "$SHARE_NAME" \
  --quota 5 \
  --output none 2>/dev/null || true

az containerapp env storage set \
  --name "$ENVIRONMENT" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-name "$STORAGE_MOUNT_NAME" \
  --azure-file-account-name "$STORAGE_ACCOUNT" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$SHARE_NAME" \
  --access-mode ReadWrite \
  --output none

# ── Env vars ──────────────────────────────────────────────────────────────────
ENV_VARS=(
  "NODE_ENV=production"
  "PORT=5000"
  "SQLITE_URL=file:/app/data/app.db"
  "SQLITE_JOURNAL_MODE=delete"
  "SESSION_SECRET=${SESSION_SECRET}"
  "ENCRYPTION_KEY=${ENCRYPTION_KEY}"
  "ADMIN_EMAIL=${ADMIN_EMAIL}"
  "ADMIN_PASSWORD=${ADMIN_PASSWORD}"
  "COOKIE_SECURE=true"
  "ALLOWED_ORIGINS=${APP_URL}"
)

# ── Deploy (create on first run, update on re-runs) ───────────────────────────
if az containerapp show \
   --name "$APP_NAME" \
   --resource-group "$RESOURCE_GROUP" \
   --output none 2>/dev/null; then
  echo "→ updating existing app..."
  az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$IMAGE" \
    --set-env-vars "${ENV_VARS[@]}" \
    --output none
else
  echo "→ creating app..."
  az containerapp create \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT" \
    --image "$IMAGE" \
    --target-port 5000 \
    --ingress external \
    --min-replicas 0 \
    --max-replicas 1 \
    --cpu 0.5 \
    --memory 1.0Gi \
    --env-vars "${ENV_VARS[@]}" \
    --output none
fi

# ── Ensure the Azure Files volume is mounted at /app/data ────────────────────
NEEDS_MOUNT=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.template.volumes[?name=='$STORAGE_MOUNT_NAME'] | length(@)" -o tsv)

if [ "$NEEDS_MOUNT" = "0" ]; then
  echo "→ mounting Azure Files volume..."
  TMP_JSON=$(mktemp)
  az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    -o json > "$TMP_JSON"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const mountName = process.argv[2];
    const app = JSON.parse(fs.readFileSync(file, "utf8"));
    const t = app.properties.template;
    t.volumes = [{ name: mountName, storageName: mountName, storageType: "AzureFile" }];
    t.containers[0].volumeMounts = [{ volumeName: mountName, mountPath: "/app/data" }];
    fs.writeFileSync(file, JSON.stringify(app));
  ' "$TMP_JSON" "$STORAGE_MOUNT_NAME"
  az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --yaml "$TMP_JSON" \
    --output none
  rm -f "$TMP_JSON"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✓ Live: $APP_URL"
echo ""
echo "  Login:    $ADMIN_EMAIL / $ADMIN_PASSWORD"
echo "  Logs:     az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --tail 50"
echo "  Teardown: az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo ""
echo "  Note: First visit may take 10-20 s (cold start from 0 replicas)."
echo "  Data:     persisted on Azure Files ($STORAGE_ACCOUNT/$SHARE_NAME) — survives updates and restarts."
