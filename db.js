import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: 'postgresql://default:4p5hDVCAuSin@ep-snowy-scene-a40k3p50-pooler.us-east-1.aws.neon.tech/verceldb?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false } // necessario se SSL obbligatorio
});

export default pool;
