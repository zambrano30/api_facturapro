import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { pool, withTransaction } from './db.js'
import {
  adminRequired, authRequired, clearRefreshCookie, companyRequired,
  getPublicUser, getRefreshToken, hashRefreshToken, issueLoginSession,
  trustedOrigin,
} from './security.js'

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters')

const app = express()
const prefix = '/api/v1'
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(helmet())

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean)
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('Origin not allowed'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false })
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false })

const tableColumns = {
  clients: ['id', 'name', 'email', 'phone', 'address', 'city', 'country', 'tax_id', 'is_active', 'metadata', 'created_at', 'updated_at'],
  products: ['id', 'category_id', 'name', 'description', 'sku', 'barcode', 'unit_price', 'purchase_price', 'quantity_on_hand', 'minimum_quantity', 'is_taxable', 'tax_percentage', 'is_active', 'metadata', 'created_at', 'updated_at'],
  invoices: ['id', 'client_id', 'user_id', 'invoice_number', 'status', 'invoice_date', 'due_date', 'subtotal', 'tax_amount', 'discount_amount', 'total_amount', 'payment_method', 'cash_amount', 'transfer_amount', 'notes', 'metadata', 'created_at', 'updated_at'],
  invoice_items: ['id', 'invoice_id', 'product_id', 'quantity', 'unit_price', 'discount_percentage', 'tax_percentage', 'line_total', 'description', 'created_at', 'updated_at'],
  expenses: ['id', 'provider_id', 'created_by', 'category', 'item_name', 'description', 'quantity', 'unit_price', 'amount', 'expense_date', 'notes', 'is_active', 'metadata', 'created_at', 'updated_at'],
  providers: ['id', 'name', 'tax_id', 'email', 'phone', 'address', 'is_active', 'created_at', 'updated_at'],
  inventory_movements: ['id', 'product_id', 'created_by', 'movement_type', 'quantity', 'reference_type', 'reference_id', 'notes', 'created_at'],
  commands: ['id', 'invoice_id', 'invoice_number', 'created_by', 'status', 'items', 'notes', 'created_at', 'updated_at'],
}

const sendError = (response, status, error) => response.status(status).json({ error })
const emailKey = value => String(value || '').trim().toLowerCase()

function cleanFields(table, source, insert = false) {
  const allowed = tableColumns[table]
  if (!allowed) throw Object.assign(new Error('Tabla no disponible'), { status: 404 })
  const fields = Object.fromEntries(Object.entries(source || {}).filter(([key]) => (
    allowed.includes(key) && !['id', 'company_id', 'created_at'].includes(key) && (insert || key !== 'updated_at')
  )))
  if (!Object.keys(fields).length) throw Object.assign(new Error('No hay campos válidos para guardar'), { status: 400 })
  return fields
}

function buildTenantWhere(table, companyId, filters = []) {
  const clauses = ['company_id = ?']
  const values = [companyId]
  for (const filter of filters) {
    if (!tableColumns[table]?.includes(filter.field)) throw Object.assign(new Error('Filtro no permitido'), { status: 400 })
    if (filter.field === 'company_id') continue
    const column = `\`${filter.field}\``
    if ((filter.operator === 'eq' || filter.operator === 'is') && filter.value == null) clauses.push(`${column} IS NULL`)
    else if (filter.operator === 'lte' && filter.value?.column) {
      if (!tableColumns[table].includes(filter.value.column)) throw Object.assign(new Error('Columna comparativa no permitida'), { status: 400 })
      clauses.push(`${column} <= \`${filter.value.column}\``)
    } else {
      const operator = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' }[filter.operator]
      if (!operator) throw Object.assign(new Error('Operador no permitido'), { status: 400 })
      clauses.push(`${column} ${operator} ?`)
      values.push(filter.value)
    }
  }
  return { sql: clauses.join(' AND '), values }
}

