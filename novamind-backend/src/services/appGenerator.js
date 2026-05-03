const { generateAIResponse } = require('./ai')

// ==============================
// MODÈLE PAR DÉFAUT GEAR 5
// Claude Opus = meilleur pour génération code complet
// ==============================
const GEAR5_DEFAULT_MODEL = 'claude-opus' // Claude Opus prioritaire
const GEAR5_FALLBACK_MODEL = 'gpt-4o'     // Fallback si Claude indisponible
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const archiver = require('archiver')

// ==============================
// CHIFFREMENT DES CLÉS API
// ==============================
const ENCRYPTION_KEY = process.env.JWT_SECRET?.slice(0, 32).padEnd(32, '0') || 'novamind_encrypt_key_32chars!!'
const IV_LENGTH = 16

const encryptKey = (text) => {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

const decryptKey = (text) => {
  const [ivHex, encryptedHex] = text.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv)
  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return decrypted.toString()
}

// ==============================
// FILTRAGE SÉCURITÉ — Usages interdits
// ==============================
const FORBIDDEN_PATTERNS = [
  'hack', 'phishing', 'malware', 'virus', 'trojan', 'keylogger',
  'ransomware', 'ddos', 'brute force', 'sql injection', 'xss attack',
  'exploit', 'botnet', 'spyware', 'backdoor', 'rootkit',
  'steal password', 'crack password', 'bypass security',
  'illegal', 'fraud', 'scam', 'fake login', 'credential harvesting'
]

const isForbiddenRequest = (description) => {
  const lower = description.toLowerCase()
  return FORBIDDEN_PATTERNS.some(pattern => lower.includes(pattern))
}

// ==============================
// ANALYSE DE LA DEMANDE
// ==============================
const analyzeRequest = async (description, model = GEAR5_DEFAULT_MODEL) => {
  const response = await generateAIResponse({
    model: userModel || GEAR5_DEFAULT_MODEL,
    messages: [{ role: 'user', content: description }],
    systemPrompt: `Tu es un architecte logiciel expert. Analyse cette demande d'application et réponds UNIQUEMENT en JSON valide :
{
  "name": "nom du projet (slug, pas d'espaces)",
  "display_name": "Nom affichable du projet",
  "description": "Description courte en 1 phrase",
  "type": "saas|dashboard|api|tool|prototype",
  "tech_stack": {
    "frontend": "react|nextjs|vanilla",
    "backend": "nodejs|fastapi",
    "database": "postgresql|mongodb|none",
    "auth": true|false
  },
  "features": ["liste", "des", "fonctionnalités", "principales"],
  "pages": ["liste", "des", "pages", "frontend"],
  "api_routes": ["liste", "des", "routes", "API", "principales"]
}`,
    stream: false,
    userGear: 5,
    isFounder: true,
  })

  try {
    const clean = response.content.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {
      name: 'my-app',
      display_name: 'Mon Application',
      description: description.slice(0, 100),
      type: 'tool',
      tech_stack: { frontend: 'react', backend: 'nodejs', database: 'none', auth: false },
      features: ['Interface utilisateur', 'API backend'],
      pages: ['Home', 'Dashboard'],
      api_routes: ['/api/health', '/api/data']
    }
  }
}

// ==============================
// GÉNÉRATION DU BACKEND
// ==============================
const generateBackend = async (analysis, userApiKeys = {}, model = GEAR5_DEFAULT_MODEL) => {
  const envVars = Object.keys(userApiKeys).map(k => `${k}=your_${k.toLowerCase()}_here`).join('\n')

  const response = await generateAIResponse({
    model,
    messages: [{
      role: 'user',
      content: `Génère un backend Node.js/Express complet pour : ${analysis.display_name}
Description : ${analysis.description}
Fonctionnalités : ${analysis.features.join(', ')}
Routes API : ${analysis.api_routes.join(', ')}
Auth requise : ${analysis.tech_stack.auth}
Base de données : ${analysis.tech_stack.database}

RÈGLES IMPORTANTES :
- Code complet et fonctionnel, pas de placeholder
- Toutes les variables sensibles via process.env (jamais en dur)
- Gestion des erreurs complète
- CORS configuré
- Structure modulaire claire
- Réponds en JSON avec cette structure exacte :
{
  "server.js": "contenu complet du fichier",
  "package.json": "contenu JSON complet",
  ".env.example": "variables d'environnement exemple",
  "routes/index.js": "routes principales",
  "middleware/auth.js": "middleware auth si nécessaire",
  "README.md": "documentation complète"
}`
    }],
    stream: false,
    userGear: 5,
    isFounder: true,
  })

  try {
    const clean = response.content.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    // Fallback si le JSON est invalide
    return {
      'server.js': response.content,
      'package.json': JSON.stringify({ name: analysis.name, version: '1.0.0', scripts: { start: 'node server.js', dev: 'nodemon server.js' }, dependencies: { express: '^4.18.2', cors: '^2.8.5', dotenv: '^16.0.0' } }, null, 2),
      '.env.example': `PORT=5000\nNODE_ENV=development\n${envVars}`,
      'README.md': `# ${analysis.display_name}\n\n${analysis.description}\n\n## Installation\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\``,
    }
  }
}

