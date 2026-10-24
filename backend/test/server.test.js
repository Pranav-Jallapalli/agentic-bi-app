import { after, test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { closeMcpHost } from '../src/mcp/host.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
  const testDatabase = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(testDatabase.pathname.slice(1));
  if (!/_test$/i.test(databaseName) || /\.rds\./i.test(testDatabase.hostname)) {
    throw new Error('TEST_DATABASE_URL must point to a local dedicated database whose name ends in _test.');
  }
  process.env.DATABASE_URL = testDatabaseUrl;
}

const {
  app,
  pool,
  getListenConfig,
  getDatabaseConfig,
  ensureBusinessSchema,
  resolvePythonCommand,
} = await import('../src/server.js');
const test = testDatabaseUrl ? nodeTest : nodeTest.skip;

after(async () => {
  await closeMcpHost();
  await pool.end();
});

if (testDatabaseUrl) {
  await ensureBusinessSchema(pool);
  await pool.query('TRUNCATE TABLE retail_transactions');
  const fixture = await readFile(new URL('./fixtures/retail-test-data.sql', import.meta.url), 'utf8');
  await pool.query(fixture);
}

const startServer = async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const { port } = server.address();

  return { server, port };
};

test('listening config defaults to all interfaces for container deployments', () => {
  const previousHost = process.env.HOST;
  const previousPort = process.env.PORT;

  delete process.env.HOST;
  delete process.env.PORT;

  try {
    const config = getListenConfig();
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 5001);
  } finally {
    if (previousHost === undefined) {
      delete process.env.HOST;
    } else {
      process.env.HOST = previousHost;
    }

    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});

test('database config enables SSL for AWS RDS endpoints by default', () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPostgresSsl = process.env.POSTGRES_SSL;

  process.env.DATABASE_URL = 'postgresql://postgres:Password123!@agentic-bi-db.c9ysqg8o009s.ap-southeast-2.rds.amazonaws.com:5432/agentic_bi';
  delete process.env.POSTGRES_SSL;

  try {
    const config = getDatabaseConfig();
    assert.equal(config.connectionString.includes('rds.amazonaws.com'), true);
    assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  } finally {
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }

    if (previousPostgresSsl === undefined) {
      delete process.env.POSTGRES_SSL;
    } else {
      process.env.POSTGRES_SSL = previousPostgresSsl;
    }
  }
});

test('business schema bootstrap creates the retail transaction and vector prerequisites without demo seeds', async () => {
  let executed = false;
  const fakePool = {
    query: async (sql) => {
      executed = true;
      assert.match(sql, /CREATE TABLE IF NOT EXISTS retail_transactions/i);
      assert.match(sql, /CREATE EXTENSION IF NOT EXISTS vector/i);
      assert.doesNotMatch(sql, /INSERT INTO customers/i);
      return { rows: [] };
    },
  };

  await ensureBusinessSchema(fakePool);
  assert.equal(executed, true);
});

test('python command resolver prefers an available interpreter for ML execution', () => {
  const command = resolvePythonCommand();
  assert.ok(command === 'python3' || command === 'python');
  assert.match(command, /python/);
  assert.equal(spawnSync(command, ['--version'], { stdio: 'ignore' }).status, 0);
});

test('health endpoint returns a live backend status', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.database, 'connected');
  } finally {
    server.close();
  }
});

test('metrics endpoint exposes production health alerts', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.health);
    assert.equal(body.health.service, 'agentic-bi-backend');
    assert.ok(Array.isArray(body.alerts));
    assert.ok(['healthy', 'warning', 'degraded'].includes(body.health.status));
  } finally {
    server.close();
  }
});

test('ask endpoint returns real product revenue data from Postgres', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What were the top products by revenue last month?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(body, 'sql'), false);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
    assert.ok(body.data[0].product);
  } finally {
    server.close();
  }
});

test('ask endpoint returns the LangChain retrieval and citation fields', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What are the limitations of this retail transaction dataset?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.ragDocuments));
    assert.ok(Array.isArray(body.evidence));
    assert.ok(body.agentTrace.some((item) => item.toLowerCase().includes('rag')));
  } finally {
    server.close();
  }
});

