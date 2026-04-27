import { apiUrl } from "../lib/base-url.js";

export async function createPasswordSession(token: string, password: string): Promise<void> {
  const res = await fetch(apiUrl("api/auth/session"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, password })
  });
  if (!res.ok) throw new Error("Invalid password");
}

export async function hasPasswordSession(token: string): Promise<boolean> {
  const res = await fetch(apiUrl("api/auth/session/check"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token })
  });
  return res.ok;
}
