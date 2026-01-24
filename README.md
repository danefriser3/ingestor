# MinIO Ingestor

A small Express service that ingests product JSON files from MinIO and inserts them into Postgres.

## Local Run

1. Install deps:

```bash
npm install
```

2. Configure environment (optional):

- `DATABASE_URL` — Postgres connection string
- `MINIO_ENDPOINT` — e.g. `http://localhost:9000`
- `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`
- `MINIO_REGION` — default `us-east-1`

3. Start:

```bash
npm start
```

Server listens on `PORT` (default 4000) and exposes:
- `GET /` and `GET /health` for health checks
- `POST /minio-events` to process S3 event payloads

## Deploy to Railway

Option A — GitHub repo:
- Push this project to GitHub
- Create a new Railway project and link the repo
- Railway auto-detects Node (Nixpacks) and runs `npm start`
- Ensure service type is Web and `PORT` is injected automatically

Option B — Railway CLI:

```bash
railway login
railway init
railway up
```

### Required Environment Variables

Set these in Railway → Service → Variables:
- `DATABASE_URL` — Postgres connection (Railway Postgres plugin or external)
- `MINIO_ENDPOINT` — your MinIO endpoint (public or internal)
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_REGION` (optional)

### Troubleshooting

- SIGTERM shortly after start usually means the service didn’t expose HTTP correctly. Confirm the app listens on `process.env.PORT` and `0.0.0.0`. This repo already does.
- Check Logs in Railway to see runtime errors (DB connectivity, env vars missing).
- If using external Postgres with SSL, keep `sslmode=require` in your connection string.

### Curl test

```bash
curl -s http://localhost:4000/health
curl -X POST http://localhost:4000/minio-events -H "Content-Type: application/json" -d '{"Records":[]}'
```
