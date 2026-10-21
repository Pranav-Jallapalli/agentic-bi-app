import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { indexPublicKnowledge, initializeVectorStore, loadKnowledgeCorpus, searchPublicKnowledge } from '../rag-service.js';

const server = new McpServer({ name: 'agentic-bi-vector', version: '1.0.0' });
let vectorStorePromise;

const getVectorStore = () => {
  if (!vectorStorePromise) {
    vectorStorePromise = initializeVectorStore();
  }
  return vectorStorePromise;
};

server.registerTool('search_public_knowledge', {
  title: 'Search public retail knowledge',
  description: 'Search the licensed retail knowledge corpus using LangChain embeddings and PostgreSQL pgvector. Returns source and license metadata for citations.',
  inputSchema: {
    query: z.string().min(3).max(1000),
    limit: z.number().int().min(1).max(10).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, async ({ query, limit = 3 }) => {
  try {
    const vectorStore = await getVectorStore();
    const corpus = await loadKnowledgeCorpus();
    await indexPublicKnowledge(vectorStore, corpus);
    const documents = await searchPublicKnowledge(vectorStore, query, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify({ documents }) }],
      structuredContent: { documents },
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Vector search failed: ${error.message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGTERM', async () => {
  if (vectorStorePromise) {
    const vectorStore = await vectorStorePromise.catch(() => null);
    await vectorStore?.end();
  }
  process.exit(0);
});