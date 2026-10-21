import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import pg from 'pg';
import unzipper from 'unzipper';
import { from as copyFrom } from 'pg-copy-streams';

const { Pool } = pg;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultArchivePath = path.resolve(scriptDirectory, '../../database/data/online-retail.zip');
const sourceUrl = 'https://archive.ics.uci.edu/static/public/352/online+retail.zip';
const license = 'CC BY 4.0';
const attribution = 'Chen, D. (2015). Online Retail. UCI Machine Learning Repository. https://doi.org/10.24432/C5BW33';
const expectedHeaders = [
  'InvoiceNo',
  'StockCode',
  'Description',
  'Quantity',
  'InvoiceDate',
  'UnitPrice',
  'CustomerID',
  'Country',
];

const getDatabaseConfig = () => {
  const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:55432/agentic_bi';
  const isRdsConnection = /rds\.amazonaws\.com/i.test(connectionString) || /\.rds\./i.test(connectionString);
  const useSsl = process.env.POSTGRES_SSL === 'true' || isRdsConnection;

  return {
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  };
};

const getArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const hasFlag = (name) => process.argv.includes(name);

const hashFile = async (filePath) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
};

const escapeCsv = (value) => {
  if (value === null || value === undefined) {
    return '';
  }

  return `"${String(value).replaceAll('"', '""')}"`;
};