test('ask endpoint returns an overview summary for dashboard use', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What are the top products by revenue?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.overview);
    assert.ok(body.contextSummary);
    assert.ok(body.overview.totalRevenue > 0);
    assert.ok(body.overview.topProduct);
  } finally {
    server.close();
  }
});

test('ask endpoint returns actionable AI insight and recommendation', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why did revenue drop for Product A due to supply constraints?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.insight);
    assert.ok(body.recommendation);
    assert.ok(body.insight.summary.length > 0);
    assert.ok(body.recommendation.length > 0);
  } finally {
    server.close();
  }
});

test('ask endpoint exposes a multi-agent orchestration plan and signal summary', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why did revenue drop for Product A due to supply constraints?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.orchestration);
    assert.ok(Array.isArray(body.orchestration.agentPlan));
    assert.ok(body.orchestration.agentPlan.some((step) => step.name.toLowerCase().includes('sql')));
    assert.ok(Array.isArray(body.signals));
    assert.ok(body.signals.some((signal) => signal.label.toLowerCase().includes('risk')) || body.signals.length > 0);
  } finally {
    server.close();
  }
});

test('ask endpoint includes an executive dashboard summary with regional and anomaly analytics', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What are the top products by revenue?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.executiveSummary);
    assert.ok(Array.isArray(body.regionBreakdown));
    assert.ok(body.regionBreakdown.length > 0);
    assert.ok(Array.isArray(body.anomalies));
  } finally {
    server.close();
  }
});

test('ask endpoint exposes session memory and LLM context metadata', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What are the top products by revenue?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.sessionMemory);
    assert.ok(Array.isArray(body.sessionMemory));
    assert.ok(body.sessionMemory.length > 0);
    assert.ok(body.llmContext);
    assert.ok(body.llmContext.provider || body.llmContext.enabled !== undefined);
  } finally {
    server.close();
  }
});

test('session memory persists across requests and is retrievable by the API', async () => {
  const { server, port } = await startServer();

  try {
    const firstAsk = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What are the top products by revenue?' }),
    });

    const historyResponse = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    const historyBody = await historyResponse.json();

    assert.equal(firstAsk.status, 200);
    assert.equal(historyResponse.status, 200);
    assert.ok(Array.isArray(historyBody.sessions));
    assert.ok(historyBody.sessions.length > 0);
    assert.ok(historyBody.sessions.some((entry) => entry.question && entry.answer));
  } finally {
    server.close();
  }
});

test('saved reports can be created and retrieved through the API', async () => {
  const { server, port } = await startServer();

  try {
    const createResponse = await fetch(`http://127.0.0.1:${port}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Saved revenue review',
        summary: 'Product A remains the leading revenue driver.',
        topProduct: 'Product A',
        totalRevenue: 150000,
        sql: 'SELECT * FROM retail_transactions',
      }),
    });

    const createBody = await createResponse.json();
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/reports`);
    const listBody = await listResponse.json();
    const savedReport = listBody.reports.find((report) => report.question === 'Saved revenue review');

    assert.equal(createResponse.status, 200);
    assert.equal(listResponse.status, 200);
    assert.ok(Array.isArray(listBody.reports));
    assert.equal(Object.hasOwn(createBody.report, 'sql'), false);
    assert.ok(savedReport);
    assert.equal(Object.hasOwn(savedReport, 'sql'), false);
  } finally {
    server.close();
  }
});

test('ask endpoint returns a forecast summary for trend analysis questions', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Forecast revenue for the next quarter and show the trend.' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.forecast);
    assert.ok(body.forecast.forecastRevenue > 0);
    assert.ok(body.forecast.summary.length > 0);
  } finally {
    server.close();
  }
});

test('ask endpoint includes KPI drift analysis and threshold alerts', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'How are the products trending compared with the portfolio baseline?' }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.kpiDrift);
    assert.ok(Array.isArray(body.kpiDrift.alerts));
    assert.ok(body.kpiDrift.summary.length > 0);
  } finally {
    server.close();
  }
});