// ==============================
// GÉNÉRATION DU FRONTEND
// ==============================
const generateFrontend = async (analysis, model = GEAR5_DEFAULT_MODEL) => {
  const response = await generateAIResponse({
    model,
    messages: [{
      role: 'user',
      content: `Génère un frontend React complet pour : ${analysis.display_name}
Description : ${analysis.description}
Pages : ${analysis.pages.join(', ')}
Fonctionnalités : ${analysis.features.join(', ')}

RÈGLES OBLIGATOIRES :
- React avec Vite
- Tailwind CSS pour le style
- Code fonctionnel complet
- Appels API vers le backend (BASE_URL depuis import.meta.env)
- OBLIGATOIRE : Système i18n intégré avec support FR/EN minimum
  * Dossier /locales/fr.json et /locales/en.json avec toutes les traductions
  * Détection automatique langue navigateur (navigator.language)
  * Sauvegarde langue dans localStorage
  * Composant LanguageSwitcher dans l'interface
  * Toutes les chaînes de texte via le système i18n
- Réponds en JSON avec cette structure :
{
  "src/App.jsx": "contenu complet",
  "src/main.jsx": "contenu complet",
  "src/pages/Home.jsx": "page principale complète",
  "src/components/Navbar.jsx": "navigation complète",
  "index.html": "html de base",
  "package.json": "dépendances",
  "vite.config.js": "config vite",
  "tailwind.config.js": "config tailwind",
  ".env.example": "VITE_API_URL=http://localhost:5000",
  "src/i18n/index.js": "système i18n complet",
  "src/i18n/locales/fr.json": "traductions françaises",
  "src/i18n/locales/en.json": "traductions anglaises",
  "src/components/LanguageSwitcher.jsx": "composant sélection langue"
}`
    }],
    stream: false,
    userGear: 5,
    isFounder: true,
  })

  try {
    const clean = response.content.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(clean)
  } catch {
    return {
      'src/App.jsx': response.content,
      'package.json': JSON.stringify({ name: `${analysis.name}-frontend`, version: '1.0.0', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } }, null, 2),
      '.env.example': 'VITE_API_URL=http://localhost:5000',
    }
  }
}

// ==============================
// VALIDATION DU PROJET
// ==============================
const validateProject = async (backendFiles, frontendFiles, analysis) => {
  const issues = []

  // Vérifications basiques
  if (!backendFiles['server.js'] && !backendFiles['index.js']) {
    issues.push('Fichier serveur principal manquant')
  }
  if (!backendFiles['package.json']) {
    issues.push('package.json backend manquant')
  }
  if (!frontendFiles['src/App.jsx']) {
    issues.push('Composant App.jsx manquant')
  }
  if (!backendFiles['.env.example']) {
    issues.push('.env.example manquant')
  }

  // Vérifier qu'aucune clé n'est en dur
  const allContent = Object.values(backendFiles).join('\n') + Object.values(frontendFiles).join('\n')
  const hardcodedKeyPatterns = [/sk-[a-zA-Z0-9]{20,}/, /AIza[a-zA-Z0-9]{35}/, /Bearer [a-zA-Z0-9]{20,}/]
  hardcodedKeyPatterns.forEach(pattern => {
    if (pattern.test(allContent)) {
      issues.push('Clé API potentiellement exposée dans le code')
    }
  })

  return { valid: issues.length === 0, issues }
}

