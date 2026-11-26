function getDatabaseTransport(connectionString, configured = process.env.PG_TRANSPORT || 'auto') {
  const hostname = new URL(connectionString).hostname.toLowerCase();
  const isNeon = hostname.endsWith('.neon.tech');
  if (!['auto', 'tcp', 'websocket'].includes(configured)) throw new Error('PG_TRANSPORT must be auto, tcp or websocket');
  if (configured === 'websocket' && !isNeon) throw new Error('WebSocket database transport requires a Neon hostname');
  return configured === 'tcp' || !isNeon ? 'tcp' : 'websocket';
}

function createDatabasePool(connectionString, options = {}) {
  if (getDatabaseTransport(connectionString) === 'websocket') {
    const { Pool, neonConfig } = require('@neondatabase/serverless');
    neonConfig.webSocketConstructor = require('ws');
    // Neon encrypts the PostgreSQL session through its TLS WebSocket endpoint.
    const websocketOptions = { ...options };
    delete websocketOptions.ssl;
    return new Pool({ ...websocketOptions, connectionString });
  }
  const { Pool } = require('pg');
  return new Pool({ ...options, connectionString });
}

module.exports = { createDatabasePool, getDatabaseTransport };
