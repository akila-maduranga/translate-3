import { NextRequest, NextResponse } from "next/server";
import {
  login,
  setSessionCookie,
  AuthError,
  seedAdminFromEnv,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 * Body: { email, password }
 *
 * Verifies credentials and sets a signed session cookie.
 *
 * Includes a lazy admin-seeding fallback: if the login fails because
 * the user doesn't exist AND the email matches ADMIN_EMAIL, we try
 * to seed the admin from env vars and retry. This handles the case
 * where instrumentation.ts didn't run on the serverless platform.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const tryLogin = async () => {
    const { token, user } = await login({
      email: body.email!,
      password: body.password!,
    });
    await setSessionCookie(token);
    return user;
  };

  try {
    const user = await tryLogin();
    return NextResponse.json({ user });
  } catch (err: any) {
    // If login failed because the user doesn't exist, AND the email
    // matches ADMIN_EMAIL, try to seed the admin and retry.
    const email = body.email!.trim().toLowerCase();
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const isLikelyAdmin =
      adminEmail &&
      email === adminEmail &&
      err.message.includes("Invalid email or password");

    if (isLikelyAdmin) {
      try {
        await seedAdminFromEnv();
        const user = await tryLogin();
        return NextResponse.json({ user });
      } catch (retryErr: any) {
        return NextResponse.json(
          { error: retryErr.message },
          { status: 400 }
        );
      }
    }

    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
