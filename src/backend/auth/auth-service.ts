import { timingSafeEqual } from "node:crypto";
import { randomToken } from "../util/random.js";

export interface AuthPayload {
  token?: string;
  password?: string;
  session?: string;
}

export class AuthService {
  public static readonly sessionCookieName = "tm_agent_session";
  private static readonly sessionTtlMs = 30 * 24 * 60 * 60 * 1000;

  public readonly token: string;
  private readonly password?: string;
  private readonly sessions = new Map<string, number>();

  public constructor(password?: string, token?: string) {
    this.password = password;
    this.token = token ?? randomToken();
  }

  public requiresPassword(): boolean {
    return Boolean(this.password);
  }

  private constantTimeEqual(actual: string | undefined, expected: string): boolean {
    if (!actual) return false;

    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    const maxLength = Math.max(actualBuffer.length, expectedBuffer.length);
    const actualPadded = Buffer.alloc(maxLength);
    const expectedPadded = Buffer.alloc(maxLength);

    actualBuffer.copy(actualPadded);
    expectedBuffer.copy(expectedPadded);

    return (
      timingSafeEqual(actualPadded, expectedPadded) && actualBuffer.length === expectedBuffer.length
    );
  }

  private verifySession(session: string | undefined): boolean {
    if (!session) return false;
    const expiresAt = this.sessions.get(session);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      this.sessions.delete(session);
      return false;
    }
    return true;
  }

  public issueSession(payload: AuthPayload): { ok: boolean; session?: string; reason?: string } {
    if (!this.password) return { ok: true };
    if (!this.constantTimeEqual(payload.token, this.token)) {
      return { ok: false, reason: "invalid token" };
    }
    if (!this.constantTimeEqual(payload.password, this.password)) {
      return { ok: false, reason: "invalid password" };
    }
    const session = randomToken(32);
    this.sessions.set(session, Date.now() + AuthService.sessionTtlMs);
    return { ok: true, session };
  }

  public sessionMaxAgeSeconds(): number {
    return Math.floor(AuthService.sessionTtlMs / 1000);
  }

  public verify(payload: AuthPayload): { ok: boolean; reason?: string } {
    if (!this.constantTimeEqual(payload.token, this.token)) {
      return { ok: false, reason: "invalid token" };
    }

    if (
      this.password &&
      !this.constantTimeEqual(payload.password, this.password) &&
      !this.verifySession(payload.session)
    ) {
      return { ok: false, reason: "invalid password" };
    }

    return { ok: true };
  }
}
