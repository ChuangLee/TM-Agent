// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "../../../src/frontend/i18n/index.js";
import { LanguageSwitcher } from "../../../src/frontend/components/LanguageSwitcher.js";

describe("LanguageSwitcher", () => {
  afterEach(async () => {
    cleanup();
    try {
      localStorage.removeItem("tm-agent.lang");
    } catch {
      // ignore
    }
    await i18n.changeLanguage("en");
  });

  test("renders 🌐 trigger in compact mode with a label", () => {
    render(<LanguageSwitcher variant="compact" />);
    const trigger = screen.getByTestId("language-switcher-trigger");
    expect(trigger.getAttribute("aria-label")).toBeTruthy();
  });

  test("dropdown lists all 7 supported locales with native names", () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByTestId("language-switcher-trigger"));
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(7);
    const labels = items.map((i) => i.getAttribute("data-locale"));
    expect(labels).toEqual(["en", "zh-Hans", "ja", "ko", "fr", "es", "de"]);
    // Native-name rendering: the zh-Hans entry should show "简体中文".
    expect(screen.getByText("简体中文")).toBeTruthy();
    expect(screen.getByText("日本語")).toBeTruthy();
  });

  test("clicking a locale changes i18n language and persists to localStorage", async () => {
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByTestId("language-switcher-trigger"));
    fireEvent.click(screen.getByText("日本語"));
    // microtask drain so i18n.changeLanguage resolves
    await new Promise((r) => setTimeout(r, 10));
    expect(i18n.language).toBe("ja");
    expect(localStorage.getItem("tm-agent.lang")).toBe("ja");
  });
});
