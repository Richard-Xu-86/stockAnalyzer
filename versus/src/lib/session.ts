import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { env } from "./env";

/** The session holds only our user id; the login cookie holds single-use OAuth state for 10 minutes. */
export interface AppSession {
  userId?: string;
}
export interface LoginState {
  state?: string;
  nonce?: string;
  verifier?: string;
}

const base = (name: string, maxAge: number): SessionOptions => ({
  password: env().SESSION_SECRET,
  cookieName: name,
  ttl: maxAge,
  cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
});

export async function appSession() {
  return getIronSession<AppSession>(await cookies(), base("versus_session", 60 * 60 * 24 * 30));
}

export async function loginSession() {
  return getIronSession<LoginState>(await cookies(), base("versus_login", 60 * 10));
}
