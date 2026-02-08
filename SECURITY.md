# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.1.x | Yes |
| 1.0.x | Limited (security fixes at maintainer discretion) |

## Reporting a Vulnerability

Do not open public issues for undisclosed vulnerabilities.

Preferred channels:
1. GitHub Security Advisories (private report)
2. If unavailable, contact repository maintainer directly via trusted channel

Please include:
- vulnerability description
- impact and affected components
- reproduction steps
- suggested mitigation (optional)

## Response Targets

- Initial acknowledgement: within 72 hours
- Triage decision: within 7 days
- Patch target: depends on severity and exploitability

## Scope

In scope:
- `server/` (HTTP/WS APIs, sync logic, agent layer)
- `plugin/` (Studio bridge and autonomous test execution)
- `vscode-extension/` (editor client and command surface)

Out of scope:
- vulnerabilities only present in third-party upstream dependencies (tracked separately)
- local-only misconfiguration where server is intentionally exposed

## Security Best Practices for Users

- Keep server bound to local/trusted network only.
- Do not expose sync port publicly.
- Keep dependencies updated.
- Treat generated debug bundles/artifacts as potentially sensitive project state.
