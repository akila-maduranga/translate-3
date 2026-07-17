/**
 * Next.js instrumentation — runs once on server startup.
 * Used to seed the initial admin user from env vars.
 *
 * Env vars:
 *   ADMIN_EMAIL     — required to seed admin
 *   ADMIN_PASSWORD  — required to seed admin
 *   ADMIN_NAME      — optional display name
 */

export async function register() {
  // Only run on the server (not during build/edge).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { seedAdminFromEnv } = await import("./lib/auth");
    try {
      await seedAdminFromEnv();
    } catch (err) {
      console.error("[instrumentation] Failed to seed admin:", err);
    }
  }
}
