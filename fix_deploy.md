# Deployment Issues & Fixes

## Environment
- Windows 10, PowerShell 5.1
- Azure CLI with containerapp extension 1.3.0b4 (preview, only available version)
- Azure for Students subscription

---

## Issue 1: containerapp extension breaks az storage and az group create

**Symptom:**
```
(SubscriptionNotFound) Subscription 77823638-... was not found.
```
Happens on `az storage account create`, `az group create`, and `az storage account keys list`.
The extension even prints `WARNING: The behavior of this command has been altered by the following extension: containerapp` on `az group create`, which it should never touch.

**Root cause:** containerapp extension v1.3.0b4 intercepts unrelated az commands and routes them through a broken code path.

**Fix:** Remove the extension before any storage/group operations, then add it back before containerapp operations:
```powershell
az extension remove --name containerapp --output none
# ... az group create, az storage account create, az storage account keys list, az storage share-rm create ...
az extension add --name containerapp --output none
# ... az containerapp env *, az containerapp * ...
```

---

## Issue 2: Script ran from wrong directory

**Symptom:**
```
fatal: not a git repository (or any of the parent directories): .git
You cannot call a method on a null-valued expression.  ($SHA = (git rev-parse HEAD).Trim())
```

**Root cause:** User ran deploy.cmd from a different directory.

**Fix:** `cd /d "%~dp0"` at the top of the batch file (already in deploy.cmd).

---

## Issue 3: PowerShell encoding broke em dashes in strings

**Symptom:**
```
The string is missing the terminator: "
```
Em dash `—` in source was read as `â€"` (UTF-8 bytes decoded as Windows-1252), corrupting string literals and causing parse errors.

**Fix:**
1. Force UTF-8 when reading the .cmd file: `[IO.File]::ReadAllLines($self, [Text.Encoding]::UTF8)`
2. Avoid non-ASCII characters in the PowerShell section of deploy.cmd — use plain `-` instead of `—`

---

## Issue 4: `<name>` in PowerShell string

**Symptom:**
```
The '<' operator is reserved for future use.
```

**Root cause:** PowerShell reserves `<` as an operator. When the encoding corruption (Issue 3) broke a nearby string, `<name>` ended up outside a string context and was parsed as an operator.

**Fix:** Replace `<name>` with `NAME` in the help text. (After fixing Issue 3 this likely stops being a problem, but safer to avoid `<>` in strings entirely.)

---

## Issue 5: az containerapp env storage set — missing arguments

**Symptom:**
```
TypeError: object of type 'NoneType' has no len()
```
Traceback in `containerapp_env_storage_decorator.py` validate_arguments.

**Root cause:** User copy-pasted a multi-line command and PowerShell treated the second line as a separate command, leaving `--azure-file-account-key` and `--azure-file-share-name` missing.

**Fix:** Always run the full `az containerapp env storage set` command as a single unbroken line.

---

## Current State (end of session 2026-06-12)

- Storage account `sharedacca5c16cc8` created manually in resource group `shared-acc-rg`
- File share `appdata` created
- `az containerapp env storage set` was run successfully (storage registered with env)
- Volume mount patch (volumes + volumeMounts on the container) was NOT yet confirmed — needs verification next session:
  ```powershell
  az containerapp show --name shared-acc-app --resource-group shared-acc-rg --query "properties.template.volumes" -o json
  ```
  If result is `null` or `[]`, run the mount patch commands in deploy.cmd manually.

- deploy.cmd is now self-contained and handles the extension removal/restore automatically.
- Next deploy should be a clean double-click of deploy.cmd.
