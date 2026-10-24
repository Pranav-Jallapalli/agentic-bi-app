import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { spawn, spawnSync } from 'node:child_process';
import { getDatabaseConfig } from './database-config.js';
import { buildAnalyticsPlan, getAnalyticsSql, normalizeAnalyticsRows } from './analytics-tools.js';
import { callSqlMcpTool, closeMcpHost, searchVectorMcp } from './mcp/host.js';
import { isRagConfigured, loadPublicKnowledge } from './rag-service.js';

const { Pool } = pg;

dotenv.config();

const getListenConfig = () => ({
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 5001),
});

const app = express();
const { port: PORT } = getListenConfig();
const SESSION_MEMORY_PATH = path.resolve(process.cwd(), 'data', 'session-memory.json');
const REPORTS_PATH = path.resolve(process.cwd(), 'data', 'saved-reports.json');
const WORKSPACES_PATH = path.resolve(process.cwd(), 'data', 'workspaces.json');
const USERS_PATH = path.resolve(process.cwd(), 'data', 'users.json');
const DOCUMENTS_PATH = path.resolve(process.cwd(), 'data', 'documents.json');

const loadUsers = async () => {
  try {
    await fs.mkdir(path.dirname(USERS_PATH), { recursive: true });
    const file = await fs.readFile(USERS_PATH, 'utf8');
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(USERS_PATH, JSON.stringify([], null, 2));
      return [];
    }

    console.warn('Unable to read persisted users, starting from empty state.', error.message);
    return [];
  }
};

const persistUsers = async (users) => {
  try {
    await fs.mkdir(path.dirname(USERS_PATH), { recursive: true });
    await fs.writeFile(USERS_PATH, JSON.stringify(users, null, 2));
  } catch (error) {
    console.warn('Unable to persist users to disk.', error.message);
  }
};

let users = await loadUsers();

const loadSessionMemory = async () => {
  try {
    await fs.mkdir(path.dirname(SESSION_MEMORY_PATH), { recursive: true });
    const file = await fs.readFile(SESSION_MEMORY_PATH, 'utf8');
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(SESSION_MEMORY_PATH, JSON.stringify([], null, 2));
      return [];
    }

    console.warn('Unable to read persisted session memory, starting from empty state.', error.message);
    return [];
  }
};

const persistSessionMemory = async (entries) => {
  try {
    await fs.mkdir(path.dirname(SESSION_MEMORY_PATH), { recursive: true });
    await fs.writeFile(SESSION_MEMORY_PATH, JSON.stringify(entries, null, 2));
  } catch (error) {
    console.warn('Unable to persist session memory to disk.', error.message);
  }
};

const loadSavedReports = async () => {
  try {
    await fs.mkdir(path.dirname(REPORTS_PATH), { recursive: true });
    const file = await fs.readFile(REPORTS_PATH, 'utf8');
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(REPORTS_PATH, JSON.stringify([], null, 2));
      return [];
    }

    console.warn('Unable to read saved reports, starting from empty state.', error.message);
    return [];
  }
};

const persistSavedReports = async (reports) => {
  try {
    await fs.mkdir(path.dirname(REPORTS_PATH), { recursive: true });
    await fs.writeFile(REPORTS_PATH, JSON.stringify(reports, null, 2));
  } catch (error) {
    console.warn('Unable to persist saved reports to disk.', error.message);
  }
};

let sessionMemory = await loadSessionMemory();
let savedReports = await loadSavedReports();

const loadWorkspaces = async () => {
  try {
    await fs.mkdir(path.dirname(WORKSPACES_PATH), { recursive: true });
    const file = await fs.readFile(WORKSPACES_PATH, 'utf8');
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(WORKSPACES_PATH, JSON.stringify([], null, 2));
      return [];
    }

    console.warn('Unable to read workspaces, starting from empty state.', error.message);
    return [];
  }
};

const persistWorkspaces = async (workspaces) => {
  try {
    await fs.mkdir(path.dirname(WORKSPACES_PATH), { recursive: true });
    await fs.writeFile(WORKSPACES_PATH, JSON.stringify(workspaces, null, 2));
  } catch (error) {
    console.warn('Unable to persist workspaces to disk.', error.message);
  }
};

let workspaces = await loadWorkspaces();

const loadDocuments = async () => {
  try {
    await fs.mkdir(path.dirname(DOCUMENTS_PATH), { recursive: true });
    const file = await fs.readFile(DOCUMENTS_PATH, 'utf8');
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(DOCUMENTS_PATH, JSON.stringify([], null, 2));
      return [];
    }

    console.warn('Unable to read persisted documents, starting from empty state.', error.message);
    return [];
  }
};

const persistDocuments = async (documents) => {
  try {
    await fs.mkdir(path.dirname(DOCUMENTS_PATH), { recursive: true });
    await fs.writeFile(DOCUMENTS_PATH, JSON.stringify(documents, null, 2));
  } catch (error) {
    console.warn('Unable to persist knowledge documents to disk.', error.message);
  }
};

let knowledgeDocuments = await loadDocuments();

const JWT_SECRET = process.env.JWT_SECRET || 'agentic-bi-local-dev-secret';

const normalizeUserId = (value) => {
  if (typeof value !== 'string') {
    return 'demo-user';
  }

  const trimmed = value.trim();
  return trimmed || 'demo-user';
};

