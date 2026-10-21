import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { PGVectorStore } from '@langchain/pgvector';
import { getDatabaseConfig } from './database-config.js';

const serviceDirectory = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_KNOWLEDGE_PATH = path.resolve(serviceDirectory, '../data/public-knowledge.json');
const vectorTableName = process.env.PGVECTOR_TABLE || 'rag_documents';
const vectorCollectionName = process.env.PGVECTOR_COLLECTION || 'agentic_bi_retail';

export const isRagConfigured = () => Boolean(process.env.GEMINI_API_KEY);

export const loadPublicKnowledge = async (filePath = PUBLIC_KNOWLEDGE_PATH) => {
  const content = await readFile(filePath, 'utf8');
  const documents = JSON.parse(content);
  if (!Array.isArray(documents)) {
    throw new Error('Public knowledge file must contain a JSON array.');
  }
  return documents;
};

export const loadKnowledgeCorpus = async () => {
  const publicDocuments = await loadPublicKnowledge();
  let userDocuments = [];

  try {
    const storedContent = await readFile(path.resolve(serviceDirectory, '../data/documents.json'), 'utf8');
    const parsed = JSON.parse(storedContent);
    if (Array.isArray(parsed)) {
      userDocuments = parsed.map((document) => ({
        ...document,
        source: `local://user-documents/${document.id}`,
        license: 'User-provided content; reuse terms not specified',
        attribution: 'User-provided document',
        publicationDate: document.createdAt || null,
      }));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  return [...publicDocuments, ...userDocuments];
};

export const createDocumentChunks = async (documents) => {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 700, chunkOverlap: 100 });
  const langchainDocuments = documents.map((document) => new Document({
    pageContent: `${document.title}\n\n${document.content}`,
    metadata: {
      id: document.id,
      title: document.title,
      tags: document.tags,
      source: document.source,
      license: document.license,
      attribution: document.attribution,
      publicationDate: document.publicationDate,
    },
  }));
  return splitter.splitDocuments(langchainDocuments);
};

export const createEmbeddings = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required for semantic document indexing and search.');
  }

  return new GoogleGenerativeAIEmbeddings({
    apiKey,
    modelName: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    outputDimensionality: Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768),
  });
};

export const initializeVectorStore = async () => {
  const databaseConfig = getDatabaseConfig();
  const url = new URL(databaseConfig.connectionString);
  const postgresConnectionOptions = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: databaseConfig.ssl,
  };

  return PGVectorStore.initialize(createEmbeddings(), {
    postgresConnectionOptions,
    tableName: vectorTableName,
    collectionName: vectorCollectionName,
    collectionTableName: 'langchain_pg_collection',
    columns: {
      idColumnName: 'id',
      vectorColumnName: 'vector',
      contentColumnName: 'content',
      metadataColumnName: 'metadata',
    },
    dimensions: Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768),
    distanceStrategy: 'cosine',
    scoreNormalization: 'similarity',
  });
};

export const indexPublicKnowledge = async (vectorStore, documents) => {
  const chunks = await createDocumentChunks(documents);
  const metadataBySource = new Map();
  for (const document of documents) {
    metadataBySource.set(document.source, document);
  }

  await vectorStore.pool.query(`
    CREATE TABLE IF NOT EXISTS rag_ingestion_runs (
      source TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  for (const [source, document] of metadataBySource) {
    const matchingChunks = chunks.filter((chunk) => chunk.metadata.source === source);
    const sourceHash = createHash('sha256').update(JSON.stringify(document)).digest('hex');
    const prior = await vectorStore.pool.query(
      'SELECT sha256 FROM rag_ingestion_runs WHERE source = $1',
      [source],
    );
    if (prior.rows[0]?.sha256 === sourceHash) {
      continue;
    }

    await vectorStore.delete({ filter: { source } });
    await vectorStore.addDocuments(matchingChunks);
    await vectorStore.pool.query(`
      INSERT INTO rag_ingestion_runs (source, sha256, chunk_count)
      VALUES ($1, $2, $3)
      ON CONFLICT (source) DO UPDATE SET
        sha256 = EXCLUDED.sha256,
        chunk_count = EXCLUDED.chunk_count,
        indexed_at = NOW()
    `, [source, sourceHash, matchingChunks.length]);
  }

  const indexedSources = await vectorStore.pool.query('SELECT source FROM rag_ingestion_runs');
  const currentSources = new Set(metadataBySource.keys());
  for (const { source } of indexedSources.rows) {
    if (currentSources.has(source)) {
      continue;
    }
    await vectorStore.delete({ filter: { source } });
    await vectorStore.pool.query('DELETE FROM rag_ingestion_runs WHERE source = $1', [source]);
  }

  return { documents: documents.length, chunks: chunks.length };
};

export const searchPublicKnowledge = async (vectorStore, query, limit = 3) => {
  const matches = await vectorStore.similaritySearchWithScore(query, Math.min(10, Math.max(1, limit)));
  return matches.map(([document, similarity]) => ({
    id: document.metadata.id,
    title: document.metadata.title,
    content: document.pageContent,
    source: document.metadata.source,
    license: document.metadata.license,
    attribution: document.metadata.attribution,
    publicationDate: document.metadata.publicationDate,
    similarity,
  }));
};