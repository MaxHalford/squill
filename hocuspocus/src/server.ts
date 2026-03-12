import { Server } from "@hocuspocus/server";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? "1234", 10);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET) throw new Error("JWT_SECRET env var is required");
if (!DATABASE_URL) throw new Error("DATABASE_URL env var is required");

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: DATABASE_URL });

/**
 * Ensure the target database exists, creating it if needed.
 * The FastAPI backend owns the schema and runs alembic migrations on startup.
 * Connects to the "postgres" maintenance database to run CREATE DATABASE.
 */
async function ensureDatabase(): Promise<void> {
  // Parse the target DB name from the URL (last path segment)
  const dbName = new URL(DATABASE_URL!).pathname.replace(/^\//, "");
  if (!dbName) return; // no database specified in URL

  // Connect to the maintenance database to check / create
  const adminUrl = DATABASE_URL!.replace(/\/[^/]*$/, "/postgres");
  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    const { rows } = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (!rows.length) {
      // identifiers cannot be parameterised — dbName comes from our own config
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Hocuspocus: created database "${dbName}"`);
    }
  } finally {
    await adminPool.end();
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JwtPayload {
  user_id: string;
  email: string;
  exp: number;
}

interface ConnectionContext {
  userId?: string;
  permission: "read" | "write";
  canvasId: string;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function parseCanvasId(documentName: string): string | null {
  const match = documentName.match(/^canvas:(.+)$/);
  return match ? match[1] : null;
}

function tryDecodeJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as JwtPayload;
  } catch {
    return null;
  }
}

async function checkProOwnership(
  userId: string,
  canvasId: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1
     FROM canvases c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = $1 AND c.user_id = $2
       AND (u.plan = 'pro' OR u.is_vip = true)
     LIMIT 1`,
    [canvasId, userId]
  );
  return rows.length > 0;
}

async function lookupShareToken(
  token: string
): Promise<{ canvasId: string; permission: "read" | "write" } | null> {
  const { rows } = await pool.query(
    `SELECT canvas_id, permission, expires_at
     FROM canvas_shares
     WHERE share_token = $1
     LIMIT 1`,
    [token]
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return { canvasId: row.canvas_id, permission: row.permission };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Server.configure({
  port: PORT,

  async onAuthenticate({ token, documentName, connection }) {
    const canvasId = parseCanvasId(documentName);
    if (!canvasId) throw new Error("Invalid document name");

    const jwtPayload = tryDecodeJwt(token);
    if (jwtPayload) {
      if (!(await checkProOwnership(jwtPayload.user_id, canvasId))) {
        throw new Error("Canvas not found or user does not have Pro access");
      }
      connection.readOnly = false;
      return { userId: jwtPayload.user_id, permission: "write", canvasId } satisfies ConnectionContext;
    }

    const share = await lookupShareToken(token);
    if (!share) throw new Error("Invalid or expired token");
    if (share.canvasId !== canvasId) throw new Error("Token does not match this canvas");

    connection.readOnly = share.permission === "read";
    return { permission: share.permission, canvasId } satisfies ConnectionContext;
  },

  async onLoadDocument({ documentName, document }) {
    const canvasId = parseCanvasId(documentName);
    if (!canvasId) return;

    const { rows } = await pool.query(
      "SELECT yjs_state FROM canvases WHERE id = $1 LIMIT 1",
      [canvasId]
    );
    if (rows[0]?.yjs_state) {
      Y.applyUpdate(document, rows[0].yjs_state as Buffer);
    }
  },

  async onStoreDocument({ documentName, document }) {
    const canvasId = parseCanvasId(documentName);
    if (!canvasId) return;

    const state = Buffer.from(Y.encodeStateAsUpdate(document));
    await pool.query(
      "UPDATE canvases SET yjs_state = $1, updated_at = NOW() WHERE id = $2",
      [state, canvasId]
    );
  },
});

ensureDatabase()
  .then(() => server.listen())
  .then(() => console.log(`Hocuspocus listening on port ${PORT}`))
  .catch((err) => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
