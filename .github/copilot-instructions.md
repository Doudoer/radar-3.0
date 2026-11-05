# Radar publishing workflow

In this project, when the owner says "sube a github", "sube los cambios",
or an equivalent publishing request, treat it as authorization to publish
the current requested changes AND deploy them to the production VPS.
Do not ask again whether the request includes production.

- Validate the relevant changes, commit without secrets or runtime data,
  push, and complete the PR into `main` after required checks pass.
  A push to a feature branch alone does not complete this request.
- Updating `main` starts the existing production workflow automatically.
  Let it prepare backups/migrations and promote the same SHA to `production`;
  do not bypass the gate or push directly to `production`.
- No interactive SSH session or manual Dokploy click is needed for routine
  releases. Investigate actual failures rather than asking the owner to run
  routine deployment commands.
- Follow the Actions run through deployment verification and confirm the live
  revision and HTTPS health before reporting that changes are applied.
  Report a failed or blocked release explicitly; a successful push is not a
  successful deployment.
- Explicit requests such as "solo GitHub", "sin desplegar", or "no publiques"
  override this default. Material destructive/data-loss decisions still
  require approval; never bypass branch protections or failed checks.

See [the production guide](../DESPLIEGUE_PRODUCCION.md) for the installed path.
