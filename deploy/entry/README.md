# Entry deployment

This Compose profile is the executable self-hosted `entry + postgresql` path.
It starts PostgreSQL 19, applies migrations, then starts the API and worker.
TigerBeetle settings are intentionally absent.

```sh
docker compose -f deploy/entry/compose.yaml config
docker compose -f deploy/entry/compose.yaml up
```

This is a local/reference deployment artifact, not production HA evidence. It does not provide
PostgreSQL failover, workload isolation, backup automation, TLS, secrets management, or a bounded
staging cohort. Those remain requirements for the standard, scale, and enterprise profiles.

The runtime selectors are explicit:

- `RITSEI_DEPLOYMENT_PROFILE=entry`
- `RITSEI_FINANCIAL_AUTHORITY=postgresql`

For a production deployment, use an image built from a reviewed source revision and replace the
example database credentials through the deployment secret mechanism. Do not add TigerBeetle
configuration unless the selected financial authority is `tigerbeetle` and its readiness gates have
passed.
