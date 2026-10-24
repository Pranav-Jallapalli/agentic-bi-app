const queries = {
  top_products_by_revenue: {
    description: 'Net revenue by product, including cancellation and return lines as negative revenue.',
    sql: `
      SELECT stock_code AS "stockCode",
             MAX(description) AS product,
             ROUND(SUM(line_revenue), 2) AS revenue
      FROM retail_transactions
      GROUP BY stock_code
      ORDER BY revenue DESC
      LIMIT $1;
    `,
    input: 'limit',
  },
  top_products_latest_month: {
    description: 'Top products by net revenue in the latest calendar month present in the dataset.',
    sql: `
      WITH latest_month AS (
        SELECT DATE_TRUNC('month', MAX(invoice_date)) AS month_start
        FROM retail_transactions
      )
      SELECT stock_code AS "stockCode",
             MAX(description) AS product,
             ROUND(SUM(line_revenue), 2) AS revenue
      FROM retail_transactions, latest_month
      WHERE invoice_date >= latest_month.month_start
        AND invoice_date < latest_month.month_start + INTERVAL '1 month'
      GROUP BY stock_code
      ORDER BY revenue DESC
      LIMIT $1;
    `,
    input: 'limit',
  },
  revenue_by_country: {
    description: 'Net revenue by customer country.',
    sql: `
      SELECT country,
             country AS region,
             ROUND(SUM(line_revenue), 2) AS revenue
      FROM retail_transactions
      GROUP BY country
      ORDER BY revenue DESC;
    `,
  },
  top_customers_by_revenue: {
    description: 'Net revenue by known customer ID; rows without a customer ID are excluded.',
    sql: `
      SELECT customer_id AS customer,
             ROUND(SUM(line_revenue), 2) AS revenue
      FROM retail_transactions
      WHERE customer_id IS NOT NULL
      GROUP BY customer_id
      ORDER BY revenue DESC
      LIMIT $1;
    `,
    input: 'limit',
  },
  monthly_revenue: {
    description: 'Monthly net revenue ordered chronologically.',
    sql: `
      SELECT TO_CHAR(invoice_date, 'YYYY-MM') AS month,
             ROUND(SUM(line_revenue), 2) AS revenue
      FROM retail_transactions
      GROUP BY TO_CHAR(invoice_date, 'YYYY-MM')
      ORDER BY month ASC;
    `,
  },
};

export const analyticsToolNames = Object.freeze(Object.keys(queries));

export const normalizeAnalyticsRows = (rows) => rows.map((row) => (
  row.stockCode?.toUpperCase() === 'DOT'
    ? {
      ...row,
      product: 'Postage and shipping fees',
      stockCode: 'Postage and shipping fees',
    }
    : row
));

export const buildAnalyticsPlan = (question) => {
  const normalized = question.toLowerCase();

  if (/(last|latest|previous|most recent)\s+(month|period)|month.*(top|highest|best).*product/.test(normalized)) {
    return { toolName: 'top_products_latest_month', arguments: { limit: 5 } };
  }

  if (/(region|countr(?:y|ies)|area|territory).*(revenue|sales)|revenue.*(region|countr(?:y|ies)|area|territory)|sales.*(region|countr(?:y|ies)|area|territory)/.test(normalized)) {
    return { toolName: 'revenue_by_country', arguments: {} };
  }

  if (/(customer|client|buyer).*(revenue|sales)|revenue.*(customer|client|buyer)|sales.*(customer|client|buyer)/.test(normalized)) {
    return { toolName: 'top_customers_by_revenue', arguments: { limit: 5 } };
  }

  if (/(month|date|trend|time|forecast).*revenue|revenue.*(month|date|trend|time)|sales.*(month|date|trend)/.test(normalized)) {
    return { toolName: 'monthly_revenue', arguments: {} };
  }

  return { toolName: 'top_products_by_revenue', arguments: { limit: 5 } };
};

export const getAnalyticsSql = (toolName) => {
  const definition = queries[toolName];
  if (!definition) {
    throw new Error(`Unsupported analytics tool: ${toolName}`);
  }
  return definition.sql.trim();
};

export const runAnalyticsTool = async (databasePool, toolName, args = {}) => {
  const definition = queries[toolName];
  if (!definition) {
    throw new Error(`Unsupported analytics tool: ${toolName}`);
  }

  const parameters = definition.input === 'limit'
    ? [Math.min(100, Math.max(1, Number(args.limit) || 5))]
    : [];
  const client = await databasePool.connect();

  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(definition.sql, parameters);
    await client.query('COMMIT');
    return {
      rows: result.rows,
      sql: definition.sql.trim(),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const getAnalyticsToolDescription = (toolName) => queries[toolName]?.description;