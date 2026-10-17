### Node Express template project

This project is based on a GitLab [Project Template](https://docs.gitlab.com/ee/gitlab-basics/create-project.html).

Improvements can be proposed in the [original project](https://gitlab.com/gitlab-org/project-templates/express).

### Application logging

Run `npm start` to emit newline-delimited JSON logs with UTC `timestamp`, `level`
and `event` fields. Info/debug records go to stdout; warnings/errors go to stderr.
Set `LOG_LEVEL` to `debug`, `info` (default), `warn`, `error`, or `silent` to control
verbosity, for example `LOG_LEVEL=warn npm start`. Values are case-insensitive;
invalid values fall back to `info`. No additional packages or log files are needed.

- `request_complete` records include method, route template, status, duration in
  milliseconds and whether the response completed. Successes are info, 4xx are
  warnings, and 5xx or disconnected responses are errors.
- Paths use application-defined mount/route templates (for example `/users/`),
  never raw URLs or parameter values. Static assets and unknown routes are
  labelled `[unmatched]`. Register new routers with `requestLogger.route()` and a
  fixed mount template, as in `app.js`.
- `application_error` records identify failed requests without raw error messages
  or stacks. Headers, cookies, bodies, query strings and client addresses are
  deliberately excluded. Keep additional log fields free of sensitive data.
- `server_listening`, `server_stopping`, and `server_stopped` track the lifecycle.
  SIGINT/SIGTERM stop accepting new connections and drain requests for up to ten
  seconds; a timeout or server error is logged at error level and exits nonzero.

Run `npm test` for the existing application tests plus logging/privacy and
server lifecycle tests. Production deployments should also set
`NODE_ENV=production` to retain Express's production error-page behavior.

### CI/CD with Auto DevOps

This template is compatible with [Auto DevOps](https://docs.gitlab.com/ee/topics/autodevops/).

If Auto DevOps is not already enabled for this project, you can [turn it on](https://docs.gitlab.com/ee/topics/autodevops/#enabling-auto-devops) in the project settings.

### Developing with Gitpod

This template has a fully-automated dev setup for [Gitpod](https://docs.gitlab.com/ee/integration/gitpod.html).

If you open this project in Gitpod, you'll get all Node dependencies pre-installed and Express will open a web preview.
