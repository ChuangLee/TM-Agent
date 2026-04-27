import { timingSafeEqual } from "node:crypto";
import { randomToken } from "../util/random.js";

export interface AuthPayload {
  token?: string;
  password?: string;
}

export class AuthService {
  public readonly token: string;
  private readonly password?: string;

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

  public verify(payload: AuthPayload): { ok: boolean; reason?: string } {
    if (!this.constantTimeEqual(payload.token, this.token)) {
      return { ok: false, reason: "invalid token" };
    }

    if (this.password && !this.constantTimeEqual(payload.password, this.password)) {
      return { ok: false, reason: "invalid password" };
    }

    return { ok: true };
  }
}
