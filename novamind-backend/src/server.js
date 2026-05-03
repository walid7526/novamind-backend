require('dotenv').config();
const express = require('express')
const passport = require('passport');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const app = express();
const httpServer = createServer(app);

// ==============================
// SOCKET.IO (temps réel)
// ==============================
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('🔌 Client connecté:', socket.id);
  socket.on('join_room', (userId) => socket.join(userId));
  socket.on('disconnect', () => console.log('🔌 Client déconnecté:', socket.id));
});

// ==============================
// MIDDLEWARES GLOBAUX
// ==============================
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-refresh-token'],
}));

app.use(compression());
app.use(morgan('dev'));

// Body parsing (sauf pour les webhooks Stripe)
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==============================
// RATE LIMITING GLOBAL
// ==============================
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

// Rate limit strict pour auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ==============================
// ROUTES
// ==============================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/users', require('./routes/users'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/memory', require('./routes/memory'));
const memoryAdminModule = require('./routes/memory-admin');
app.use('/api/memory', memoryAdminModule.memoryRouter || memoryAdminModule);
app.use('/api/admin-memory', memoryAdminModule.adminRouter || memoryAdminModule);
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/images', require('./routes/images'));
app.use('/api/search', require('./routes/search'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/export', require('./routes/export'));
app.use('/api/think', require('./routes/think'));
app.use('/api/instructions', require('./routes/instructions'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/oauth', require('./routes/oauth'));
app.use('/api/code', require('./routes/code'));
app.use('/api/gear5', require('./routes/gear5'));

// Route santé
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    app: 'NovaMind API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

// Gestionnaire erreurs global
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erreur serveur interne'
      : err.message,
  });
});

// ==============================
// DÉMARRAGE
// ==============================
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════╗
  ║   🧠 NovaMind API — v1.0.0       ║
  ║   🚀 Port: ${PORT}                    ║
  ║   🌍 Env: ${process.env.NODE_ENV}           ║
  ╚═══════════════════════════════════╝
  `);
});

module.exports = { app, io };
