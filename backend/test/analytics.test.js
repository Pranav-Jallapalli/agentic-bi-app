import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildAnalyticsPlan, getAnalyticsSql, analyticsToolNames, runAnalyticsTool } from '../src/analytics-tools.js';
import { createDocumentChunks, loadKnowledgeCorpus } from '../src/rag-service.js';

test('retail questions map to fixed read-only analytics tools', () => {
  const countryPlan = buildAnalyticsPlan('Show total revenue by country');
  const latestMonthPlan = buildAnalyticsPlan('What were the top five products by revenue in the latest month available?');

  assert.equal(countryPlan.toolName, 'revenue_by_country');
  assert.equal(latestMonthPlan.toolName, 'top_products_latest_month');
  assert.ok(analyticsToolNames.includes(countryPlan.toolName));
  assert.match(getAnalyticsSql(countryPlan.toolName), /FROM retail_transactions/i);
  assert.match(getAnalyticsSql(latestMonthPlan.toolName), /MAX\(invoice_date\)/i);
  assert.doesNotMatch(getAnalyticsSql(countryPlan.toolName), /INSERT|UPDATE|DELETE|DROP/i);
});

test('retail schema uses invoice-line data and has no sample inserts', async () => {
  const schema = await readFile(new URL('../../database/scripts/create_schema.sql', import.meta.url), 'utf8');

  assert.match(schema, /CREATE EXTENSION IF NOT EXISTS vector/i);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS retail_transactions/i);
  assert.match(schema, /is_cancellation BOOLEAN/i);
  assert.doesNotMatch(schema, /INSERT INTO customers|INSERT INTO products|INSERT INTO sales/i);
});

test('public and persisted documents split into LangChain chunks with attribution metadata', async () => {
  const documents = await loadKnowledgeCorpus();
  const chunks = await createDocumentChunks(documents);
  const publicChunk = chunks.find((chunk) => chunk.metadata.id === 'uci-online-retail-dataset');

  assert.ok(chunks.length >= documents.length);
  assert.ok(publicChunk);
  assert.equal(publicChunk.metadata.license, 'CC BY 4.0');
  assert.match(publicChunk.metadata.source, /archive\.ics\.uci\.edu/);
});

test('MCP SQL and vector servers publish the expected read-only tools over stdio', async () => {
  const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const servers = [
    { name: 'sql', file: 'src/mcp/sql-server.js', expected: analyticsToolNames },
    { name: 'vector', file: 'src/mcp/vector-server.js', expected: ['search_public_knowledge'] },
  ];

  for (const server of servers) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(backendDirectory, server.file)],
      cwd: backendDirectory,
      env: Object.fromEntries(
        ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'NODE_ENV']
          .filter((key) => typeof process.env[key] === 'string')
          .map((key) => [key, process.env[key]]),
      ),
      stderr: 'inherit',
    });
    const client = new Client({ name: 'analytics-test-host', version: '1.0.0' });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [...server.expected].sort());
    } finally {
      await client.close();
      await transport.close();
    }
  }
});

test('SQL analytics tools use read-only transactions, clamp limits, and release clients', async () => {
  const statements = [];
  let released = false;
  const fakePool = {
    connect: async () => ({
      query: async (sql, parameters = []) => {
        statements.push({ sql, parameters });
        return sql.includes('SELECT') ? { rows: [{ customer: '12345', revenue: '100.00' }] } : { rows: [] };
      },
      release: () => {
        released = true;
      },
    }),
  };

  const result = await runAnalyticsTool(fakePool, 'top_customers_by_revenue', { limit: 1000 });

  assert.equal(statements[0].sql, 'BEGIN READ ONLY');
  assert.deepEqual(statements[1].parameters, [100]);
  assert.equal(statements.at(-1).sql, 'COMMIT');
  assert.equal(released, true);
  assert.equal(result.rows[0].customer, '12345');
});