const allowedRoles = new Set(['admin', 'analyst', 'viewer', 'member']);
const normalizeRole = (value) => {
  if (typeof value !== 'string') {
    return 'member';
  }

  const role = value.trim().toLowerCase();
  return allowedRoles.has(role) ? role : 'member';
};

const filterByUserId = (items, userId) => {
  if (!userId) {
    return items;
  }

  const normalized = normalizeUserId(userId);
  return items.filter((item) => (item?.userId || 'demo-user') === normalized);
};

const omitGeneratedSql = (report) => Object.fromEntries(
  Object.entries(report).filter(([key]) => key !== 'sql'),
);

const pool = new Pool(getDatabaseConfig());

const BUSINESS_SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS retail_transactions (
    source_row BIGINT PRIMARY KEY,
    invoice_no TEXT NOT NULL,
    stock_code TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    invoice_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    customer_id TEXT,
    country TEXT NOT NULL,
    line_revenue NUMERIC(14, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    is_cancellation BOOLEAN GENERATED ALWAYS AS (invoice_no ILIKE 'C%') STORED
  );

  CREATE INDEX IF NOT EXISTS retail_transactions_invoice_date_idx ON retail_transactions (invoice_date);
  CREATE INDEX IF NOT EXISTS retail_transactions_stock_code_idx ON retail_transactions (stock_code);
  CREATE INDEX IF NOT EXISTS retail_transactions_country_idx ON retail_transactions (country);
  CREATE INDEX IF NOT EXISTS retail_transactions_customer_id_idx ON retail_transactions (customer_id) WHERE customer_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS dataset_imports (
    dataset_key TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    source_url TEXT NOT NULL,
    license TEXT NOT NULL,
    attribution TEXT NOT NULL,
    imported_rows BIGINT NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS rag_ingestion_runs (
    source TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const ensureBusinessSchema = async (databasePool = pool) => {
  try {
    await databasePool.query(BUSINESS_SCHEMA_SQL);
    return true;
  } catch (error) {
    console.error('Business schema bootstrap failed:', error.message);
    return false;
  }
};

const searchKnowledgeDocuments = async (question, limit = 3) => {
  if (!question || !question.trim() || !isRagConfigured()) {
    return [];
  }

  const result = await searchVectorMcp(question, limit);
  return Array.isArray(result.documents) ? result.documents : [];
};

const retrieveRelevantContext = async (question) => {
  const documents = await searchKnowledgeDocuments(question, 3);
  return documents.map((document) => document.content);
};

const generateSqlQuery = (question) => getAnalyticsSql(buildAnalyticsPlan(question).toolName);

const getTopResultDimension = (row) => {
  if (!row) {
    return { label: 'product', value: 'N/A' };
  }

  const dimensions = [
    ['product', 'product'],
    ['country', 'country'],
    ['region', 'region'],
    ['customer', 'customer'],
    ['month', 'month'],
  ];
  const [key, label] = dimensions.find(([dimension]) => row[dimension]) || ['product', 'product'];

  return { label, value: row[key] || 'N/A' };
};

const buildOverview = (rows, question, contextNotes) => {
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const topDimension = getTopResultDimension(rows[0]);
  const topRevenue = rows[0] ? Number(rows[0].revenue) : 0;

  return {
    totalRevenue,
    topProduct: topDimension.value,
    topEntityLabel: topDimension.label,
    topEntityValue: topDimension.value,
    topRevenue,
    question,
    contextSummary: contextNotes.length
      ? contextNotes[0]
      : 'No business context was retrieved for this question, but the SQL result is still based on live PostgreSQL data.',
  };
};

const buildInsight = (rows, contextNotes) => {
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const topDimension = getTopResultDimension(rows[0]);
  const topRevenue = rows[0] ? Number(rows[0].revenue) : 0;

  const summary = contextNotes.length
    ? `${topDimension.value} is the leading ${topDimension.label} by revenue; compare the result with the retrieved retail context before drawing conclusions about the cause.`
    : `${topDimension.value} is the leading ${topDimension.label} by revenue. The live data indicates a healthy sales mix with no major context disruption.`;

  return {
    summary,
    totalRevenue,
    topProduct: topDimension.value,
    topEntityLabel: topDimension.label,
    topEntityValue: topDimension.value,
    topRevenue,
    riskLevel: contextNotes.length ? 'moderate' : 'low',
    trend: topRevenue > 0 ? 'positive' : 'neutral',
  };
};

const buildRecommendation = (contextNotes, topProduct) => {
  if (contextNotes.length) {
    return `Review ${topProduct}'s performance alongside the cited retail context, checking that the source, period, and scope are comparable before changing the sales plan.`;
  }

  return `Keep investing in the current top-performing product mix and review regional demand shifts before expanding into new categories.`;
};

const buildExecutiveSummary = (rows, contextNotes) => {
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const topProduct = rows[0]?.product || 'N/A';
  const topRevenue = rows[0] ? Number(rows[0].revenue) : 0;
  const concentration = totalRevenue ? ((topRevenue / totalRevenue) * 100).toFixed(1) : '0.0';

  if (contextNotes.length) {
    return `Revenue is concentrated in ${topProduct} at ${concentration}% of the current total. Retrieved retail context is available, but its period and population should be checked before attributing the result.`;
  }

  return `Revenue is concentrated in ${topProduct} at ${concentration}% of the current total, and the underlying mix remains broadly stable across the active portfolio.`;
};

const resolvePythonCommand = () => {
  const candidates = ['python3', 'python'];

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
      if (!result.error && result.status === 0) {
        return candidate;
      }
    } catch (_error) {
      // continue to the next candidate if the interpreter is unavailable
    }
  }

  return 'python3';
};

const callMLService = async (rows, contextNotes = []) => {
  const scriptPath = path.resolve(process.cwd(), 'src', 'ml_service.py');
  const pythonCommand = resolvePythonCommand();

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.on('error', (error) => reject(error));
    child.stdout.on('data', (chunk) => stdoutChunks.push(String(chunk)));
    child.stderr.on('data', (chunk) => stderrChunks.push(String(chunk)));

    child.on('close', (code) => {
      const stderr = stderrChunks.join('');
      if (code !== 0) {
        reject(new Error(stderr || `ML service exited with code ${code}`));
        return;
      }

      try {
        const output = stdoutChunks.join('');
        resolve(JSON.parse(output || '{}'));
      } catch (error) {
        reject(new Error(`Unable to parse ML service output: ${error.message}`));
      }
    });

    child.stdin.write(JSON.stringify({ rows, contextNotes }));
    child.stdin.end();
  });
};