async function expandInvoices(companyId, invoices) {
  return Promise.all(invoices.map(async invoice => {
    const [clients] = invoice.client_id
      ? await pool.execute('SELECT * FROM clients WHERE company_id = ? AND id = ? LIMIT 1', [companyId, invoice.client_id])
      : [[]]
    const [items] = await pool.execute(
      `SELECT ii.*, p.id AS p_id, p.name AS p_name, p.sku AS p_sku, p.barcode AS p_barcode,
              p.unit_price AS p_unit_price, p.quantity_on_hand AS p_quantity_on_hand
       FROM invoice_items ii LEFT JOIN products p ON p.company_id = ii.company_id AND p.id = ii.product_id
       WHERE ii.company_id = ? AND ii.invoice_id = ? ORDER BY ii.id`,
      [companyId, invoice.id],
    )
    return {
      ...invoice,
      clients: clients[0] || null,
      invoice_items: items.map(item => {
        const products = item.p_id == null ? null : {
          id: item.p_id, name: item.p_name, sku: item.p_sku,
          barcode: item.p_barcode, unit_price: item.p_unit_price,
          quantity_on_hand: item.p_quantity_on_hand,
        }
        const { p_id, p_name, p_sku, p_barcode, p_unit_price, p_quantity_on_hand, ...invoiceItem } = item
        return { ...invoiceItem, products }
      }),
    }
  }))
}

async function selectRows(request, table) {
  const filters = JSON.parse(request.query.filters || '[]')
  if (!Array.isArray(filters)) throw Object.assign(new Error('Filtros inválidos'), { status: 400 })
  const where = buildTenantWhere(table, request.companyId, filters)
  const order = JSON.parse(request.query.orders || '[]').map(item => {
    if (!tableColumns[table].includes(item.field)) throw Object.assign(new Error('Orden no permitido'), { status: 400 })
    return `\`${item.field}\` ${item.ascending ? 'ASC' : 'DESC'}`
  }).join(', ')
  const limit = Math.min(Math.max(Number(request.query.limit || 500), 1), 1000)
  const offset = Math.max(Number(request.query.offset || 0), 0)
  const [rows] = await pool.execute(
    `SELECT * FROM \`${table}\` WHERE ${where.sql}${order ? ` ORDER BY ${order}` : ''} LIMIT ? OFFSET ?`,
    [...where.values, limit, offset],
  )
  return table === 'invoices' ? expandInvoices(request.companyId, rows) : rows
}

async function insertRows(request, table) {
  const rows = Array.isArray(request.body) ? request.body : [request.body]
  if (!rows.length || rows.length > 500) throw Object.assign(new Error('Cantidad de filas inválida'), { status: 400 })
  return withTransaction(async connection => {
    const savedRows = []
    for (const row of rows) {
      const fields = cleanFields(table, row, true)
      fields.company_id = request.companyId
      if (tableColumns[table].includes('created_by')) fields.created_by = request.userId
      if (table === 'invoices') {
        fields.user_id = request.userId
        fields.invoice_number ||= `FP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
        fields.status ||= 'draft'
      }
      const keys = Object.keys(fields)
      const [result] = await connection.execute(
        `INSERT INTO \`${table}\` (${keys.map(key => `\`${key}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        keys.map(key => fields[key]),
      )
      const [records] = await connection.execute(`SELECT * FROM \`${table}\` WHERE company_id = ? AND id = ? LIMIT 1`, [request.companyId, result.insertId])
      if (records[0]) savedRows.push(records[0])
    }
    return savedRows
  })
}

app.get(`${prefix}/health`, async (_request, response) => {
  try { await pool.query('SELECT 1'); return response.json({ status: 'ok', database: 'ok' }) }
  catch { return response.status(503).json({ status: 'error', database: 'unavailable' }) }
})

