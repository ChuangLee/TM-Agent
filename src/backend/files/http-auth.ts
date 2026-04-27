import type { RequestHandler } from "express";
import type { AuthService } from "../auth/auth-service.js";

const TOKEN_HEADER = "x-tm-agent-token";
const PASSWORD_HEADER = "x-tm-agent-password";

const headerValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const readCookie = (cookieHeader: string | undefined, name: string): string | undefined => {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
};

/**
 * HTTP middleware that mirrors the control-WS auth contract: token via
 * `x-tm-agent-token` (header or `?token=` query), password via
 * `x-tm-agent-password` (header or `?password=`). Query-string fallbacks
 * exist because `<img src>` / `<iframe src>` / `<video src>` can't set
 * custom headers — file viewer needs them.
 */
export const buildHttpAuthMiddleware = (authService: AuthService): RequestHandler => {
  return (req, res, next) => {
    const token = headerValue(req.headers[TOKEN_HEADER]) ?? String(req.query.token ?? "");
    const password = headerValue(req.headers[PASSWORD_HEADER]) ?? String(req.query.password ?? "");
    const session = readCookie(req.headers.cookie, "tm_agent_session");
    const result = authService.verify({
      token: token || undefined,
      password: password || undefined,
      session
    });
    if (!result.ok) {
      res.status(401).json({ error: result.reason ?? "unauthorized" });
      return;
    }
    next();
  };
};
