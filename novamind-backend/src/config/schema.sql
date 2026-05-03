-- ==============================
-- NOVAMIND — SCHÉMA BASE DE DONNÉES
-- ==============================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================
-- UTILISATEURS
-- ==============================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  username VARCHAR(100),
  avatar_url TEXT,
  
  -- Rôle & statut
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'subscriber', 'admin')),
  gear INTEGER DEFAULT 1 CHECK (gear BETWEEN 1 AND 5),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned', 'pending')),
  
  -- Vérification
  email_verified BOOLEAN DEFAULT false,
  email_verify_token VARCHAR(255),
  email_verify_expires TIMESTAMP,
  
  -- Récupération mot de passe
  reset_password_token VARCHAR(255),
  reset_password_expires TIMESTAMP,
  
  -- Sécurité
  login_attempts INTEGER DEFAULT 0,
  lock_until TIMESTAMP,
  two_factor_secret VARCHAR(255),
  two_factor_enabled BOOLEAN DEFAULT false,
  
  -- OAuth
  google_id VARCHAR(255),
  github_id VARCHAR(255),
  microsoft_id VARCHAR(255),
  
  -- Préférences
  preferred_ai_model VARCHAR(50) DEFAULT 'gpt-4o',
  theme VARCHAR(20) DEFAULT 'dark',
  language VARCHAR(10) DEFAULT 'fr',
  memory_enabled BOOLEAN DEFAULT true,
  
  -- Stripe
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  subscription_status VARCHAR(50) DEFAULT 'free',
  subscription_ends_at TIMESTAMP,
  trial_ends_at TIMESTAMP,
  
  -- Timestamps
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- SESSIONS / APPAREILS
-- ==============================
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  refresh_token VARCHAR(500) UNIQUE NOT NULL,
  device_name VARCHAR(255),
  device_type VARCHAR(50),
  ip_address VARCHAR(50),
  location VARCHAR(255),
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

-- ==============================
-- CONVERSATIONS
-- ==============================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) DEFAULT 'Nouvelle conversation',
  ai_model VARCHAR(50) DEFAULT 'gpt-4o',
  is_temporary BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  public_token VARCHAR(255) UNIQUE,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- MESSAGES
-- ==============================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'subscriber', 'admin')),
  content TEXT NOT NULL,
  ai_model VARCHAR(50),
  tokens_used INTEGER DEFAULT 0,
  has_attachment BOOLEAN DEFAULT false,
  attachment_url TEXT,
  attachment_type VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- MÉMOIRE IA
-- ==============================
CREATE TABLE IF NOT EXISTS ai_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category VARCHAR(100),
  importance INTEGER DEFAULT 5,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- PROMPTS FAVORIS
-- ==============================
CREATE TABLE IF NOT EXISTS favorite_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- FICHIERS UPLOADÉS
-- ==============================
CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  filename VARCHAR(500) NOT NULL,
  original_name VARCHAR(500),
  file_type VARCHAR(100),
  file_size INTEGER,
  url TEXT NOT NULL,
  is_analyzed BOOLEAN DEFAULT false,
  analysis_result TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- ABONNEMENTS & FACTURATION
-- ==============================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  stripe_customer_id VARCHAR(255),
  gear_level INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,
  billing_period VARCHAR(20) DEFAULT 'monthly',
  amount DECIMAL(10,2),
  currency VARCHAR(10) DEFAULT 'eur',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  canceled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- LOGS SÉCURITÉ
-- ==============================
CREATE TABLE IF NOT EXISTS security_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  ip_address VARCHAR(50),
  user_agent TEXT,
  location VARCHAR(255),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- IMAGES GÉNÉRÉES
-- ==============================
CREATE TABLE IF NOT EXISTS generated_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  image_url TEXT NOT NULL,
  model VARCHAR(100),
  resolution VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ==============================
-- INDEX PERFORMANCES
-- ==============================
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_memories_user_id ON ai_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

-- ==============================
-- COMPTE FONDATEUR VIP
-- ==============================
INSERT INTO users (
  email, 
  role, 
  gear, 
  status, 
  email_verified,
  preferred_ai_model,
  memory_enabled
) VALUES (
  'kaddanwalidpro@gmail.com',
  'admin',
  5,
  'active',
  true,
  'gpt-4o',
  true
) ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  gear = 5,
  status = 'active';
