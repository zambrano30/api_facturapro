# FacturaPro REST API

Node.js API for the MySQL SaaS schema in `scripts/mysql-saas-schema.sql`.

## Local setup

1. Create the MySQL schema by running `scripts/mysql-saas-schema.sql` in MySQL Workbench.
2. Create a least-privilege MySQL account for the API and grant access to `facturapro`.
3. Copy `.env.example` to `.env` and set `DATABASE_URL` and a random `JWT_SECRET`.
4. Install and start the API:

```sh
npm install
npm run dev
```

The health endpoint is `http://localhost:3001/api/v1/health`.

## Render deployment

The repository `render.yaml` defines the API and frontend services. Set `DATABASE_URL` to a managed/external MySQL server that accepts connections from Render. Set `FRONTEND_URL` to the deployed frontend origin, and set the frontend build variable `VITE_API_BASE_URL` to `https://<api-host>/api/v1`.

The MySQL server running on a developer PC is not reachable by Render. Do not expose the MySQL port publicly without network restrictions and TLS. Render's API must use a private/managed database URL and a least-privilege database account.

## Tenant security

MySQL does not provide PostgreSQL RLS. All tenant routes require a bearer access token and `X-Company-ID`; the API verifies an active company membership before running queries. Dynamic table/column names are allowlisted and values are parameterized. Never connect the browser directly to MySQL.
