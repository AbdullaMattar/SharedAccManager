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

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"

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

# ── Env vars ──────────────────────────────────────────────────────────────────
ENV_VARS=(
  "NODE_ENV=production"
  "PORT=5000"
  "SQLITE_URL=file:/app/data/app.db"
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

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✓ Live: $APP_URL"
echo ""
echo "  Login:    $ADMIN_EMAIL / $ADMIN_PASSWORD"
echo "  Logs:     az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --tail 50"
echo "  Teardown: az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo ""
echo "  Note: First visit may take 10-20 s (cold start from 0 replicas)."
echo "  Note: SQLite data resets on container restart — use Azure Files for persistence."