const normalizeDate = (value, rowNumber) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid InvoiceDate at worksheet row ${rowNumber}.`);
  }

  return date.toISOString().replace('T', ' ').replace('Z', '');
};

const normalizeRow = (values, rowNumber) => {
  const invoiceNo = String(values[1] ?? '').trim();
  const stockCode = String(values[2] ?? '').trim();
  const quantity = Number(values[4]);
  const unitPrice = Number(values[6]);
  const customerValue = values[7];
  const description = String(values[3] ?? '').trim() || '(No description)';
  const country = String(values[8] ?? '').trim();

  if (!invoiceNo || !stockCode || !Number.isInteger(quantity) || !Number.isFinite(unitPrice) || !country) {
    throw new Error(`Invalid required transaction value at worksheet row ${rowNumber}.`);
  }

  const customerId = customerValue === null || customerValue === undefined || customerValue === ''
    ? null
    : String(customerValue).trim().replace(/\.0$/, '');

  return [
    rowNumber,
    invoiceNo,
    stockCode,
    description,
    quantity,
    normalizeDate(values[5], rowNumber),
    unitPrice.toFixed(2),
    customerId,
    country,
  ];
};

async function* workbookCsvRows(workbookPath, stats) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(workbookPath, {
    sharedStrings: 'cache',
    styles: 'ignore',
    worksheets: 'emit',
  });
  let headerFound = false;

  for await (const worksheet of workbook) {
    for await (const row of worksheet) {
      const values = row.values;
      if (!headerFound) {
        const headers = values.slice(1).map((value) => String(value ?? '').trim());
        if (expectedHeaders.some((header, index) => headers[index] !== header)) {
          throw new Error(`Unexpected workbook columns: ${headers.join(', ')}`);
        }
        headerFound = true;
        continue;
      }

      if (!values.slice(1).some((value) => value !== null && value !== undefined && value !== '')) {
        continue;
      }

      const record = normalizeRow(values, row.number);
      stats.rows += 1;
      if (String(record[1]).toUpperCase().startsWith('C')) {
        stats.cancellations += 1;
      }
      if (record[7] === null) {
        stats.missingCustomerIds += 1;
      }

      yield `${record.map(escapeCsv).join(',')}\n`;
    }
  }

  if (!headerFound) {
    throw new Error('The workbook did not contain a header row.');
  }
}

const extractWorkbook = async (archivePath, directoryPath) => {
  const archive = await unzipper.Open.file(archivePath);
  const workbookEntry = archive.files.find((entry) => entry.path === 'Online Retail.xlsx');
  if (!workbookEntry) {
    throw new Error('The archive does not contain Online Retail.xlsx.');
  }

  const workbookPath = path.join(directoryPath, 'Online Retail.xlsx');
  await pipeline(workbookEntry.stream(), createWriteStream(workbookPath));
  return workbookPath;
};

const ensureSchema = async (client) => {
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.query(`
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
    )
  `);
  await client.query('CREATE INDEX IF NOT EXISTS retail_transactions_invoice_date_idx ON retail_transactions (invoice_date)');
  await client.query('CREATE INDEX IF NOT EXISTS retail_transactions_stock_code_idx ON retail_transactions (stock_code)');
  await client.query('CREATE INDEX IF NOT EXISTS retail_transactions_country_idx ON retail_transactions (country)');
  await client.query('CREATE INDEX IF NOT EXISTS retail_transactions_customer_id_idx ON retail_transactions (customer_id) WHERE customer_id IS NOT NULL');
  await client.query(`
    CREATE TABLE IF NOT EXISTS dataset_imports (
      dataset_key TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      source_url TEXT NOT NULL,
      license TEXT NOT NULL,
      attribution TEXT NOT NULL,
      imported_rows BIGINT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

export const inspectRetailArchive = async (archivePath) => {
  const temporaryDirectory = await mkdtemp(path.join(process.env.TEMP || process.env.TMP || '/tmp', 'online-retail-'));
  try {
    const workbookPath = await extractWorkbook(archivePath, temporaryDirectory);
    const stats = { rows: 0, cancellations: 0, missingCustomerIds: 0 };
    for await (const _line of workbookCsvRows(workbookPath, stats)) {
      // Consume the stream to validate every row without holding the dataset in memory.
    }
    return stats;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const importRetailArchive = async (archivePath) => {
  const checksum = await hashFile(archivePath);
  const temporaryDirectory = await mkdtemp(path.join(process.env.TEMP || process.env.TMP || '/tmp', 'online-retail-'));
  const pool = new Pool(getDatabaseConfig());
  const client = await pool.connect();

  try {
    await ensureSchema(client);
    const previousImport = await client.query(
      'SELECT sha256, imported_rows FROM dataset_imports WHERE dataset_key = $1',
      ['uci-online-retail'],
    );

    if (previousImport.rows[0]?.sha256 === checksum) {
      return {
        rows: Number(previousImport.rows[0].imported_rows),
        skipped: true,
      };
    }

    const workbookPath = await extractWorkbook(archivePath, temporaryDirectory);
    const stats = { rows: 0, cancellations: 0, missingCustomerIds: 0 };

    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE retail_transactions_stage (
        source_row BIGINT PRIMARY KEY,
        invoice_no TEXT NOT NULL,
        stock_code TEXT NOT NULL,
        description TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        invoice_date TIMESTAMP WITHOUT TIME ZONE NOT NULL,
        unit_price NUMERIC(12, 2) NOT NULL,
        customer_id TEXT,
        country TEXT NOT NULL
      ) ON COMMIT DROP
    `);

    const copyStream = client.query(copyFrom(`
      COPY retail_transactions_stage (
        source_row, invoice_no, stock_code, description, quantity,
        invoice_date, unit_price, customer_id, country
      ) FROM STDIN WITH (FORMAT csv)
    `));
    await pipeline(Readable.from(workbookCsvRows(workbookPath, stats), { objectMode: false }), copyStream);

    await client.query(`
      DELETE FROM retail_transactions AS current
      WHERE NOT EXISTS (
        SELECT 1 FROM retail_transactions_stage AS incoming
        WHERE incoming.source_row = current.source_row
      )
    `);
    await client.query(`
      INSERT INTO retail_transactions (
        source_row, invoice_no, stock_code, description, quantity,
        invoice_date, unit_price, customer_id, country
      )
      SELECT source_row, invoice_no, stock_code, description, quantity,
             invoice_date, unit_price, customer_id, country
      FROM retail_transactions_stage
      ON CONFLICT (source_row) DO UPDATE SET
        invoice_no = EXCLUDED.invoice_no,
        stock_code = EXCLUDED.stock_code,
        description = EXCLUDED.description,
        quantity = EXCLUDED.quantity,
        invoice_date = EXCLUDED.invoice_date,
        unit_price = EXCLUDED.unit_price,
        customer_id = EXCLUDED.customer_id,
        country = EXCLUDED.country
    `);
    await client.query(`
      INSERT INTO dataset_imports (dataset_key, sha256, source_url, license, attribution, imported_rows)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (dataset_key) DO UPDATE SET
        sha256 = EXCLUDED.sha256,
        source_url = EXCLUDED.source_url,
        license = EXCLUDED.license,
        attribution = EXCLUDED.attribution,
        imported_rows = EXCLUDED.imported_rows,
        imported_at = NOW()
    `, ['uci-online-retail', checksum, sourceUrl, license, attribution, stats.rows]);
    await client.query('COMMIT');

    return { ...stats, skipped: false, sha256: checksum };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const main = async () => {
  const archivePath = path.resolve(getArgument('--file') || defaultArchivePath);
  const stats = hasFlag('--dry-run')
    ? await inspectRetailArchive(archivePath)
    : await importRetailArchive(archivePath);

  console.log(JSON.stringify({ archivePath, ...stats }, null, 2));
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Retail dataset import failed:', error.message);
    process.exitCode = 1;
  });
}