app.post(`${prefix}/auth/register`, authLimiter, trustedOrigin, async (request, response, next) => {
  try {
    const email = emailKey(request.body.email)
    const password = String(request.body.password || '')
    if (!email.includes('@') || password.length < 10) return sendError(response, 400, 'Correo inválido o contraseña demasiado corta (mínimo 10 caracteres)')
    const id = crypto.randomUUID()
    const fullName = String(request.body.full_name || email.split('@')[0]).trim().slice(0, 160)
    const passwordHash = await bcrypt.hash(password, 12)
    await pool.execute('INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)', [id, email, fullName, passwordHash])
    const result = await withTransaction(connection => issueLoginSession(connection, response, id))
    return response.status(201).json({ user: result.user, access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return sendError(response, 409, 'Ya existe una cuenta con ese correo')
    return next(error)
  }
})

app.post(`${prefix}/auth/login`, loginLimiter, trustedOrigin, async (request, response, next) => {
  try {
    const [users] = await pool.execute('SELECT id, password_hash, is_active FROM users WHERE email_normalized = ? LIMIT 1', [emailKey(request.body.email)])
    const user = users[0]
    if (!user || !user.is_active || !user.password_hash || !(await bcrypt.compare(String(request.body.password || ''), user.password_hash))) return sendError(response, 401, 'Correo o contraseña incorrectos')
    const result = await withTransaction(connection => issueLoginSession(connection, response, user.id))
    return response.json({ user: result.user, access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn })
  } catch (error) { return next(error) }
})

app.post(`${prefix}/auth/refresh`, trustedOrigin, async (request, response, next) => {
  const token = getRefreshToken(request)
  if (!token) return sendError(response, 401, 'No hay una sesión renovable')
  try {
    const result = await withTransaction(async connection => {
      const [sessions] = await connection.execute(
        `SELECT s.id, s.user_id FROM api_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW(3) AND u.is_active = TRUE
         LIMIT 1 FOR UPDATE`, [hashRefreshToken(token)],
      )
      if (!sessions.length) return null
      await connection.execute('UPDATE api_sessions SET revoked_at = NOW(3) WHERE id = ?', [sessions[0].id])
      return issueLoginSession(connection, response, sessions[0].user_id)
    })
    if (!result) { clearRefreshCookie(response); return sendError(response, 401, 'Sesión expirada') }
    return response.json({ user: result.user, access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn })
  } catch (error) { return next(error) }
})

app.post(`${prefix}/auth/logout`, trustedOrigin, async (request, response, next) => {
  try {
    const token = getRefreshToken(request)
    if (token) await pool.execute('UPDATE api_sessions SET revoked_at = NOW(3) WHERE refresh_token_hash = ? AND revoked_at IS NULL', [hashRefreshToken(token)])
    clearRefreshCookie(response)
    return response.json({ ok: true })
  } catch (error) { return next(error) }
})

app.get(`${prefix}/auth/me`, authRequired, async (request, response, next) => {
  try {
    const user = await getPublicUser(request.userId, request.headers['x-company-id'] || null)
    if (!user?.is_active) return sendError(response, 401, 'Cuenta desactivada')
    return response.json({ user })
  } catch (error) { return next(error) }
})

app.get(`${prefix}/companies`, authRequired, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id, c.name, c.legal_name, c.tax_id, m.membership_role AS role, m.created_at
       FROM company_memberships m JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = ? AND m.status = 'active' AND c.status = 'active' ORDER BY m.created_at ASC`, [request.userId],
    )
    return response.json({ data: rows })
  } catch (error) { return next(error) }
})

app.post(`${prefix}/companies`, authRequired, trustedOrigin, async (request, response, next) => {
  try {
    const name = String(request.body.name || '').trim()
    if (name.length < 2 || name.length > 160) return sendError(response, 400, 'El nombre debe tener entre 2 y 160 caracteres')
    const id = crypto.randomUUID()
    await withTransaction(async connection => {
      await connection.execute('INSERT INTO companies (id, name, legal_name, tax_id, created_by) VALUES (?, ?, ?, ?, ?)', [id, name, request.body.legalName || null, request.body.taxId || null, request.userId])
      await connection.execute("INSERT INTO company_memberships (company_id, user_id, membership_role, status) VALUES (?, ?, 'Owner', 'active')", [id, request.userId])
    })
    return response.status(201).json({ data: id })
  } catch (error) { return next(error) }
})

app.post(`${prefix}/companies/:companyId/members`, authRequired, companyRequired, adminRequired, trustedOrigin, async (request, response, next) => {
  try {
    if (request.params.companyId !== request.companyId) return sendError(response, 403, 'Empresa inválida')
    const role = request.body.membershipRole || request.body.role || 'Vendedor'
    if (!['Administrador', 'Vendedor', 'Contador', 'Gerente', 'Cocinero'].includes(role)) return sendError(response, 400, 'Rol no válido')
    const member = await withTransaction(async connection => {
      let userId = request.body.userId || null
      if (!userId) {
        const email = emailKey(request.body.email)
        const password = String(request.body.password || '')
        if (!email.includes('@') || password.length < 10) throw Object.assign(new Error('Correo inválido o contraseña demasiado corta (mínimo 10 caracteres)'), { status: 400 })
        const [existing] = await connection.execute('SELECT id FROM users WHERE email_normalized = ? LIMIT 1', [email])
        if (existing.length) throw Object.assign(new Error('Ya existe una cuenta con ese correo'), { status: 409 })
        userId = crypto.randomUUID()
        const hash = await bcrypt.hash(password, 12)
        await connection.execute('INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)', [userId, email, String(request.body.name || email.split('@')[0]).trim(), hash])
      }
      await connection.execute(
        `INSERT INTO company_memberships (company_id, user_id, membership_role, status, invited_by)
         VALUES (?, ?, ?, 'active', ?) ON DUPLICATE KEY UPDATE membership_role = VALUES(membership_role), status = 'active'`,
        [request.companyId, userId, role, request.userId],
      )
      return getPublicUser(userId, request.companyId)
    })
    return response.status(201).json({ data: member })
  } catch (error) { return next(error) }
})

app.get(`${prefix}/users`, authRequired, companyRequired, adminRequired, async (request, response, next) => {
  try {
    const requestedRole = String(request.query.role || '').toLowerCase()
    const roles = { cocinero: 'Cocinero', cooker: 'Cocinero', vendedor: 'Vendedor', saler: 'Vendedor' }
    const role = roles[requestedRole] || requestedRole || null
    const params = [request.companyId]
    const condition = role ? ' AND m.membership_role = ?' : ''
    if (role) params.push(role)
    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.full_name, u.avatar_url, u.is_active, u.created_at, m.membership_role AS role
       FROM company_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.company_id = ? AND m.status = 'active'${condition} ORDER BY u.created_at DESC`, params,
    )
    return response.json({ data: rows })
  } catch (error) { return next(error) }
})

