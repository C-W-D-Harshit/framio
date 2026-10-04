# Product analytics and errors

Framio uses one random installation ID in `~/.framio/telemetry.json` across the CLI, supervisor, local server and Studio. This measures installations, not individual humans. Different machines count separately. All events disable person profile processing and GeoIP enrichment. Studio browser events also contain SDK browser, device, screen, viewport, timezone and session metadata. Browser persistence stays in memory, with the server-supplied ID reused after reloads and port changes.

Packaged binaries enable telemetry by default. Source checkouts require `FRAMIO_TELEMETRY=1`, even with a saved `on` preference. Truthy `DO_NOT_TRACK` always disables telemetry. `FRAMIO_TELEMETRY` overrides the saved preference. Values `0`, `false`, `off`, `no` and an empty string mean off, without case sensitivity. Otherwise the saved preference applies to binaries.

`framio telemetry` or `framio telemetry status` displays the effective setting. `framio telemetry on` and `framio telemetry off` save the preference without sending events. Restart running servers and reload Studio after changing preferences or environment variables. The installation and notice claim files in `~/.framio` prevent concurrent processes from repeating the first-run event and notice. An installation first created through the preference command is counted on its first enabled run.

## Event catalog

Common properties: `app` (`cli`, `server`, `studio`), `framio_version`, `os`, `arch`, `compiled`, `$process_person_profile: false`, `$geoip_disable: true`. Studio's `os` and `arch` describe its local server; the SDK's `$os` and `$browser` describe its browser. Every server/CLI event has a UUID and its original capture timestamp. Retries preserve both.

| Event                 | Properties and meaning                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`             | `install_kind`: `fresh` if the global Framio directory was empty, otherwise `existing`; `source`: `first_run`. Once on first enabled use, including adoption by a pre-telemetry installation.                                                                                                                                                                       |
| `cli command`         | `command`, `outcome` (`success`, `failure`, `interrupted`), `duration_ms`. The fixed command allowlist is `start`, `init`, `stop`, `list`, `status`, `open`, `install`, `add`, `evidence`, `inspect`, `screenshot`, `update`, `help`, `version`, `unknown`. `upgrade` maps to `update`. Internal commands and telemetry preference commands do not emit this event. |
| `server started`      | No additional properties. Emitted after server registration.                                                                                                                                                                                                                                                                                                        |
| `server heartbeat`    | No additional properties. Every 12 hours while the server is running.                                                                                                                                                                                                                                                                                               |
| `update result`       | `action`: `download`, `install`, `rollback`; `outcome`: `success` or `failure`. CLI and server updater operations.                                                                                                                                                                                                                                                  |
| `studio opened`       | `pages`, `frames`: counts on the first snapshot.                                                                                                                                                                                                                                                                                                                    |
| `studio disconnected` | No additional properties. A previously connected snapshot stream ended. Initial connection failures and repeated reconnect attempts do not repeat it.                                                                                                                                                                                                               |
| `tool selected`       | `tool`: fixed select, hand or comment tool.                                                                                                                                                                                                                                                                                                                         |
| `panel opened`        | `panel`: fixed Studio panel identifier.                                                                                                                                                                                                                                                                                                                             |
| `page switched`       | No page identifier or name.                                                                                                                                                                                                                                                                                                                                         |
| `finder opened`       | No search query.                                                                                                                                                                                                                                                                                                                                                    |
| `frame focused`       | No frame identifier or name.                                                                                                                                                                                                                                                                                                                                        |
| `theme changed`       | `theme`: `dark` or `light`.                                                                                                                                                                                                                                                                                                                                         |
| `comment saved`       | `operation`: `create`, `reply`, `status` or `delete`; `status` when applicable. No body, author, layer or frame identity.                                                                                                                                                                                                                                           |
| `update action`       | `action`: fixed updater action; `to`: advertised release version or null.                                                                                                                                                                                                                                                                                           |
| `$exception`          | `$exception_list` with type, scrubbed value, mechanism and product stack locations; `$exception_level: error`; `category` as listed below. Error/Fatal logs add `log_level`. HTTP failures add fixed `operation` and, when available, `status`. Studio handled errors add action/operation or `count: 1` as appropriate.                                            |

Exception categories:

- `cli_top_level`: typed failures and defects. Pure interruptions are excluded.
- `effect_log`: Error and Fatal Effect logs in CLI, supervisor and server. Uses the fixed log summary instead of attached compiler diagnostics. Warnings are excluded.
- `server_request`, `server_http`: failed requests and HTTP error responses. API operation names come from an allowlist; raw request URLs and bodies are excluded.
- `unhandled_error`, `unhandled_rejection`: Studio window failures, including failures buffered while the lazy SDK loads.
- `canvas_save`, `comment_save`, `update_action`, `update_state`: generic handled Studio failures. No caught message or user payload is sent.
- `frame_build`, `frame_runtime`: generic failure with `count: 1`. Design error messages, source, names and iframe stacks are excluded. Multiple viewport instances can report separate occurrences.

Absolute filesystem paths, URLs, quoted values, email addresses, known token patterns and multiline source excerpts are scrubbed. Messages are capped at 300 characters. Stack source excerpts are never sent. User design projects, frame entrypoints, scaffold and iframe runtime receive no analytics code. Generic DOM autocapture, session recording, surveys, pageview capture, feature flags and remote SDK dependency loading are disabled. No ingestion proxy is configured.

## Delivery and limits

Delivery is best effort, with an in-memory buffer of at most 1,000 events including the current batch. Batches hold up to 20 events. A scoped loop checks once per second, with a 10-second send deadline. Failures use exponential backoff with jitter from 1 to 300 seconds, and a batch is dropped after five failed sends. Shutdown gets at most 750 milliseconds to flush. Offline exits, abrupt termination and dropped batches can undercount activity or errors. Install claims are persisted before delivery and are not replayed after an offline first run.

Install scripts do not send telemetry. Their binary validation calls use `DO_NOT_TRACK=1`, so a download that fails later is not counted as a successful installation. Install counts mean first enabled binary use, not downloads or installer completions. Collecting installer completions before first run was skipped to avoid background process management, platform-specific JSON/UUID logic and an additional network step in the installer.

`FRAMIO_TELEMETRY_HOST` overrides the ingestion host for local verification. Do not use a production host in tests. Set `FRAMIO_TELEMETRY=1` only with a local receiver when verifying source commands.

## PostHog and release configuration

Create these GitHub Actions secrets:

- `POSTHOG_CLI_API_KEY`: personal API key with `error_tracking:write`, restricted to the matching project.
- `POSTHOG_CLI_PROJECT_ID`: numeric project ID for the project whose public ingestion key is in `src/services/telemetry.ts`.

The workflow uses `POSTHOG_CLI_HOST=https://us.posthog.com`, which is the management host, separate from `https://us.i.posthog.com` ingestion. The public ingestion key is intentionally shipped in Framio and needs no GitHub secret. Do not place a personal key in the product binary.

