-- Custom SQL migration file, put your code below! --

-- Enable pgvector from the start. No vector columns exist yet (added in the
-- chunking/embedding slice); this just makes the extension available.
CREATE EXTENSION IF NOT EXISTS vector;