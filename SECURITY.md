# Security and deployment checklist

## Repository hardening
- Protect the main branch with pull request requirements.
- Require approvals and status checks before merge.
- Disable direct pushes to production branches.
- Keep GitHub Actions permissions minimal.

## Application hardening
- Store secrets in environment variables or a secret manager.
- Enforce HTTPS in production.
- Add rate limiting and request validation as the app grows.
- Keep dependencies updated and scan for vulnerabilities.

## Runtime hardening
- Run the app as a non-root user in containers.
- Use health checks and restart policies.
- Enable logging, metrics, alerts, and backups.