const buildForecast = async () => {
  const monthQuery = `
    SELECT TO_CHAR(invoice_date, 'YYYY-MM') AS month,
      ROUND(CAST(SUM(line_revenue) AS numeric), 2) AS revenue
    FROM retail_transactions
    GROUP BY TO_CHAR(invoice_date, 'YYYY-MM')
    ORDER BY month ASC;
  `;

  const { rows: monthRows } = await pool.query(monthQuery);

  if (!monthRows.length) {
    return {
      period: 'next quarter',
      trend: 'stable',
      changePct: 0,
      currentRevenue: 0,
      forecastRevenue: 0,
      confidence: 'low',
      summary: 'The forecast model could not compute a trend because there was no monthly revenue history.',
    };
  }

  const currentRevenue = Number(monthRows[monthRows.length - 1]?.revenue || 0);
  const previousRevenue = Number(monthRows[Math.max(0, monthRows.length - 2)]?.revenue || currentRevenue);
  const changePct = previousRevenue ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;
  const projectedGrowth = Math.max(-0.18, Math.min(0.22, changePct / 100));
  const forecastRevenue = currentRevenue * (1 + projectedGrowth);
  const trend = changePct > 5 ? 'upward' : changePct < -5 ? 'downward' : 'stable';

  return {
    period: 'next quarter',
    trend,
    changePct: Number(changePct.toFixed(1)),
    currentRevenue: Number(currentRevenue.toFixed(2)),
    forecastRevenue: Number(forecastRevenue.toFixed(2)),
    confidence: Math.abs(changePct) > 10 ? 'moderate' : 'steady',
    summary: `Revenue momentum is ${trend} with a ${Math.abs(changePct).toFixed(1)}% change versus the prior period. Forecasted revenue for the next quarter is GBP ${forecastRevenue.toLocaleString()}.`,
  };
};

const buildKpiDrift = (rows) => {
  const values = rows.map((row) => Number(row.revenue || 0));
  const baseline = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  const alerts = rows
    .map((row) => {
      const current = Number(row.revenue || 0);
      const variancePct = baseline ? ((current - baseline) / baseline) * 100 : 0;

      return {
        metric: row.product || row.region || row.customer || 'Metric',
        current,
        baseline,
        variancePct: Number(variancePct.toFixed(1)),
        status: variancePct > 15 ? 'above-target' : variancePct < -15 ? 'below-target' : 'on-track',
      };
    })
    .filter((item) => Math.abs(item.variancePct) >= 12);

  const strongest = rows[0];
  const summary = strongest
    ? `${strongest.product || strongest.region || strongest.customer || 'The leading segment'} is the primary performance outlier relative to the portfolio baseline.`
    : 'KPI drift is stable across the current result set.';

  return {
    summary,
    baseline: Number(baseline.toFixed(2)),
    threshold: 15,
    alerts,
  };
};

const buildRegionBreakdown = (rows) =>
  rows.map((row) => ({
    label: row.region || row.product || row.customer || row.month || 'Metric',
    value: Number(row.revenue || 0),
  }));

const buildAnomalySignals = (rows, regionRows = []) => {
  const revenueValues = rows.map((row) => Number(row.revenue || 0));
  const averageRevenue = revenueValues.length ? revenueValues.reduce((sum, value) => sum + value, 0) / revenueValues.length : 0;

  const productSignals = rows
    .filter((row) => averageRevenue > 0)
    .map((row) => {
      const value = Number(row.revenue || 0);
      const ratio = value / averageRevenue;

      if (ratio < 0.75) {
        return {
          label: row.product || 'Product',
          severity: 'watch',
          delta: `${((1 - ratio) * 100).toFixed(1)}% below average`,
          value,
        };
      }

      return null;
    })
    .filter(Boolean);

  if (productSignals.length === 0 && regionRows.length > 0) {
    const regionLeader = regionRows[0];
    return [{
      label: regionLeader?.region || 'Regional mix',
      severity: 'notice',
      delta: 'Strongest region',
      value: Number(regionLeader?.revenue || 0),
    }];
  }

  return productSignals;
};

