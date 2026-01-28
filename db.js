import pkg from "pg";
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL || 'postgresql://default:4p5hDVCAuSin@ep-snowy-scene-a40k3p50-pooler.us-east-1.aws.neon.tech/verceldb?sslmode=verify-full&channel_binding=require';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

export default pool;