// ==============================
// CRÉATION DU ZIP
// ==============================
const createProjectZip = async (projectName, backendFiles, frontendFiles) => {
  const tmpDir = `/tmp/novamind-projects/${projectName}-${Date.now()}`
  const backendDir = path.join(tmpDir, 'backend')
  const frontendDir = path.join(tmpDir, 'frontend')

  fs.mkdirSync(backendDir, { recursive: true })
  fs.mkdirSync(frontendDir, { recursive: true })

  // Écrire les fichiers backend
  for (const [filePath, content] of Object.entries(backendFiles)) {
    const fullPath = path.join(backendDir, filePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, typeof content === 'object' ? JSON.stringify(content, null, 2) : content)
  }

  // Écrire les fichiers frontend
  for (const [filePath, content] of Object.entries(frontendFiles)) {
    const fullPath = path.join(frontendDir, filePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, typeof content === 'object' ? JSON.stringify(content, null, 2) : content)
  }

  // README racine
  fs.writeFileSync(path.join(tmpDir, 'README.md'), `# ${projectName}

Projet généré par NovaMind Gear 5.

## Structure

\`\`\`
/backend   → Serveur Node.js/Express
/frontend  → Application React
\`\`\`

## Démarrage rapide

### Backend
\`\`\`bash
cd backend
cp .env.example .env
# Remplissez les variables dans .env
npm install
npm run dev
\`\`\`

### Frontend
\`\`\`bash
cd frontend
cp .env.example .env
# Configurez VITE_API_URL
npm install
npm run dev
\`\`\`

## Déploiement

- **Backend** : Render.com, Railway, VPS
- **Frontend** : Vercel, Netlify

*Généré par [NovaMind](https://novamind.ai) — Gear 5*
`)

  // Créer le ZIP
  const zipPath = `${tmpDir}.zip`
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(tmpDir, projectName)
    archive.finalize()
  })

  // Nettoyage du dossier temp
  fs.rmSync(tmpDir, { recursive: true, force: true })

  return zipPath
}

// ==============================
// PIPELINE COMPLET
// ==============================
const generateApplication = async ({ description, userId, onProgress, userApiKeys = {}, userModel = null }) => {
  // 1. Sécurité — filtrage
  if (isForbiddenRequest(description)) {
    throw new Error('FORBIDDEN: Cette demande ne peut pas être traitée car elle viole nos conditions d\'utilisation.')
  }

  onProgress?.({ step: 1, total: 6, message: '🔍 Analyse de votre demande...' })
  const modelToUse = userModel || GEAR5_DEFAULT_MODEL
  const analysis = await analyzeRequest(description, modelToUse)

  onProgress?.({ step: 2, total: 6, message: '⚙️ Génération du backend...' })
  const backendFiles = await generateBackend(analysis, userApiKeys, modelToUse)

  onProgress?.({ step: 3, total: 6, message: '🎨 Génération du frontend...' })
  const frontendFiles = await generateFrontend(analysis, modelToUse)

  onProgress?.({ step: 4, total: 6, message: '🔍 Validation du projet...' })
  const validation = await validateProject(backendFiles, frontendFiles, analysis)

  if (!validation.valid) {
    onProgress?.({ step: 4, total: 6, message: `⚠️ Correction automatique: ${validation.issues.join(', ')}` })
    // Auto-correction : regénérer si problèmes critiques
    if (validation.issues.some(i => i.includes('manquant'))) {
      const fixedBackend = await generateBackend(analysis, userApiKeys)
      Object.assign(backendFiles, fixedBackend)
    }
  }

  onProgress?.({ step: 5, total: 6, message: '📦 Création du fichier ZIP...' })
  const zipPath = await createProjectZip(analysis.name, backendFiles, frontendFiles)

  onProgress?.({ step: 6, total: 6, message: '✅ Projet prêt !' })

  return {
    analysis,
    backendFiles,
    frontendFiles,
    zipPath,
    validation,
    allFiles: { ...backendFiles, ...frontendFiles }
  }
}

module.exports = { generateApplication, encryptKey, decryptKey, isForbiddenRequest, GEAR5_DEFAULT_MODEL, GEAR5_FALLBACK_MODEL }
