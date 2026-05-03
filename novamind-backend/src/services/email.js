let resend = null

const getResend = () => {
  if (!resend) {
    const { Resend } = require('resend')
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY manquante — emails désactivés')
      return null
    }
    resend = new Resend(process.env.RESEND_API_KEY)
  }
  return resend
}

const FROM = process.env.EMAIL_FROM || 'NovaMind <noreply@novamind.ai>'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://novamind.ai'

const GEAR_TITLES = {
  1: { name: 'Gear 1 — Free', title: 'Sea Rookie', color: '#6b6b8a' },
  2: { name: 'Gear 2 — Plus', title: 'Rookie Pirate', color: '#10b981' },
  3: { name: 'Gear 3 — Pro', title: 'New World Explorer', color: '#6366f1' },
  4: { name: 'Gear 4 — Ultra', title: 'Haki Awakened', color: '#f59e0b' },
  5: { name: 'Gear 5 — Infinite', title: 'Legendary Awakening', color: '#7c6af7' },
}

const sendEmail = async ({ to, subject, html }) => {
  try {
    const client = getResend()
    if (!client) return null
    const res = await client.emails.send({ from: FROM, to, subject, html })
    console.log('Email envoyé à', to)
    return res
  } catch (err) {
    console.error('Email échoué:', err.message)
    return null
  }
}

const sendWelcomeEmail = ({ to, username, verifyUrl }) =>
  sendEmail({
    to,
    subject: 'Bienvenue sur NovaMind',
    html: `<h1>Bienvenue ${username} !</h1><p><a href="${verifyUrl}">Confirmer mon email</a></p>`,
  })

const sendResetPasswordEmail = ({ to, username, resetUrl }) =>
  sendEmail({
    to,
    subject: 'Réinitialisation de votre mot de passe NovaMind',
    html: `<h1>Bonjour ${username}</h1><p><a href="${resetUrl}">Réinitialiser mon mot de passe</a></p>`,
  })

const sendPasswordChangedEmail = ({ to, username }) =>
  sendEmail({
    to,
    subject: 'Votre mot de passe a été modifié',
    html: `<h1>Bonjour ${username}</h1><p>Votre mot de passe a été modifié avec succès.</p>`,
  })

const sendPaymentSuccessEmail = ({ to, username, gear, amount, billingPeriod }) => {
  const g = GEAR_TITLES[gear] || GEAR_TITLES[1]
  return sendEmail({
    to,
    subject: `Paiement confirmé — ${g.name}`,
    html: `<h1>Bonjour ${username}</h1><p>Votre accès ${g.name} est activé !</p>`,
  })
}

const sendSubscriptionChangedEmail = ({ to, username, oldGear, newGear }) => {
  const g = GEAR_TITLES[newGear] || GEAR_TITLES[1]
  return sendEmail({
    to,
    subject: 'Abonnement modifié',
    html: `<h1>Bonjour ${username}</h1><p>Votre abonnement a été mis à jour : ${g.name}</p>`,
  })
}

const sendSubscriptionCancelledEmail = ({ to, username, endDate }) =>
  sendEmail({
    to,
    subject: 'Abonnement annulé',
    html: `<h1>Bonjour ${username}</h1><p>Votre abonnement a été annulé. Accès jusqu'au ${endDate}.</p>`,
  })

const sendSuspiciousLoginEmail = ({ to, username, ip, device, time }) =>
  sendEmail({
    to,
    subject: 'Connexion détectée',
    html: `<h1>Bonjour ${username}</h1><p>Nouvelle connexion depuis ${ip} — ${device}</p>`,
  })

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendResetPasswordEmail,
  sendPasswordChangedEmail,
  sendPaymentSuccessEmail,
  sendSubscriptionChangedEmail,
  sendSubscriptionCancelledEmail,
  sendSuspiciousLoginEmail,
}
