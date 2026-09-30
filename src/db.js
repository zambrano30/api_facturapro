import mysql from 'mysql2/promise'

function parseDatabaseUrl(value) {
  if (!value) throw new Error('DATABASE_URL is required')

  const url = new URL(value)
  if (!['mysql:', 'mariadb:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use mysql:// or mariadb://')
  }

  const sslCa = process.env.DB_SSL_CA?.replaceAll('\\n', '\n')
  const useSsl = process.env.DB_SSL === 'true' || Boolean(sslCa)

  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    decimalNumbers: true,
    timezone: 'Z',
    ...(useSsl ? { ssl: sslCa ? { ca: sslCa } : {} } : {}),
  }
}

export const pool = mysql.createPool(parseDatabaseUrl(process.env.DATABASE_URL))

export async function withTransaction(callback) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const result = await callback(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}
