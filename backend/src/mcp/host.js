import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlServerPath = path.join(backendDirectory, 'src', 'mcp', 'sql-server.js');
const vectorServerPath = path.join(backendDirectory, 'src', 'mcp', 'vector-server.js');
const baseEnvironmentKeys = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'NODE_ENV'];

const selectEnvironment = (keys) => Object.fromEntries(
  keys
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]),
);

const createMcpClient = async (name, serverPath) => {
  const environmentKeys = serverPath === sqlServerPath
    ? [...baseEnvironmentKeys, 'DATABASE_URL', 'POSTGRES_SSL']
    : [
      ...baseEnvironmentKeys,
      'DATABASE_URL',
      'POSTGRES_SSL',
      'GEMINI_API_KEY',
      'GEMINI_EMBEDDING_MODEL',
      'GEMINI_EMBEDDING_DIMENSIONS',
      'PGVECTOR_TABLE',
      'PGVECTOR_COLLECTION',
    ];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: backendDirectory,
    env: selectEnvironment(environmentKeys),
    stderr: 'inherit',
  });
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
};

let hostPromise;

const getClients = () => {
  if (!hostPromise) {
    hostPromise = Promise.all([
      createMcpClient('agentic-bi-host-sql-client', sqlServerPath),
      createMcpClient('agentic-bi-host-vector-client', vectorServerPath),
    ]).then(([sql, vector]) => ({ sql, vector }));
  }
  return hostPromise;
};

const callTool = async (client, name, args) => {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) {
    const message = response.content?.find((entry) => entry.type === 'text')?.text || 'MCP tool call failed.';
    throw new Error(message);
  }
  if (response.structuredContent) {
    return response.structuredContent;
  }

  const text = response.content?.find((entry) => entry.type === 'text')?.text;
  if (!text) {
    return {};
  }
  return JSON.parse(text);
};

export const callSqlMcpTool = async (name, args = {}) => {
  const { sql } = await getClients();
  return callTool(sql.client, name, args);
};

export const searchVectorMcp = async (query, limit = 3) => {
  const { vector } = await getClients();
  return callTool(vector.client, 'search_public_knowledge', { query, limit });
};

export const closeMcpHost = async () => {
  if (!hostPromise) {
    return;
  }
  const clients = await hostPromise.catch(() => null);
  if (clients) {
    await Promise.all([
      clients.sql.client.close(),
      clients.sql.transport.close(),
      clients.vector.client.close(),
      clients.vector.transport.close(),
    ]);
  }
  hostPromise = undefined;
};