import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { pool } from './db.js'

const ACCESS_TTL = '15m'
const REFRESH_DAYS = 30
const REFRESH_COOKIE = 'facturapro_refresh'

export function createAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL })
}

export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function cookieOptions() {
  const production = process.env.NODE_ENV === 'production'
  const sameSite = process.env.COOKIE_SAME_SITE || (production ? 'none' : 'lax')
  const secure = process.env.COOKIE_SECURE === 'true' || production
  const maxAge = REFRESH_DAYS * 24 * 60 * 60
  return { httpOnly: true, secure, sameSite, path: '/api/v1/auth', maxAge }
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `Max-Age=${options.maxAge}`, 'HttpOnly']
  if (options.secure) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`)
  return parts.join('; ')
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || ''
  const entry = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null
}

export function setRefreshCookie(response, token) {
  response.append('Set-Cookie', serializeCookie(REFRESH_COOKIE, token, cookieOptions()))
}

export function clearRefreshCookie(response) {
  const options = cookieOptions()
  response.append('Set-Cookie', serializeCookie(REFRESH_COOKIE, '', { ...options, maxAge: 0 }))
}

export function getRefreshToken(request) {
  return readCookie(request, REFRESH_COOKIE)
}

export async function createSession(connection, userId) {
  const refreshToken = crypto.randomBytes(48).toString('base64url')
  const sessionId = crypto.randomUUID()
  const refreshExpiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000)

  await connection.execute(
    `INSERT INTO api_sessions (id, user_id, refresh_token_hash, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      userId,
      hashRefreshToken(refreshToken),
      refreshExpiresAt,
      '',
      null,
    ],
  )

  return { refreshToken, accessToken: createAccessToken(userId), sessionId }
}

export function authRequired(request, response, next) {
  const authorization = request.headers.authorization || ''
  const [scheme, token] = authorization.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return response.status(401).json({ error: 'Autenticación requerida' })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    request.userId = payload.sub
    return next()
  } catch {
    return response.status(401).json({ error: 'Sesión expirada o inválida' })
  }
}

export async function companyRequired(request, response, next) {
  const companyId = request.headers['x-company-id']
  if (!companyId) return response.status(400).json({ error: 'Falta el encabezado X-Company-ID' })

  try {
    const [memberships] = await pool.execute(
      `SELECT membership_role, status
       FROM company_memberships
       WHERE company_id = ? AND user_id = ? LIMIT 1`,
      [companyId, request.userId],
    )

    if (!memberships.length || memberships[0].status !== 'active') {
      return response.status(403).json({ error: 'No tienes acceso a esta empresa' })
    }

    request.companyId = companyId
    request.membershipRole = memberships[0].membership_role
    return next()
  } catch (error) {
    return next(error)
  }
}

export function adminRequired(request, response, next) {
  if (!['Owner', 'Administrador'].includes(request.membershipRole)) {
    return response.status(403).json({ error: 'Se requiere rol administrador' })
  }
  return next()
}

export function trustedOrigin(request, response, next) {
  const origin = request.headers.origin
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  if (origin && !allowedOrigins.includes(origin)) {
    return response.status(403).json({ error: 'Origen no permitido' })
  }
  return next()
}

export async function getPublicUser(userId, companyId = null) {
  const [users] = await pool.execute(
    `SELECT id, email, full_name, avatar_url, is_active, created_at, legacy_role
     FROM users WHERE id = ? LIMIT 1`,
    [userId],
  )
  if (!users.length) return null

  const user = users[0]
  let membership = null
  if (companyId) {
    const [rows] = await pool.execute(
      `SELECT membership_role, status FROM company_memberships
       WHERE company_id = ? AND user_id = ? LIMIT 1`,
      [companyId, userId],
    )
    membership = rows[0] || null
  }

  const role = membership?.membership_role || user.legacy_role || 'Administrador'
  const { legacy_role, ...publicUser } = user
  return { ...publicUser, role }
}

export async function issueLoginSession(connection, response, userId) {
  const session = await createSession(connection, userId)
  setRefreshCookie(response, session.refreshToken)
  const companyId = response.req.headers['x-company-id'] || null
  const user = await getPublicUser(userId, companyId)
  return {
    user,
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: 900,
  }
}
