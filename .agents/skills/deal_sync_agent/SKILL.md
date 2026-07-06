---
name: deal_sync_agent
description: Execute, configure, or troubleshoot the Python-based Wishlist Deal Sync Agent that coordinates wishlist data across Steam, GOG, and PSN, filters owned items, queries prices, and checks subscriptions.
---

# Wishlist Deal Sync Agent (DEAL_SYNC_AGENT_V2.PY)

This skill registers instructions and workflows for running, configuring, and maintaining the main Python deal-tracking pipeline script (`deal_sync_agent.py`).

## Core Functionality
The agent executes a 5-phase data aggregation pipeline:
1. **Gathering:** Fetches wishlist & owned game lists from GOG (via username), Steam (via vanity/ID), and PlayStation (via local cache).
2. **Normalization:** Trims trailing punctuation, whitespace, and special symbols (™, ®, ©) to match games accurately across platforms.
3. **Filtering:** Deduplicates the wishlist and discards any title found in any of the user's owned catalogs.
4. **Deals & Subscriptions:** Queries IsThereAnyDeal (ITAD) API v2 for active store discounts, checks GeForce NOW streaming compatibility, and cross-references matching games inside the PlayStation Plus Premium and Amazon Luna catalogs.
5. **Output Compilation:** Compiles findings into a Pydantic-validated JSON payload output.

## System Dependencies
- Python 3.10+
- Packages: `requests`, `beautifulsoup4`, `pydantic` (v1 or v2 compatible)

## Environment Variables
The script relies on the following secrets (loaded from `.env` or system variables):
- `STEAM_ID` (Numeric ID or vanity URL name)
- `STEAM_API_KEY` (Web API access)
- `GOG_USERNAME` (Public profile username)
- `ITAD_API_KEY` (IsThereAnyDeal API access)

## Executing the Agent

### Command Line Usage
```bash
# Run in simulation mode (uses mock data endpoints)
python deal_sync_agent.py --simulate --output deal_alerts_output.json

# Run live sync (requires environment secrets set)
python deal_sync_agent.py --output deal_alerts_output.json
```

### Windows Encoding Workaround
When executing on Windows systems, console page encoding can fail to write emojis used in status prints. Always invoke the script forcing UTF-8:
```powershell
# PowerShell UTF-8 invocation
$env:PYTHONUTF8=1; $env:PYTHONIOENCODING="utf-8"; python deal_sync_agent.py --output deal_alerts_output.json
```

## Troubleshooting Common Errors

### 1. `TypeError: dumps_kwargs keyword arguments are no longer supported.`
- **Cause:** Occurs if Pydantic v2 is installed on the machine and the script attempts to call old `model.json(indent=2)` serialization.
- **Resolution:** Verify that serialization logic is wrapped in a fallback try-catch:
  ```python
  try:
      output_json = payload.model_dump_json(indent=2)
  except AttributeError:
      output_json = payload.json(indent=2)
  ```

### 2. `UnicodeEncodeError: 'charmap' codec can't encode character...`
- **Cause:** Python outputting UTF-8 emojis (like 🚀, ✅, 💾) to a standard Windows console.
- **Resolution:** Set environment variables `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` before invoking the Python process.
