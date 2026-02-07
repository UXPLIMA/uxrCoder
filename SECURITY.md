# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability within uxrCoder, please follow these steps:

### Do NOT

- Open a public issue describing the vulnerability
- Share details of the vulnerability publicly before it's fixed

### Do

1. **Email us directly** at security@example.com with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

2. **Allow time for response** - We will acknowledge receipt within 48 hours

3. **Work with us** - We'll keep you informed of progress toward a fix

### What to expect

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Usually within 30 days for critical issues

### After the fix

- We will credit you in the CHANGELOG (unless you prefer to remain anonymous)
- We will notify you when the fix is released

## Security Best Practices

When using uxrCoder:

1. **Keep dependencies updated** - Run `npm update` regularly
2. **Use localhost only** - The server binds to 0.0.0.0 by default for compatibility, but is designed for local use
3. **Don't expose the server** - Never port-forward or expose the sync server to the internet
4. **Review plugin permissions** - Ensure the Roblox plugin only has necessary permissions

## Scope

This security policy covers:

- The Node.js sync server (`server/`)
- The VS Code extension (`vscode-extension/`)
- The Roblox Studio plugin (`plugin/`)

Third-party dependencies are not covered by this policy but will be updated if vulnerabilities are discovered.