test('user-scoped workspaces and reports stay isolated by user identity', async () => {
  const { server, port } = await startServer();

  try {
    const aliceWorkspace = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice Workspace', userId: 'alice' }),
    });

    const aliceBody = await aliceWorkspace.json();
    const bobWorkspace = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob Workspace', userId: 'bob' }),
    });

    const bobBody = await bobWorkspace.json();

    const saveAliceReport = await fetch(`http://127.0.0.1:${port}/api/workspaces/${aliceBody.workspace.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Alice revenue snapshot',
        summary: 'Alice needs a recovery plan.',
        userId: 'alice',
      }),
    });

    const saveBobReport = await fetch(`http://127.0.0.1:${port}/api/workspaces/${bobBody.workspace.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Bob revenue snapshot',
        summary: 'Bob is focused on the sales mix.',
        userId: 'bob',
      }),
    });

    const aliceList = await fetch(`http://127.0.0.1:${port}/api/workspaces?userId=alice`);
    const aliceListBody = await aliceList.json();
    const bobList = await fetch(`http://127.0.0.1:${port}/api/workspaces?userId=bob`);
    const bobListBody = await bobList.json();

    assert.equal(aliceWorkspace.status, 200);
    assert.equal(bobWorkspace.status, 200);
    assert.equal(saveAliceReport.status, 200);
    assert.equal(saveBobReport.status, 200);
    assert.equal(aliceList.status, 200);
    assert.equal(bobList.status, 200);
    assert.ok(Array.isArray(aliceListBody.workspaces));
    assert.ok(Array.isArray(bobListBody.workspaces));
    assert.ok(aliceListBody.workspaces.every((workspace) => workspace.userId === 'alice'));
    assert.ok(bobListBody.workspaces.every((workspace) => workspace.userId === 'bob'));
    assert.ok(aliceListBody.workspaces.some((workspace) => workspace.name === 'Alice Workspace'));
    assert.ok(bobListBody.workspaces.some((workspace) => workspace.name === 'Bob Workspace'));
  } finally {
    server.close();
  }
});

test('auth endpoints register and authenticate a signed-in user', async () => {
  const { server, port } = await startServer();
  const email = `alice-${Date.now()}@example.com`;

  try {
    const registerResponse = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Example',
        email,
        password: 'Passw0rd123',
      }),
    });

    const registerBody = await registerResponse.json();

    assert.equal(registerResponse.status, 201);
    assert.equal(registerBody.user.email, email);
    assert.ok(registerBody.token);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'Passw0rd123',
      }),
    });

    const loginBody = await loginResponse.json();

    assert.equal(loginResponse.status, 200);
    assert.equal(loginBody.user.email, email);
    assert.ok(loginBody.token);

    const meResponse = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${loginBody.token}`,
      },
    });

    const meBody = await meResponse.json();

    assert.equal(meResponse.status, 200);
    assert.equal(meBody.user.email, email);
  } finally {
    server.close();
  }
});

test('authenticated requests use the signed-in user identity for workspace and report actions', async () => {
  const { server, port } = await startServer();
  const email = `protected-${Date.now()}@example.com`;

  try {
    const registerResponse = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Protected User',
        email,
        password: 'Passw0rd123',
      }),
    });

    const registerBody = await registerResponse.json();
    assert.equal(registerResponse.status, 201);

    const protectedWorkspace = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${registerBody.token}`,
      },
      body: JSON.stringify({ name: 'Protected Workspace' }),
    });

    const protectedWorkspaceBody = await protectedWorkspace.json();
    const protectedAsk = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${registerBody.token}`,
      },
      body: JSON.stringify({ question: 'What were the top products by revenue last month?' }),
    });

    const askBody = await protectedAsk.json();

    assert.equal(protectedWorkspace.status, 200);
    assert.equal(protectedAsk.status, 200);
    assert.equal(protectedWorkspaceBody.workspace.userId, email);
    assert.equal(askBody.sessionMemory[0]?.userId, email);
  } finally {
    server.close();
  }
});

test('workspace API creates named workspaces and stores scoped reports', async () => {
  const { server, port } = await startServer();

  try {
    const createWorkspace = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'North America' }),
    });

    const workspaceBody = await createWorkspace.json();
    const saveReport = await fetch(`http://127.0.0.1:${port}/api/workspaces/${workspaceBody.workspace.id}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Q1 dashboard snapshot',
        summary: 'North America leads the portfolio.',
        sql: 'SELECT * FROM retail_transactions',
      }),
    });

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/workspaces`);
    const listBody = await listResponse.json();

    assert.equal(createWorkspace.status, 200);
    assert.equal(saveReport.status, 200);
    assert.equal(listResponse.status, 200);
    assert.ok(Array.isArray(listBody.workspaces));
    assert.ok(listBody.workspaces.some((workspace) => workspace.name === 'North America'));
    const savedWorkspace = listBody.workspaces.find((workspace) => workspace.name === 'North America');
    assert.ok(savedWorkspace.reports.length > 0);
    assert.ok(savedWorkspace.reports.every((report) => !Object.hasOwn(report, 'sql')));
  } finally {
    server.close();
  }
});

test('RAG document listing includes source attribution and license metadata', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/rag/documents`);

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.documents));
    const publicDocument = body.documents.find((document) => document.id === 'uci-online-retail-dataset');
    assert.ok(publicDocument);
    assert.equal(publicDocument.license, 'CC BY 4.0');
    assert.match(publicDocument.source, /archive\.ics\.uci\.edu/);
  } finally {
    server.close();
  }
});

