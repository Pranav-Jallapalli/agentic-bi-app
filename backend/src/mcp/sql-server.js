import pg from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDatabaseConfig } from '../database-config.js';
import { analyticsToolNames, getAnalyticsToolDescription, runAnalyticsTool } from '../analytics-tools.js';

const { Pool } = pg;
const pool = new Pool(getDatabaseConfig());
const server = new McpServer({ name: 'agentic-bi-sql', version: '1.0.0' });

const registerAnalyticsTool = (toolName, acceptsLimit = false) => {
  const inputSchema = acceptsLimit
    ? { limit: z.number().int().min(1).max(100).optional() }
    : {};

  server.registerTool(toolName, {
    title: toolName.replaceAll('_', ' '),
    description: getAnalyticsToolDescription(toolName),
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async (args) => {
    try {
      const result = await runAnalyticsTool(pool, toolName, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Analytics query failed: ${error.message}` }],
      };
    }
  });
};

for (const toolName of analyticsToolNames) {
  registerAnalyticsTool(toolName, toolName === 'top_products_by_revenue' || toolName === 'top_customers_by_revenue');
}

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});