const classifyQuestion = (question) => {
  const normalized = question.toLowerCase();

  if (/(supply|inventory|shipment|logistics|constraint)/.test(normalized)) {
    return {
      focus: 'Fulfillment risk',
      priority: 'high',
      category: 'supply-risk',
    };
  }

  if (/(region|country|trend|month|season|time)/.test(normalized)) {
    return {
      focus: 'Trend analysis',
      priority: 'medium',
      category: 'trend',
    };
  }

  return {
    focus: 'Revenue concentration',
    priority: 'medium',
    category: 'revenue',
  };
};

const buildSignals = (rows, contextNotes, topProduct) => {
  const totalRevenue = rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const leader = rows[0];
  const averageRevenue = rows.length ? totalRevenue / rows.length : 0;
  const leaderShare = leader && totalRevenue ? (Number(leader.revenue || 0) / totalRevenue) * 100 : 0;

  const signals = [
    {
      label: 'Revenue concentration risk',
      severity: leaderShare >= 45 ? 'high' : 'medium',
      value: `${leaderShare.toFixed(1)}%`,
      description: leader
        ? `${topProduct || leader.product} contributes ${leaderShare.toFixed(1)}% of the current revenue base.`
        : 'No dominant product is present in the selected result set.',
    },
    {
      label: 'Retrieved retail context',
      severity: contextNotes.length ? 'moderate' : 'low',
      value: contextNotes.length ? 'Available' : 'No match',
      description: contextNotes.length
        ? 'Attributed retail documents were retrieved; verify their scope before applying them to this dataset.'
        : 'No relevant source document was retrieved for this question.',
    },
  ];

  if (rows.length > 1) {
    signals.push({
      label: 'Portfolio spread',
      severity: averageRevenue > 0 ? 'low' : 'info',
      value: `${rows.length} active segments`,
      description: `The current result set spans ${rows.length} business segments with an average revenue of GBP ${averageRevenue.toLocaleString()}.`,
    });
  }

  return signals;
};

const buildOrchestration = (question, rows, contextNotes) => {
  const intent = classifyQuestion(question);
  const topProduct = rows[0]?.product || 'N/A';

  return {
    mode: 'multi-agent-bi',
    focus: intent.focus,
    priority: intent.priority,
    nextAction: contextNotes.length
      ? `Review ${topProduct}'s performance alongside the retrieved source context and verify that the reporting periods are comparable.`
      : 'Review the top-performing segments and confirm whether demand is stable before scaling investment.',
    agentPlan: [
      {
        name: 'Supervisor',
        status: 'completed',
        summary: 'Classified the request into a business-analytics workflow.',
      },
      {
        name: 'SQL Agent',
        status: 'completed',
        summary: 'Mapped the question to a live PostgreSQL read-only query.',
      },
      {
        name: 'RAG Agent',
        status: contextNotes.length ? 'completed' : 'idle',
        summary: contextNotes.length
          ? 'Retrieved operational context from the knowledge base for business interpretation.'
          : 'No direct business context matched the prompt.',
      },
      {
        name: 'Insight Agent',
        status: 'completed',
        summary: 'Synthesized the metric signal and generated the recommended follow-up action.',
      },
    ],
    signals: buildSignals(rows, contextNotes, topProduct),
  };
};

const buildAnswer = (question, rows, contextNotes) => {
  const normalized = question.toLowerCase();
  const topRow = rows[0];
  const topDimension = getTopResultDimension(topRow);

  if (topRow && (topRow.product || topRow.country || topRow.region || topRow.customer)) {
    const leader = `the leading ${topDimension.label} is ${topDimension.value}, with revenue of GBP ${Number(topRow.revenue).toLocaleString()}`;
    return {
      answer: `The SQL agent reviewed the sales data and found ${leader}.`,
      summary: `The agent searched live PostgreSQL revenue totals and ordered the results by ${topDimension.label}.`,
      evidence: [
        `The query grouped invoice-line revenue by ${topDimension.label}.`,
        'Net revenue was aggregated from quantity multiplied by unit price, including cancellation lines.',
        `Results were sorted in descending order to identify the leading ${topDimension.label}.`,
        ...contextNotes,
      ],
    };
  }

  return {
    answer: 'The SQL agent ran a business query against the PostgreSQL dataset and surfaced the most relevant result set.',
    summary: 'The agent used a read-only query to answer the business question from the live data layer.',
    evidence: [
      'A fixed read-only analytics tool queried the retail transaction table.',
      'The result set was returned from the database without altering the source data.',
      'The output was summarized for business review.',
      ...contextNotes,
    ],
  };
};

const fetchWithTimeout = (url, options) => fetch(url, {
  ...options,
  signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS) || 30000),
});

