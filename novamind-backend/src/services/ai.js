const OpenAI = require('openai')

// ==============================
// CLIENT OPENROUTER — UNE SEULE CLÉ POUR TOUT
// ==============================
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://novamind.ai',
    'X-Title': 'NovaMind',
  },
})

// ==============================
// CONFIG DES MODÈLES PAR GEAR
// ==============================
const MODEL_CONFIG = {
  'gpt-4o': {
    openrouter_id: 'openai/gpt-4o',
    label: 'GPT-4o',
    provider: 'OpenAI',
    description: 'Modèle phare d\'OpenAI, rapide et puissant',
    min_gear: 2, // Gear 1 utilise Mini uniquement
  },
  'gpt-4o-mini': {
    openrouter_id: 'openai/gpt-4o-mini',
    label: 'GPT-4o Mini',
    provider: 'OpenAI',
    description: 'Version légère de GPT-4o',
    min_gear: 1,
  },
  'claude-sonnet': {
    openrouter_id: 'anthropic/claude-sonnet-4-5',
    label: 'Claude Sonnet',
    provider: 'Anthropic',
    description: 'Excellent équilibre performance et vitesse',
    min_gear: 2,
  },
  'claude-opus': {
    openrouter_id: 'anthropic/claude-opus-4-5',
    label: 'Claude Opus',
    provider: 'Anthropic',
    description: 'Le plus puissant modèle d\'Anthropic',
    min_gear: 3,
  },
  'gemini-flash': {
    openrouter_id: 'google/gemini-flash-1.5',
    label: 'Gemini Flash',
    provider: 'Google',
    description: 'Gemini rapide et efficace',
    min_gear: 1,
  },
  'gemini-pro': {
    openrouter_id: 'google/gemini-pro-1.5',
    label: 'Gemini Pro',
    provider: 'Google',
    description: 'Modèle avancé de Google',
    min_gear: 2,
  },
  'grok-2': {
    openrouter_id: 'x-ai/grok-2-1212',
    label: 'Grok 2',
    provider: 'xAI',
    description: 'IA de xAI avec accès temps réel',
    min_gear: 3,
  },
  'mistral-large': {
    openrouter_id: 'mistralai/mistral-large',
    label: 'Mistral Large',
    provider: 'Mistral',
    description: 'Meilleur modèle européen open-source',
    min_gear: 2,
  },
  'llama-3': {
    openrouter_id: 'meta-llama/llama-3.1-70b-instruct',
    label: 'Llama 3.1',
    provider: 'Meta',
    description: 'Puissant modèle open-source de Meta',
    min_gear: 2,
  },
  'deepseek': {
    openrouter_id: 'deepseek/deepseek-chat',
    label: 'DeepSeek',
    provider: 'DeepSeek',
    description: 'Modèle chinois très performant',
    min_gear: 1,
  },
}

// ==============================
// GÉNÉRER UNE RÉPONSE IA
// ==============================
const generateAIResponseCore = async ({
  model = 'gpt-4o',
  messages,
  systemPrompt,
  stream = false,
  userGear = 1,
  isAdmin = false,
}) => {
  const config = MODEL_CONFIG[model] || MODEL_CONFIG['gpt-4o']

  // Vérification Gear (administrateur bypass tout)
  if (!isAdmin && userGear < config.min_gear) {
    throw new Error(`Ce modèle requiert Gear ${config.min_gear}. Vous êtes en Gear ${userGear}.`)
  }

  const system = systemPrompt || buildSystemPrompt(isAdmin)

  const formattedMessages = [
    { role: 'system', content: system },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  if (stream) {
    return openrouter.chat.completions.create({
      model: config.openrouter_id,
      messages: formattedMessages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
    })
  }

  const response = await openrouter.chat.completions.create({
    model: config.openrouter_id,
    messages: formattedMessages,
    max_tokens: 4096,
    temperature: 0.7,
  })

  return {
    content: response.choices[0].message.content,
    tokens_used: response.usage?.total_tokens || 0,
    model: config.openrouter_id,
    provider: config.provider,
  }
}

// ==============================
// PROMPT SYSTÈME NOVAMIND
// ==============================
const buildSystemPrompt = (isAdmin = false) => {
  return `Tu es NovaMind, une IA conversationnelle avancée et bienveillante.
Tu es conçu pour être utile, précis, créatif et agréable à utiliser.
Tu réponds toujours dans la langue de l'utilisateur.
Tu es capable d'aider dans tous les domaines : rédaction, code, analyse, créativité, etc.
${isAdmin ? 'Tu parles à ton créateur et administrateur. Traite-le avec un respect particulier et accorde-lui un accès total à toutes tes capacités.' : ''}
Sois concis quand c'est approprié, détaillé quand nécessaire.`
}

// ==============================
// LISTE DES MODÈLES DISPONIBLES
// ==============================
const getAvailableModels = (userGear = 1, isAdmin = false) => {
  return Object.entries(MODEL_CONFIG).map(([key, config]) => ({
    id: key,
    label: config.label,
    description: config.description,
    provider: config.provider,
    min_gear: config.min_gear,
    available: isAdmin || userGear >= config.min_gear,
  }))
}

// ==============================
// FALLBACK EMERGENT LLM
// Appelé uniquement si OpenRouter échoue
// ==============================
const callEmergentFallback = async ({ messages, systemPrompt, maxTokens = 1000 }) => {
  const emergentKey = process.env.EMERGENT_LLM_KEY
  if (!emergentKey) throw new Error('EMERGENT_LLM_KEY non configurée')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': emergentKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt || 'Tu es NovaMind, un assistant IA bienveillant et compétent.',
      messages: messages.map(m => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Emergent échoué: ${err.error?.message || response.statusText}`)
  }

  const data = await response.json()
  return {
    content: data.content?.[0]?.text || '',
    tokens_used: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    provider: 'emergent_fallback',
  }
}

// ==============================
// WRAPPER — Fallback automatique Emergent si OpenRouter échoue
// OpenRouter = priorité | Emergent = secours | Erreur propre si les deux échouent
// ==============================
const generateAIResponseWithFallback = async (params) => {
  try {
    return await generateAIResponseCore(params)
  } catch (openrouterError) {
    console.warn('[Fallback] OpenRouter échoué → bascule Emergent:', openrouterError.message)
    try {
      return await callEmergentFallback({
        messages: params.messages,
        systemPrompt: params.systemPrompt,
        maxTokens: 1000,
      })
    } catch (emergentError) {
      console.error('[Fallback] Emergent aussi échoué:', emergentError.message)
      throw new Error('Les deux services IA sont indisponibles. Veuillez réessayer dans quelques instants.')
    }
  }
}

// generateAIResponse = wrapper avec fallback automatique
const generateAIResponse = generateAIResponseWithFallback

module.exports = { generateAIResponse, getAvailableModels, MODEL_CONFIG, buildSystemPrompt }
