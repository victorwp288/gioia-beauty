# Firebase target inventory

Static inventory of Firebase targets found in the repository and its history. This is not a remote provider audit and does not authorize reading or changing any Firebase/Google project.

| Project ID | Known role | Current refactor-tree status | Remote API-key restriction status |
|---|---|---|---|
| `gioia-beauty-b95e0` | Current live Production Firestore/Auth source | Denylisted by the environment gate; no runtime config or browser key remains in the refactor tree | Unknown; requires separately approved `[PROD-READ]` inspection and `[PROD-CONFIG]` for any restriction/rotation change |
| `clinic-418813` | Legacy newsletter export source | Removed legacy script; denylisted | Unknown; ownership, data, restrictions, and retirement value require separately approved inspection |
| `gioia-beauty` | Legacy newsletter import target | Removed legacy script; denylisted | Unknown; ownership, data, restrictions, and retirement value require separately approved inspection |
| `gioia-beauty-2d043` | Legacy subscriber-fix target | Removed legacy script; denylisted | Unknown; ownership, data, restrictions, and retirement value require separately approved inspection |

The older masterplan wording said “three” projects; static inspection proves four distinct IDs. No current application, script, package command, or generated bundle contains their browser API keys. Local/Test/Preview reject all four identifiers before Next starts.

Gitleaks 8.30.1 found 13 historical `gcp-api-key` fingerprints, all traced to Firebase browser configuration in the initial import or the later repository dump. They are baselined in `.gitleaksignore` without repeating the key values. This prevents known public-client identifiers from hiding any new finding; current-tree and full-history scans must both remain clean. Do not rewrite history until the exact remote key restrictions, rotation impact, and rollback value are reviewed.

## Required approved follow-up

For each remote project, record owner/organization, active apps, enabled APIs, HTTP referrer/app restrictions, API quotas, Auth domains, service accounts, data presence, billing, and deletion/retention value. Any restriction, key rotation, disablement, project change, or retirement is separately classified under `docs/PRODUCTION-SAFETY.md`.
