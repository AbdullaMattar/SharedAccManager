---
name: Workflow port constraint
description: Replit workflow health check only works on a fixed list of ports — unsupported ports cause silent timeout failures.
---

**Rule:** Always use a port from the supported list for workflow services.

**Why:** The Replit workflow system's port health check only detects ports in this list: `3000, 3001, 3002, 3003, 4200, 5000, 5173, 6000, 6800, 8000, 8008, 8080, 8099, 9000`. A service running on port 18969 (the default artifact-assigned port for accounts-manager) starts fine and responds to HTTP, but the workflow health check times out with "didn't open port 18969" — even though the port IS open.

**How to apply:** When an artifact-managed workflow fails with "didn't open port X" and X is not in the supported list, use `verifyAndReplaceArtifactToml` to change the `localPort` and `[services.env] PORT` to a supported port (e.g. 5173 for Vite frontends). The configureWorkflow callback cannot override artifact-managed workflows.
