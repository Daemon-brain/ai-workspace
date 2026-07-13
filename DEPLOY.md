# Deploying AI Workspace

The app is a Next.js server + Postgres. Recommended host: **Vercel + Vercel
Postgres (Neon)** — the same stack Daemon runs on.

## One-time setup (in the Vercel dashboard)

1. **Import the repo**
   Vercel → *Add New… → Project* → import `Daemon-brain/ai-workspace`.
   Framework preset auto-detects **Next.js**. Don't deploy yet.

2. **Add a database**
   Project → *Storage → Create Database → Postgres* (Neon).
   Vercel injects `DATABASE_URL` (and friends) into the project automatically.

3. **Add the encryption secret**
   Project → *Settings → Environment Variables* → add:
   - `WORKSPACE_SECRET` = output of `openssl rand -hex 32` (encrypts provider keys at rest)
   - *(optional)* `NEXT_PUBLIC_BRAIN_URL` = `https://brain.daemon-tech.fr` (the dashboard "Brain" link; this is the default)

4. **Deploy** → *Deployments → Redeploy* (or push to `main`).

5. **Create the tables** — once `DATABASE_URL` exists, run the schema push
   against it (locally, one time):
   ```bash
   DATABASE_URL="<prod url from Vercel>" npm run db:push
   ```
   (Or set it and let me run it for you.)

6. Open the deployment, go to **/settings**, add your providers, and chat.

## Notes

- **maxDuration** is set to 60s on `/api/chat` for streamed replies (hobby tier max).
- The orchestrator keeps provider-cooldown state in memory — fine for a single
  instance. For multi-instance scale, move it to a shared store (Redis/pg);
  failover still works per-request regardless.
- A custom subdomain (e.g. `workspace.daemon-tech.fr`) can be added under
  Project → *Settings → Domains*.