test('ml analysis endpoint returns anomaly and forecast diagnostics', async () => {
  const { server, port } = await startServer();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ml/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: [
          { product: 'Product A', revenue: 200000 },
          { product: 'Product B', revenue: 180000 },
          { product: 'Product C', revenue: 85000 },
        ],
      }),
    });

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.summary);
    assert.ok(Array.isArray(body.anomalies));
    assert.ok(body.forecast && body.forecast.forecastRevenue >= 0);
  } finally {
    server.close();
  }
});

test('admin role can inspect users and viewer role is blocked from modifying protected resources', async () => {
  const { server, port } = await startServer();
  const adminEmail = `admin-${Date.now()}@example.com`;
  const viewerEmail = `viewer-${Date.now()}@example.com`;

  try {
    const adminRegister = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin User', email: adminEmail, password: 'Passw0rd123', role: 'admin' }),
    });

    const adminBody = await adminRegister.json();

    const viewerRegister = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Viewer User', email: viewerEmail, password: 'Passw0rd123', role: 'viewer' }),
    });

    const viewerBody = await viewerRegister.json();

    const adminUsers = await fetch(`http://127.0.0.1:${port}/api/admin/users`, {
      headers: {
        Authorization: `Bearer ${adminBody.token}`,
      },
    });

    const locked = await fetch(`http://127.0.0.1:${port}/api/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${viewerBody.token}`,
      },
      body: JSON.stringify({ name: 'Viewer workspace' }),
    });

    const adminUsersBody = await adminUsers.json();

    assert.equal(adminRegister.status, 201);
    assert.equal(viewerRegister.status, 201);
    assert.equal(adminUsers.status, 200);
    assert.equal(locked.status, 403);
    assert.ok(Array.isArray(adminUsersBody.users));
  } finally {
    server.close();
  }
});

test('metrics endpoint exposes request and uptime observability values', async () => {
  const { server, port } = await startServer();

  try {
    const ping = await fetch(`http://127.0.0.1:${port}/api/health`);
    const metrics = await fetch(`http://127.0.0.1:${port}/api/metrics`);
    const metricsBody = await metrics.json();

    assert.equal(ping.status, 200);
    assert.equal(metrics.status, 200);
    assert.ok(metricsBody.uptimeSeconds >= 0);
    assert.ok(typeof metricsBody.totalRequests === 'number');
    assert.ok(Array.isArray(metricsBody.recentResponses));
  } finally {
    server.close();
  }
});
