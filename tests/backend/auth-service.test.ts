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
});
