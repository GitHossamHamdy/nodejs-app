### Node Express template project

This project is based on a GitLab [Project Template](https://docs.gitlab.com/ee/gitlab-basics/create-project.html).

Improvements can be proposed in the [original project](https://gitlab.com/gitlab-org/project-templates/express).

### Application logging

`npm start` writes newline-delimited JSON with UTC `timestamp`, `level`, and
`event` fields. Debug/info go to stdout; warnings/errors go to stderr. Set
`LOG_LEVEL` to `debug`, `info` (default), `warn`, `error`, or `silent`, for example
`LOG_LEVEL=warn npm start`. Values are case-insensitive; invalid values use `info`.
No additional dependencies or log files are required.

- HTTP records (`request_complete`) include method, route template, status,
  duration in milliseconds, and completion state. Successful responses are info,
  4xx responses warn, and 5xx/disconnected responses error.
- Only application-defined route templates are logged, never raw URLs or parameter
  values. Unknown routes and static assets use `[unmatched]`. Register new routers
  with `requestLogger.route()` and a fixed mount template, as in `app.js`.
- `application_error` records exclude raw error messages and stacks. Headers,
  cookies, bodies, query strings, and client addresses are never included.
  Additional application log fields must also be free of sensitive data.
- `server_listening`, `server_stopping`, and `server_stopped` track the lifecycle.
  SIGINT/SIGTERM drain active requests for up to ten seconds, preserving Node's
  signal termination status. Startup failures exit with status 1; server errors
  and shutdown timeouts use error-level records.

`npm test` covers logging privacy, levels, real HTTP requests, startup failures,
request draining, and forced shutdown for both signals. GitHub Actions runs the
suite on Node 14 (the existing project version), 22, and 24. Production deployments
should set `NODE_ENV=production` for Express's production error-page behavior.

### CI/CD with Auto DevOps

This template is compatible with [Auto DevOps](https://docs.gitlab.com/ee/topics/autodevops/).

If Auto DevOps is not already enabled for this project, you can [turn it on](https://docs.gitlab.com/ee/topics/autodevops/#enabling-auto-devops) in the project settings.

### Developing with Gitpod

This template has a fully-automated dev setup for [Gitpod](https://docs.gitlab.com/ee/integration/gitpod.html).

If you open this project in Gitpod, you'll get all Node dependencies pre-installed and Express will open a web preview.
