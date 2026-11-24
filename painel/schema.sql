CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  senha_salt TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'editor',
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL,
  expira_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dds (
  data TEXT PRIMARY KEY,
  conteudo TEXT NOT NULL,
  atualizado_por TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_por TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
