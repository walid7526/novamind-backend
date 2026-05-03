-- Ajouter la table dossiers
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  emoji VARCHAR(10) DEFAULT '📁',
  color VARCHAR(20) DEFAULT '#7c6af7',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ajouter colonne folder_id dans conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_folder_id ON conversations(folder_id);

-- Instructions personnalisées utilisateur
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_instructions TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_persona TEXT DEFAULT '';

-- ==============================
-- GEAR 5 — PROJETS GÉNÉRÉS
-- ==============================
CREATE TABLE IF NOT EXISTS generated_projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  project_type VARCHAR(100), -- 'saas' | 'dashboard' | 'api' | 'tool' | 'prototype'
  tech_stack JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'generating', -- 'generating' | 'ready' | 'error'
  version INTEGER DEFAULT 1,
  files JSONB DEFAULT '{}', -- Structure des fichiers générés
  zip_path TEXT, -- Chemin vers le ZIP
  error_log TEXT,
  parent_project_id UUID REFERENCES generated_projects(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Historique des versions
CREATE TABLE IF NOT EXISTS project_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES generated_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  files JSONB DEFAULT '{}',
  changelog TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Clés API utilisateur (chiffrées)
CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES generated_projects(id) ON DELETE CASCADE,
  key_name VARCHAR(255) NOT NULL,
  key_value_encrypted TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_projects_user ON generated_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_project_versions_project ON project_versions(project_id);

-- ==============================
-- ADMIN 2 : kaddanaminpro@gmail.com
-- Mot de passe : Hassan156 (sera hashé via bcrypt au premier login)
-- ==============================
INSERT INTO users (email, name, password_hash, role, gear, email_verified, created_at)
VALUES (
  'kaddanaminpro@gmail.com',
  'Admin NovaMind',
  '$2b$12$placeholder_will_be_set_on_first_login_Hassan156xxxx',
  'admin',
  5,
  true,
  NOW()
) ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  gear = 5,
  email_verified = true,
  updated_at = NOW();

-- ==============================
-- MIGRATION RÔLES + TITRES ONE PIECE
-- ==============================
ALTER TABLE users ADD COLUMN IF NOT EXISTS title VARCHAR(100) DEFAULT 'Sea Rookie';

-- Mettre à jour les titres selon les gears existants
UPDATE users SET title = 'Sea Rookie' WHERE gear = 1 AND role NOT IN ('admin', 'admin');
UPDATE users SET title = 'Rookie Pirate' WHERE gear = 2 AND role NOT IN ('admin', 'admin');
UPDATE users SET title = 'New World Explorer' WHERE gear = 3 AND role NOT IN ('admin', 'admin');
UPDATE users SET title = 'Haki Awakened' WHERE gear = 4 AND role NOT IN ('admin', 'admin');
UPDATE users SET title = 'Legendary Awakening' WHERE gear = 5 AND role NOT IN ('admin', 'admin');

-- Les admins ont toujours le titre Legendary Awakening
UPDATE users SET title = 'Legendary Awakening' WHERE role IN ('admin', 'admin');

-- Mettre à jour les rôles : users payants → subscriber
UPDATE users SET role = 'subscriber' WHERE gear > 1 AND role = 'user' AND subscription_status IN ('active', 'trialing');