The UI build writes linked external maps and their matching JS to `dist/sourcemaps`. When `FRAMIO_POSTHOG_SOURCEMAPS=1`, pinned `@posthog/cli@0.18.9` runs `posthog-cli sourcemap inject --directory <candidate-ui> --release-name framio --release-version <tag>` before embedding. Each matrix job then runs `posthog-cli sourcemap upload --directory apps/framio/dist/sourcemaps --release-name framio --release-version <tag>` on that binary build's output. SDK chunk IDs survive privacy scrubbing. No `.map` files are embedded or served. Builds skip injection/upload when either secret is missing. When credentials are configured, injection or upload errors fail the release instead of shipping mismatched maps.

Bun linked sourcemaps are embedded in compiled binaries so their runtime stacks resolve to product source locations. `FRAMIO_BINARY_SOURCEMAPS=0` is available for size comparisons. Server exception frames include product filenames and line/column numbers, without source content. These already resolved server locations do not require the browser map upload.

In PostHog:

- Enable Error Tracking for the project. Explicit `$exception` events and local Studio listeners handle collection; browser autocapture switches are not required.
- Turn on the project setting to discard client IP addresses. Requests inherently reach PostHog with a network source address; `$geoip_disable` disables enrichment, not transport visibility.
- Keep session recording and surveys off. Person profiles are disabled by event/config and are not needed for counts.
- Create a dashboard for new installs, active installations, engaged installations, command outcomes, updater outcomes and errors by app/category/version. Create error alerts for new issues and rising error counts.

## Weekly, monthly and yearly counts

Use `compiled = true` to exclude explicitly enabled development probes. For new installs, count unique `distinct_id` on `install`, filtered to `install_kind = fresh`. Add a separate series for `existing` to show telemetry adoption without inflating new installs. Set week/month/year intervals and the desired date range.

For active installations, count distinct IDs across `cli command`, `server started`, `server heartbeat` and the Studio usage events. Do not add per-event or per-app unique counts: the same installation occurs across surfaces. Heartbeats measure a running server, including idle sessions. For engaged installations, exclude heartbeats, errors, disconnects and version/help checks, and use intentional commands and Studio actions.

For an exact distinct-ID union, save a SQL insight using:

```sql
SELECT toStartOfWeek(timestamp) AS period, count(DISTINCT distinct_id) AS active_installations
FROM events
WHERE event IN ('cli command', 'server started', 'server heartbeat', 'studio opened', 'tool selected', 'panel opened', 'page switched', 'finder opened', 'frame focused', 'theme changed', 'comment saved', 'update action')
  AND properties.compiled = true
  AND timestamp >= now() - INTERVAL 1 YEAR
GROUP BY period
ORDER BY period
```

Replace `toStartOfWeek` with `toStartOfMonth` or `toStartOfYear` for the other intervals. For install insights use the same aggregation with `event = 'install'` and `properties.install_kind = 'fresh'`. A cumulative distinct-ID query over `install` gives telemetry-observed installations, including legacy adoption when you include `existing`. Opted-out and never-run installations are unobservable.