const buildLLMContext = async (question, rows, contextNotes) => {
  const providerPreference = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const openAiKey = process.env.OPENAI_API_KEY || '';
  const groqKey = process.env.GROQ_API_KEY || '';
  const requestedProvider = ['gemini', 'openai', 'groq'].includes(providerPreference)
    ? providerPreference
    : null;
  const provider = requestedProvider
    || (geminiKey ? 'gemini' : groqKey ? 'groq' : openAiKey ? 'openai' : 'local-deterministic');
  const model = provider === 'gemini'
    ? (process.env.GEMINI_MODEL || 'gemini-3.8-flash')
    : provider === 'groq'
      ? (process.env.GROQ_MODEL || 'openai/gpt-oss-20b')
      : (process.env.OPENAI_MODEL || 'gpt-4o-mini');
  const providerKey = provider === 'gemini'
    ? geminiKey
    : provider === 'groq'
      ? groqKey
      : openAiKey;

  if (!providerKey) {
    return {
      provider,
      model,
      enabled: false,
      narrative: null,
      fallback: 'The app is running in local deterministic mode. No external LLM key is configured yet, so orchestration is handled in-process.',
    };
  }

  try {
    let response;
    let payload;
    let narrative;

    if (provider === 'gemini') {
      const endpoint = `${process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta'}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generationConfig: {
            temperature: 0.3,
          },
          contents: [{
            role: 'user',
            parts: [{
              text: JSON.stringify({
                question,
                rows: rows.slice(0, 5),
                contextNotes,
              }),
            }],
          }],
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM request failed with status ${response.status}`);
      }

      payload = await response.json();
      narrative = payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        ?.join(' ')
        ?.trim();
    } else {
      const baseUrl = provider === 'groq'
        ? (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1')
        : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
      response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${providerKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: 'You are an executive BI analyst. Summarize the business insight in a concise way and mention only relevant signals from the data and context.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                question,
                rows: rows.slice(0, 5),
                contextNotes,
              }),
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM request failed with status ${response.status}`);
      }

      payload = await response.json();
      narrative = payload.choices?.[0]?.message?.content?.trim();
    }

    return {
      provider,
      model,
      enabled: Boolean(narrative),
      narrative: narrative || null,
      fallback: narrative ? null : 'No narrative returned from the external model.',
    };
  } catch (error) {
    console.warn('LLM reasoning unavailable, falling back to local orchestration:', error.message);
    return {
      provider,
      model,
      enabled: false,
      narrative: null,
      fallback: 'The external model was unavailable, so the app stayed in local deterministic orchestration mode.',
    };
  }
};

const requestMetrics = {
  startedAt: Date.now(),
  totalRequests: 0,
  recentResponses: [],
};

const buildOperationalHealth = (metrics) => {
  const recent = metrics.recentResponses.slice(-10);
  const averageResponseMs = recent.length
    ? recent.reduce((sum, item) => sum + Number(item.durationMs || 0), 0) / recent.length
    : 0;
  const errorResponses = recent.filter((item) => Number(item.status || 0) >= 500).length;
  const slowResponses = recent.filter((item) => Number(item.durationMs || 0) > 400).length;

  const alerts = [];

  if (errorResponses > 0) {
    alerts.push({
      level: errorResponses > 1 ? 'warning' : 'info',
      message: `${errorResponses} recent requests returned a server error response.`,
    });
  }

  if (slowResponses > 0) {
    alerts.push({
      level: averageResponseMs > 800 ? 'warning' : 'info',
      message: `Latency is elevated across ${slowResponses} recent requests.`,
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      level: 'info',
      message: 'No active alerts detected; service health is stable.',
    });
  }

  let status = 'healthy';
  if (averageResponseMs > 800 || errorResponses > 1) {
    status = 'degraded';
  } else if (averageResponseMs > 350 || errorResponses > 0 || slowResponses > 1) {
    status = 'warning';
  }

  return {
    service: 'agentic-bi-backend',
    status,
    alertCount: alerts.length,
    checks: {
      database: 'connected',
      latency: averageResponseMs > 800 ? 'degraded' : averageResponseMs > 350 ? 'warning' : 'healthy',
      errorRate: errorResponses > 0 ? 'warning' : 'healthy',
    },
    alerts,
  };
};

app.use((req, _res, next) => {
  const start = Date.now();
  requestMetrics.totalRequests += 1;

  _res.on('finish', () => {
    const response = {
      method: req.method,
      path: req.path,
      status: _res.statusCode,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };

    requestMetrics.recentResponses.push(response);
    if (requestMetrics.recentResponses.length > 20) {
      requestMetrics.recentResponses.shift();
    }
  });

  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

const createUserToken = (user) => jwt.sign(
  {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'member',
  },
  JWT_SECRET,
  { expiresIn: '7d' },
);

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: normalizeRole(user.role),
  createdAt: user.createdAt,
});

const getAuthenticatedUser = async (req) => {
  users = await loadUsers();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = users.find((entry) => entry.id === payload.sub || entry.email.toLowerCase() === (payload.email || '').toLowerCase());
    return user || null;
  } catch (error) {
    return null;
  }
};

const requireRole = (...roles) => async (req, res, next) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (!roles.length || roles.includes(normalizeRole(user.role))) {
    req.authUser = user;
    return next();
  }

  return res.status(403).json({ error: 'You do not have permission to perform this action.' });
};

const resolveRequestUserId = async (req, explicitUserId) => {
  const authenticatedUser = await getAuthenticatedUser(req);

  if (authenticatedUser) {
    const authenticatedEmail = normalizeUserId(authenticatedUser.email);
    if (explicitUserId && normalizeUserId(explicitUserId) !== authenticatedEmail) {
      return { userId: authenticatedEmail, mismatch: true };
    }

    return { userId: authenticatedEmail, mismatch: false };
  }

  return { userId: normalizeUserId(explicitUserId || 'demo-user'), mismatch: false };
};

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'A valid name is required.' });
  }

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const safeRole = normalizeRole(role);
  const existingUser = users.find((userEntry) => userEntry.email.toLowerCase() === trimmedEmail);

  if (existingUser) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: randomUUID(),
    name: trimmedName,
    email: trimmedEmail,
    passwordHash,
    role: safeRole,
    createdAt: new Date().toISOString(),
  };

  users.unshift(newUser);
  await persistUsers(users);

  const token = createUserToken(newUser);

  return res.status(201).json({
    token,
    user: sanitizeUser(newUser),
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }

  if (!password || typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ error: 'A valid password is required.' });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const user = users.find((entry) => entry.email.toLowerCase() === trimmedEmail);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  return res.json({
    token: createUserToken(user),
    user: sanitizeUser(user),
  });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  return res.json({ user: sanitizeUser(user) });
});

app.get('/api/rag/documents', async (_req, res) => {
  knowledgeDocuments = await loadDocuments();
  const publicDocuments = await loadPublicKnowledge();
  return res.json({ documents: [...publicDocuments, ...knowledgeDocuments] });
});

app.post('/api/rag/documents', async (req, res) => {
  const { title, content, tags } = req.body || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'A document title is required.' });
  }

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Document content is required.' });
  }

  knowledgeDocuments = await loadDocuments();
  const newDocument = {
    id: randomUUID(),
    title: title.trim(),
    content: content.trim(),
    tags: Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    createdAt: new Date().toISOString(),
  };

  knowledgeDocuments.unshift(newDocument);
  await persistDocuments(knowledgeDocuments);

  return res.status(201).json({ document: newDocument });
});

app.post('/api/rag/search', async (req, res) => {
  const { query } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'A search query is required.' });
  }

  if (!isRagConfigured()) {
    return res.status(503).json({ error: 'Semantic search requires GEMINI_API_KEY.' });
  }

  try {
    const documents = await searchKnowledgeDocuments(query, 5);
    return res.json({ documents, total: documents.length });
  } catch (error) {
    console.error('RAG search failed:', error.message);
    return res.status(503).json({ error: 'Knowledge search is unavailable. Check PostgreSQL, pgvector, and Gemini configuration.' });
  }
});

app.get('/api/ml/analyze', async (_req, res) => {
  try {
    const defaultRows = [
      { product: 'Product A', revenue: 210000 },
      { product: 'Product B', revenue: 180000 },
      { product: 'Product C', revenue: 95000 },
    ];

    const result = await callMLService(defaultRows, ['default trend analysis']);
    return res.json(result);
  } catch (error) {
    console.error('ML analysis failed:', error.message);
    return res.status(500).json({ error: 'ML service unavailable.' });
  }
});

app.post('/api/ml/analyze', async (req, res) => {
  const { rows = [], contextNotes = [] } = req.body || {};

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Rows are required for ML analysis.' });
  }

  try {
    const result = await callMLService(rows, Array.isArray(contextNotes) ? contextNotes : [String(contextNotes)]);
    return res.json(result);
  } catch (error) {
    console.error('ML analysis failed:', error.message);
    return res.status(500).json({ error: 'ML service unavailable.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({
      status: 'ok',
      message: 'Agentic BI backend is running.',
      database: 'connected',
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    return res.status(503).json({
      status: 'degraded',
      message: 'Backend running but database unavailable.',
      database: 'disconnected',
      error: error.message,
    });
  }
});

app.get('/api/metrics', async (_req, res) => {
  const averageResponseMs = requestMetrics.recentResponses.length
    ? requestMetrics.recentResponses.reduce((sum, item) => sum + Number(item.durationMs || 0), 0) / requestMetrics.recentResponses.length
    : 0;

  const health = buildOperationalHealth(requestMetrics);

  return res.json({
    uptimeSeconds: Number(((Date.now() - requestMetrics.startedAt) / 1000).toFixed(2)),
    totalRequests: requestMetrics.totalRequests,
    averageResponseMs: Number(averageResponseMs.toFixed(2)),
    recentResponses: requestMetrics.recentResponses.slice(-10),
    lastUpdated: new Date().toISOString(),
    health,
    alerts: health.alerts,
  });
});

app.get('/api/admin/users', requireRole('admin'), async (_req, res) => {
  const visibleUsers = users.map((user) => sanitizeUser(user));
  return res.json({ users: visibleUsers });
});

app.get('/api/sessions', async (req, res) => {
  sessionMemory = await loadSessionMemory();
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const authUser = await getAuthenticatedUser(req);
  const resolvedUserId = authUser ? authUser.email.toLowerCase() : requestedUserId;
  const sessions = sessionMemory
    .filter((entry) => !resolvedUserId || (entry.userId || 'demo-user') === resolvedUserId)
    .slice()
    .reverse();

  return res.json({ sessions });
});

app.get('/api/workspaces', async (req, res) => {
  workspaces = await loadWorkspaces();
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const authUser = await getAuthenticatedUser(req);
  const effectiveUserId = authUser ? authUser.email.toLowerCase() : requestedUserId;
  const list = workspaces
    .filter((workspace) => {
      const workspaceUserId = workspace.userId || 'demo-user';
      return !effectiveUserId || workspaceUserId === effectiveUserId || Boolean(workspace.shared);
    })
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((workspace) => ({
      ...workspace,
      userId: workspace.userId || 'demo-user',
      reports: (workspace.reports || []).map(omitGeneratedSql),
      reportCount: Array.isArray(workspace.reports) ? workspace.reports.length : 0,
      shared: Boolean(workspace.shared),
    }));

  return res.json({ workspaces: list });
});

app.post('/api/workspaces', async (req, res) => {
  const authUser = await getAuthenticatedUser(req);
  if (authUser && normalizeRole(authUser.role) === 'viewer') {
    return res.status(403).json({ error: 'Viewer role cannot create or modify workspaces.' });
  }

  workspaces = await loadWorkspaces();
  const { name, userId, shared } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'A valid workspace name is required.' });
  }

  const resolvedUserId = authUser ? authUser.email.toLowerCase() : normalizeUserId(userId || 'demo-user');

  if (authUser && userId && normalizeUserId(userId) !== resolvedUserId) {
    return res.status(403).json({ error: 'This workspace cannot be created for another user.' });
  }

  const workspace = {
    id: randomUUID(),
    name: name.trim(),
    userId: resolvedUserId,
    shared: Boolean(shared),
    createdAt: new Date().toISOString(),
    reports: [],
  };

  workspaces.unshift(workspace);
  await persistWorkspaces(workspaces);

  return res.json({ workspace });
});

app.get('/api/workspaces/:workspaceId', async (req, res) => {
  workspaces = await loadWorkspaces();
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const authUser = await getAuthenticatedUser(req);
  const effectiveUserId = authUser ? authUser.email.toLowerCase() : requestedUserId;
  const workspace = workspaces.find((item) => item.id === req.params.workspaceId);

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  if (effectiveUserId && (workspace.userId || 'demo-user') !== effectiveUserId && !workspace.shared) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  return res.json({
    workspace: {
      ...workspace,
      reports: (workspace.reports || []).map(omitGeneratedSql),
    },
  });
});

app.get('/api/workspaces/:workspaceId/reports', async (req, res) => {
  workspaces = await loadWorkspaces();
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const authUser = await getAuthenticatedUser(req);
  const effectiveUserId = authUser ? authUser.email.toLowerCase() : requestedUserId;
  const workspace = workspaces.find((item) => item.id === req.params.workspaceId);

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  if (effectiveUserId && (workspace.userId || 'demo-user') !== effectiveUserId && !workspace.shared) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  return res.json({ reports: (workspace.reports || []).map(omitGeneratedSql) });
});

app.post('/api/workspaces/:workspaceId/reports', async (req, res) => {
  workspaces = await loadWorkspaces();
  const workspace = workspaces.find((item) => item.id === req.params.workspaceId);

  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found.' });
  }

  const authUser = await getAuthenticatedUser(req);
  const requestedUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const workspaceUserId = workspace.userId || 'demo-user';
  const effectiveUserId = authUser ? authUser.email.toLowerCase() : normalizeUserId(requestedUserId || workspaceUserId);

  if (workspace.shared && !authUser && !requestedUserId) {
    return res.status(403).json({ error: 'Shared workspaces require a user context.' });
  }

  if (authUser && requestedUserId && normalizeUserId(requestedUserId) !== effectiveUserId) {
    return res.status(403).json({ error: 'This workspace is not available for the selected user.' });
  }

  if (!authUser && requestedUserId && requestedUserId !== workspaceUserId && !workspace.shared) {
    return res.status(403).json({ error: 'This workspace is not available for the selected user.' });
  }

  const { question, summary, topProduct, totalRevenue, insight, recommendation } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'A valid report question is required.' });
  }

  const report = {
    id: randomUUID(),
    question: question.trim(),
    summary: summary || 'Saved report',
    topProduct: topProduct || null,
    totalRevenue: Number(totalRevenue) || 0,
    insight: insight || null,
    recommendation: recommendation || null,
    userId: effectiveUserId,
    createdAt: new Date().toISOString(),
  };

  workspace.reports = Array.isArray(workspace.reports) ? workspace.reports : [];
  workspace.reports.unshift(report);
  while (workspace.reports.length > 10) {
    workspace.reports.pop();
  }

  await persistWorkspaces(workspaces);

  return res.json({ report, workspaceId: workspace.id });
});

app.get('/api/forecast', async (_req, res) => {
  const forecast = await buildForecast();
  return res.json({ forecast });
});

app.get('/api/reports', async (req, res) => {
  savedReports = await loadSavedReports();
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const authUser = await getAuthenticatedUser(req);
  const effectiveUserId = authUser ? authUser.email.toLowerCase() : requestedUserId;
  const reports = filterByUserId(savedReports, effectiveUserId)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(omitGeneratedSql);
  return res.json({ reports });
});

app.post('/api/reports', async (req, res) => {
  savedReports = await loadSavedReports();
  const { question, summary, topProduct, totalRevenue, insight, recommendation, userId } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'A valid report question is required.' });
  }

  const authUser = await getAuthenticatedUser(req);
  const resolvedUserId = authUser ? authUser.email.toLowerCase() : normalizeUserId(userId || 'demo-user');

  if (authUser && userId && normalizeUserId(userId) !== resolvedUserId) {
    return res.status(403).json({ error: 'This report cannot be saved for another user.' });
  }

  const report = {
    id: randomUUID(),
    question: question.trim(),
    summary: summary || 'Saved report',
    topProduct: topProduct || null,
    totalRevenue: Number(totalRevenue) || 0,
    insight: insight || null,
    recommendation: recommendation || null,
    userId: resolvedUserId,
    createdAt: new Date().toISOString(),
  };

  savedReports.unshift(report);
  while (savedReports.length > 8) {
    savedReports.pop();
  }
  await persistSavedReports(savedReports);

  return res.json({ report });
});

app.post('/api/ask', async (req, res) => {
  users = await loadUsers();
  workspaces = await loadWorkspaces();
  sessionMemory = await loadSessionMemory();
  savedReports = await loadSavedReports();
  const { question, userId } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      error: 'A valid business question is required.',
    });
  }

  const normalizedQuestion = question.trim();
  const authUser = await getAuthenticatedUser(req);
  const resolvedUserId = authUser ? authUser.email.toLowerCase() : normalizeUserId(userId || 'demo-user');

  if (authUser && userId && normalizeUserId(userId) !== resolvedUserId) {
    return res.status(403).json({ error: 'This request cannot be issued for another user.' });
  }

  try {
    const analyticsPlan = buildAnalyticsPlan(normalizedQuestion);
    const analyticsResult = await callSqlMcpTool(analyticsPlan.toolName, analyticsPlan.arguments);
    const rows = normalizeAnalyticsRows(analyticsResult.rows);
    knowledgeDocuments = await loadDocuments();
    let ragDocuments = [];
    try {
      ragDocuments = await searchKnowledgeDocuments(normalizedQuestion, 3);
    } catch (error) {
      console.warn('Vector retrieval unavailable; continuing without retrieved context:', error.message);
    }
    const contextNotes = ragDocuments.map((document) => document.content);
    const answerMeta = buildAnswer(normalizedQuestion, rows, contextNotes);
    const overview = buildOverview(rows, normalizedQuestion, contextNotes);
    const insight = buildInsight(rows, contextNotes);
    const recommendation = buildRecommendation(contextNotes, overview.topProduct);
    const orchestration = buildOrchestration(normalizedQuestion, rows, contextNotes);
    const llmContext = await buildLLMContext(normalizedQuestion, rows, contextNotes);
    const forecast = await buildForecast();
    const kpiDrift = buildKpiDrift(rows);
    const mlAnalysis = await callMLService(rows, contextNotes);

    const regionQuery = `
      SELECT country AS region, ROUND(CAST(SUM(line_revenue) AS numeric), 2) AS revenue
      FROM retail_transactions
      GROUP BY country
      ORDER BY revenue DESC;
    `;
    const regionResult = await pool.query(regionQuery);
    const regionBreakdown = buildRegionBreakdown(regionResult.rows);
    const anomalies = buildAnomalySignals(rows, regionResult.rows);
    const executiveSummary = buildExecutiveSummary(rows, contextNotes);

    const latestEntry = {
      question: normalizedQuestion,
      answer: answerMeta.answer,
      insight: insight.summary,
      userId: resolvedUserId,
      time: new Date().toISOString(),
    };

    sessionMemory.push(latestEntry);
    while (sessionMemory.length > 6) {
      sessionMemory.shift();
    }
    await persistSessionMemory(sessionMemory);

    const result = {
      question: normalizedQuestion,
      answer: answerMeta.answer,
      summary: answerMeta.summary,
      overview,
      contextSummary: overview.contextSummary,
      insight,
      recommendation,
      executiveSummary,
      forecast,
      kpiDrift,
      mlAnalysis,
      ragDocuments,
      orchestration,
      signals: orchestration.signals,
      regionBreakdown,
      anomalies,
      llmContext,
      sessionMemory: sessionMemory.slice().reverse(),
      chartData: rows.map((row) => ({
        label: row.product || row.region || row.customer || row.month || 'Metric',
        value: Number(row.revenue || 0),
      })),
      data: rows.map((row) => ({
        ...row,
        revenue: Number(row.revenue),
      })),
      evidence: [
        ...answerMeta.evidence,
        ...ragDocuments.map((document) => `Source: ${document.attribution} ${document.source} (License: ${document.license})`),
      ],
      agentTrace: [
        'Supervisor: classified the request as a SQL analytics task',
        'SQL Agent: matched the question to a read-only query template',
        'RAG Agent: retrieved relevant business context from the knowledge base',
        'Forecast Agent: measured the recent revenue trend and projected the next-quarter estimate',
        'Data layer: aggregated the relevant metric from PostgreSQL',
      ],
    };

    return res.json(result);
  } catch (error) {
    console.error('Database query failed:', error.message);
    return res.status(500).json({
      error: 'Unable to query the business data. Please try again.',
    });
  }
});

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const { host, port } = getListenConfig();
  const server = app.listen(port, host, () => {
    console.log(`Backend running on http://${host}:${port}`);
  });
  ensureBusinessSchema().then((ready) => {
    if (!ready) {
      console.warn('Backend started, but the retail database schema is unavailable.');
    }
  });
  process.on('SIGTERM', async () => {
    server.close();
    await closeMcpHost();
    await pool.end();
  });
}

export { app, pool, generateSqlQuery, retrieveRelevantContext, getListenConfig, getDatabaseConfig, ensureBusinessSchema, BUSINESS_SCHEMA_SQL, resolvePythonCommand };
