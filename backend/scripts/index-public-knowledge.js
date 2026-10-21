import 'dotenv/config';
import { initializeVectorStore, indexPublicKnowledge, loadKnowledgeCorpus } from '../src/rag-service.js';

const main = async () => {
  const documents = await loadKnowledgeCorpus();
  const vectorStore = await initializeVectorStore();

  try {
    const result = await indexPublicKnowledge(vectorStore, documents);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await vectorStore.end();
  }
};

main().catch((error) => {
  console.error('Public knowledge indexing failed:', error.message);
  process.exitCode = 1;
});