-- Table tâches planifiées
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  frequency VARCHAR(50) NOT NULL, -- 'once' | 'daily' | 'weekly' | 'monthly'
  day_of_week INTEGER, -- 0=Dimanche, 1=Lundi... (pour weekly)
  day_of_month INTEGER, -- 1-31 (pour monthly)
  time_of_day VARCHAR(10) DEFAULT '09:00', -- HH:MM
  next_run TIMESTAMP,
  last_run TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  result TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user_id ON scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