app.get(`${prefix}/data/:table`, authRequired, companyRequired, async (request, response, next) => {
  try {
    const table = request.params.table
    if (!tableColumns[table]) return sendError(response, 404, 'Tabla no disponible')
    return response.json({ data: await selectRows(request, table) })
  } catch (error) { return next(error) }
})

app.post(`${prefix}/data/:table`, authRequired, companyRequired, async (request, response, next) => {
  try {
    const table = request.params.table
    if (!tableColumns[table]) return sendError(response, 404, 'Tabla no disponible')
    return response.status(201).json({ data: await insertRows(request, table) })
  } catch (error) { return next(error) }
})

app.patch(`${prefix}/data/:table/:id`, authRequired, companyRequired, async (request, response, next) => {
  try {
    const table = request.params.table
    if (!tableColumns[table]) return sendError(response, 404, 'Tabla no disponible')
    const fields = cleanFields(table, request.body)
    const keys = Object.keys(fields)
    await pool.execute(`UPDATE \`${table}\` SET ${keys.map(key => `\`${key}\` = ?`).join(', ')} WHERE company_id = ? AND id = ?`, [...keys.map(key => fields[key]), request.companyId, request.params.id])
    const [rows] = await pool.execute(`SELECT * FROM \`${table}\` WHERE company_id = ? AND id = ? LIMIT 1`, [request.companyId, request.params.id])
    if (!rows.length) return sendError(response, 404, 'Registro no encontrado')
    return response.json({ data: rows })
  } catch (error) { return next(error) }
})

app.delete(`${prefix}/data/:table/:id`, authRequired, companyRequired, async (request, response, next) => {
  try {
    const table = request.params.table
    if (!tableColumns[table]) return sendError(response, 404, 'Tabla no disponible')
    await pool.execute(`DELETE FROM \`${table}\` WHERE company_id = ? AND id = ?`, [request.companyId, request.params.id])
    return response.json({ data: null })
  } catch (error) { return next(error) }
})

app.use((error, _request, response, _next) => {
  if (error.code === 'ER_DUP_ENTRY') return sendError(response, 409, 'El registro ya existe')
  if (error.code === 'ER_NO_REFERENCED_ROW_2') return sendError(response, 400, 'La referencia no existe en esta empresa')
  const status = error.status || 500
  if (status >= 500) console.error(error)
  return sendError(response, status, status >= 500 ? 'Error interno del servidor' : error.message)
})

const port = Number(process.env.PORT || 3001)
app.listen(port, '0.0.0.0', () => console.log(`FacturaPro API listening on port ${port}`))
