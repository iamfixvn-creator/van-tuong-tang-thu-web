# Security notes / known limitations

- API checks role permissions server-side; frontend hiding is only a convenience.
- Sessions are stored in SQLite and cookies are HttpOnly, Secure in production, SameSite Strict.
- Mutating API requests require a session CSRF token.
- Login endpoint is rate-limited; passwords use bcrypt cost 12.
- Data is stored in one SQLite file. This is suitable only for a small, single-instance pilot, not high availability or multi-instance scaling.
- Photo data URLs are stored in JSON payloads in SQLite. This is simple for a pilot but not an ideal long-term document store; migrate to private object storage for production.
- There is no immutable audit log, MFA, IP allowlist, formal backup scheduler, retention workflow, or independent penetration test in this starter.
- The UI's old "viewer" role can view records and export data; confirm this matches the organization's policy before production.
- A signed-in user's role is copied into the session. After an admin changes a role, ask the user to sign out and back in (or invalidate their session) for the change to take effect immediately.
