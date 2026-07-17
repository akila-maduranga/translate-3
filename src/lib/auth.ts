/**
 * Auth library — credentials-based login with bcrypt-hashed passwords
 * and signed session cookies.
 *
 * Session cookie format:
 *   { userId, role, exp }  (signed with AUTH_SECRET)
 *
 * Cookie name: "subsinhala-session"
 * Lifetime: 7 days
 * HttpOnly, Secure (in prod), SameSite=Lax
 */

import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { cookies } from "next/headers";

const SESSION_COOKIE = "subsinhala-session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds
const BCRYPT_ROUNDS = 10;

export type Role = "FREE" | "PREMIUM" | "ADMIN";

export interface SessionPayload {
  userId: string;
  email: string;
  role: Role;
  /// Unix timestamp (seconds) when the session expires.
  exp: number;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
}

function toSafeUser(u: {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
}): SafeUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt };
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Fall back to a deterministic dev secret so local dev works
    // without configuration. NEVER use this in production.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET env var is required in production. Generate one with: openssl rand -hex 32"
      );
    }
    return "dev-secret-not-for-production-use";
  }
  return secret;
}

/**
 * Sign a session payload using HMAC-SHA256. Returns
 * `base64(payload).signature`. We don't use JWTs to keep dependencies
 * minimal — this is a simple homebrew signed cookie.
 */
async function signSession(payload: SessionPayload): Promise<string> {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  const sigB64 = Buffer.from(sig).toString("base64url");
  return `${body}.${sigB64}`;
}

async function verifySession(token: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigBytes = Buffer.from(sig, "base64url");
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(body)
  );
  if (!ok) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf-8")
    ) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Hash a password for storage. */
export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}

/** Verify a password against its stored hash. */
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** Create a new user account. Throws on duplicate email. */
export async function createUser(params: {
  email: string;
  password: string;
  name?: string;
}): Promise<SafeUser> {
  const email = params.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }
  if (params.password.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("An account with this email already exists.");
  }
  const passwordHash = await hashPassword(params.password);
  const user = await db.user.create({
    data: {
      email,
      name: params.name?.trim() || null,
      passwordHash,
      role: "FREE",
    },
  });
  return toSafeUser(user);
}

/** Verify credentials and return a signed session token. */
export async function login(params: {
  email: string;
  password: string;
}): Promise<{ token: string; user: SafeUser }> {
  const email = params.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error("Invalid email or password.");
  }
  const ok = await verifyPassword(params.password, user.passwordHash);
  if (!ok) {
    throw new Error("Invalid email or password.");
  }
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  };
  const token = await signSession(payload);
  return { token, user: toSafeUser(user) };
}

/** Set the session cookie on the response. Call from a Server Action or Route Handler. */
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

/** Clear the session cookie (logout). */
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** Read the current session from the cookie. Returns null if not logged in. */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Get the current user (or null). Joins session.userId → User row. */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await getSession();
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });
  if (!user) return null;
  return toSafeUser(user);
}

/**
 * Ensure the user is logged in. Throws if not.
 * Use in Server Actions / Route Handlers to guard endpoints.
 */
export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("You must be logged in to do this.", 401);
  }
  return user;
}

/** Ensure the user is an admin. Throws if not. */
export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new AuthError("Admin access required.", 403);
  }
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}

/**
 * Seed the initial admin user from env vars. Idempotent — only
 * creates the admin if no admin exists yet. Called on app startup
 * (or first request) to bootstrap the admin account.
 *
 * Env vars:
 *   ADMIN_EMAIL     — required
 *   ADMIN_PASSWORD  — required
 *   ADMIN_NAME      — optional display name
 */
export async function seedAdminFromEnv(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return; // not configured — skip silently

  // Check if any admin already exists with this email.
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    // Already exists — update role to ADMIN if needed.
    if (existing.role !== "ADMIN") {
      await db.user.update({
        where: { id: existing.id },
        data: {
          role: "ADMIN",
          // Also refresh the password in case the env var changed.
          passwordHash: await hashPassword(password),
          name: process.env.ADMIN_NAME?.trim() || existing.name,
        },
      });
      console.log(`[auth] Promoted ${email} to ADMIN.`);
    }
    return;
  }

  // Create new admin.
  await db.user.create({
    data: {
      email,
      name: process.env.ADMIN_NAME?.trim() || "Admin",
      passwordHash: await hashPassword(password),
      role: "ADMIN",
    },
  });
  console.log(`[auth] Seeded initial admin: ${email}`);
}
