# CI and CD

## Current state

The `CI` workflow runs for each pull request and each push to `autonomous-agents`.
It installs locked Node.js packages and pinned Python packages.
It audits both dependency sets. It runs all tests, the TypeScript check, and the production build.

The `Deploy` workflow targets Vercel production after successful default-branch CI.
The repository variable `VERCEL_DEPLOY_ENABLED` controls this job.
Its initial value is `false`, so no deployment or charge can occur.

The deployment workflow never calls Modal.

## Enable Vercel production

1. Authenticate the Vercel CLI and link the correct Stella project.

   ```bash
   vercel login
   vercel link
   ```

2. Add the scoped Vercel token through the secure prompt.

   ```bash
   gh secret set VERCEL_TOKEN
   ```

3. Copy the linked project IDs into GitHub secrets.

   ```bash
   jq -r .orgId .vercel/project.json | gh secret set VERCEL_ORG_ID
   jq -r .projectId .vercel/project.json | gh secret set VERCEL_PROJECT_ID
   ```

4. Enable deployment after all three secrets exist.

   ```bash
   gh variable set VERCEL_DEPLOY_ENABLED --body true
   ```

Set the variable to `false` to stop automatic deployments.

```bash
gh variable set VERCEL_DEPLOY_ENABLED --body false
```
