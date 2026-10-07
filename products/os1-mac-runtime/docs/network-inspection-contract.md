# Read-only native connectivity contract

Scope: fix OS-1 inspection turns losing GitHub/Cloudflare access, not reset login or remove read-only/source guards.

Observed original trajectory (private native tool records inspected): same Claude session/model; workspace-write/bypass turn reached APIs, subsequent read-only/dontAsk turn returned sandbox network denials for api.github.com and api.cloudflare.com. The final provider envelope had no permission_denials. A composed R2 shell command returned is_error=false despite native denied-network diagnostics. Wrapper success does not certify inspection success.

Architecture:
- Preserve signed read-only scope, bounded tool grants, user/managed denies, and OS-1 write protection.
- Explicitly permit the selected inspection executor's required GitHub/Cloudflare hosts; no unrestricted wildcard.
- Use the existing official CLIs through `os1 connection-status` for bounded authenticated GET /user and R2 bucket metadata, with no inference, login, account switch, credential copy or installer.
- Read-only MCP filtering is an execution-lane constraint, not proof of disconnected credentials.
- Detect approved-host network denial from current owned native tool results, including success-shaped shell wrappers. Preserve partial evidence; do not mark normal completion, reset auth, switch models or replay side effects.
- Source-only/chat lanes remain isolated. No broad sandbox bypass is introduced.

Verification: deterministic native record/permission/launch fixtures, real read-only native API observation, compile/package/installed binary identity and session/queue preservation. A helper success does not prove every unrelated tool/model works.

Public mechanism references inspected:
- https://code.claude.com/docs/en/sessions#permission-mode-on-resume
- https://code.claude.com/docs/en/sandboxing
- https://www.conductor.build/docs/reference/security-and-permissions
- https://docs.superset.sh/agent-integration
- https://arxiv.org/abs/2210.03629

External feedback and executed native evidence, not generated confidence, govern adoption.
