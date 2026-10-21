export const getDatabaseConfig = () => {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:55432/agentic_bi';
  const isRdsConnection = /rds\.amazonaws\.com/i.test(connectionString) || /\.rds\./i.test(connectionString);
  const useSsl = process.env.POSTGRES_SSL === 'true' || isRdsConnection;

  return {
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 3000),
  };
};