const axios = require('axios')

// ==============================
// RECHERCHE WEB TEMPS RÉEL
// Via Brave Search API ou Tavily
// ==============================

const searchWeb = async (query, maxResults = 5) => {
  // Essaie Tavily d'abord (meilleur pour l'IA)
  if (process.env.TAVILY_API_KEY) {
    return await searchTavily(query, maxResults)
  }
  // Fallback Brave Search
  if (process.env.BRAVE_API_KEY) {
    return await searchBrave(query, maxResults)
  }
  throw new Error('Aucune clé API de recherche configurée (TAVILY_API_KEY ou BRAVE_API_KEY)')
}

// ==============================
// TAVILY SEARCH (recommandé)
// https://tavily.com — gratuit 1000 req/mois
// ==============================
const searchTavily = async (query, maxResults = 5) => {
  const response = await axios.post('https://api.tavily.com/search', {
    api_key: process.env.TAVILY_API_KEY,
    query,
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: true,
    include_raw_content: false,
  })

  const data = response.data
  return {
    query,
    answer: data.answer || null,
    results: (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 300) || '',
      published_date: r.published_date || null,
    })),
    provider: 'tavily',
  }
}

// ==============================
// BRAVE SEARCH (alternative)
// https://brave.com/search/api/
// ==============================
const searchBrave = async (query, maxResults = 5) => {
  const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    params: { q: query, count: maxResults, search_lang: 'fr' },
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': process.env.BRAVE_API_KEY,
    },
  })

  const results = response.data?.web?.results || []
  return {
    query,
    answer: null,
    results: results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description?.slice(0, 300) || '',
      published_date: r.age || null,
    })),
    provider: 'brave',
  }
}

// ==============================
// FORMATE LES RÉSULTATS POUR L'IA
// ==============================
const formatResultsForAI = (searchData) => {
  const { query, answer, results } = searchData
  let context = `Résultats de recherche web pour : "${query}"\n\n`

  if (answer) {
    context += `Réponse directe : ${answer}\n\n`
  }

  context += results.map((r, i) =>
    `[${i + 1}] ${r.title}\nSource : ${r.url}\n${r.snippet}${r.published_date ? `\nDate : ${r.published_date}` : ''}`
  ).join('\n\n')

  return context
}

module.exports = { searchWeb, formatResultsForAI }
