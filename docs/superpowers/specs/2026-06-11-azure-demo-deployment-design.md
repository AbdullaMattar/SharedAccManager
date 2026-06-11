# Azure Demo Deployment Design

**Date:** 2026-06-11  
**Goal:** Deploy SharedAccManager as a live demo on Azure for customer review, using existing mock/seed data.

## Context

- Monorepo: React frontend (accounts-manager) + Node.js API (api-server) + SQLite (lib/db)
- Existing `Dockerfile` (multi-stage, production-ready) and `docker-compose.yml` already in repo
- Seed data (Netflix, Spotify, ChatGPT products + one Netflix account) runs automatically on first boot
- No Docker Desktop on local machine — image will be built in Azure via `az acr build`
- $100 Azure student credit; demo only (data resets on container restart is acceptable)

## Architecture

```
Local code
    │
    │  az acr build  (sends code to Azure → Azure builds Docker image)
    ▼
Azure Container Registry (Basic)   ← stores the image
    │
    │  deploy
    ▼
Azure Container Apps               ← runs container, provides public HTTPS URL
    │
    └── SQLite: ephemeral, inside container (resets on restart — acceptable for demo)
```

## Azure Resources

| Resource | Name | SKU | Est. Cost |
|---|---|---|---|
| Resource Group | `shared-acc-rg` | — | Free |
| Container Registry | `sharedaccreg` | Basic | ~$5/month |
| Container Apps Environment | `shared-acc-env` | Consumption | ~$0 idle |
| Container App | `shared-acc-app` | Consumption | ~$0-2/month |

**Total: ~$5-7/month** from $100 credit.

## Environment Variables

| Variable | Value |
|---|---|
| `SESSION_SECRET` | 64-char hex (generated at deploy time) |
| `ENCRYPTION_KEY` | 64-char hex (generated at deploy time) |
| `ADMIN_EMAIL` | User-chosen login email |
| `ADMIN_PASSWORD` | User-chosen login password |
| `DATABASE_URL` | `file:/app/data/app.db` |
| `NODE_ENV` | `production` |
| `PORT` | `5000` |

## Deployment Steps

1. Install Azure CLI on local machine
2. `az login` to authenticate with Azure account
3. Create Resource Group and Container Registry
4. `az acr build` — uploads local code to Azure, builds Docker image there (no Docker Desktop needed)
5. Enable ACR admin credentials for Container Apps pull access
6. Create Container Apps environment (networking layer)
7. Deploy Container App: pull image from ACR, set env vars, expose port 5000
8. App is live with auto-generated public HTTPS URL
9. Seed data runs on first boot via `seed.ts`

## Constraints & Decisions

- **No Docker Desktop required** — `az acr build` handles building in the cloud
- **Ephemeral SQLite** — acceptable for demo; add Azure Files mount later if shipping
- **Scale to zero** — Container Apps idles to zero between demo sessions, minimizing cost
- **Single container** — frontend is served as static files from the same Node.js process

## Future (if customer approves)

- Mount Azure Files for persistent SQLite storage
- Push repo to GitHub + add GitHub Actions for automated deploys
- Switch to Azure Container Apps with min replicas > 0 for production SLA
