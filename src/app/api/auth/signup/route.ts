import { NextRequest, NextResponse } from "next/server";
import { createUser, setSessionCookie, AuthError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signup
 * Body: { email, password, name? }
 *
 * Creates a new FREE user and logs them in.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };
  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }
  try {
    const user = await createUser({
      email: body.email,
      password: body.password,
      name: body.name,
    });
    // Auto-login after signup.
    const { login } = await import("@/lib/auth");
    const { token } = await login({
      email: body.email,
      password: body.password,
    });
    await setSessionCookie(token);
    return NextResponse.json({ user });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
