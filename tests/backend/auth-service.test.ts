import { describe, expect, test } from "vitest";
import { AuthService } from "../../src/backend/auth/auth-service.js";

describe("AuthService", () => {
  test("accepts matching token and password", () => {
    const auth = new AuthService("pw", "token");
    expect(auth.verify({ token: "token", password: "pw" })).toEqual({ ok: true });
  });

  test("rejects missing or invalid token", () => {
    const auth = new AuthService(undefined, "token");
    expect(auth.verify({}).reason).toBe("invalid token");
    expect(auth.verify({ token: "wrong" }).reason).toBe("invalid token");
  });

  test("rejects missing or invalid password when required", () => {
    const auth = new AuthService("pw", "token");
    expect(auth.verify({ token: "token" }).reason).toBe("invalid password");
    expect(auth.verify({ token: "token", password: "wrong" }).reason).toBe("invalid password");
  });

  test("accepts an issued session in place of the password", () => {
    const auth = new AuthService("pw", "token");
    const issued = auth.issueSession({ token: "token", password: "pw" });

    expect(issued.ok).toBe(true);
    expect(issued.session).toBeTruthy();
    expect(auth.verify({ token: "token", session: issued.session })).toEqual({ ok: true });
  });

  test("does not issue a session for invalid password", () => {
    const auth = new AuthService("pw", "token");
    const issued = auth.issueSession({ token: "token", password: "wrong" });

    expect(issued.ok).toBe(false);
    expect(issued.session).toBeUndefined();
  });
});
