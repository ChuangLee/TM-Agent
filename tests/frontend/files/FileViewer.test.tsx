// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileViewer } from "../../../src/frontend/features/files/FileViewer.js";
import { useViewerStore } from "../../../src/frontend/features/files/viewer-store.js";
import { useAuthStore } from "../../../src/frontend/stores/auth-store.js";
import * as filesApi from "../../../src/frontend/services/files-api.js";

beforeEach(() => {
  useViewerStore.setState({ target: null });
  useAuthStore.setState({ token: "t0", password: "" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<FileViewer />", () => {
  test("renders nothing when no target", () => {
    const { container } = render(<FileViewer />);
    expect(container.firstChild).toBeNull();
  });

  test("image target renders <img> with authed URL", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "shot.png",
      name: "shot.png",
      mime: "image/png",
      size: 120
    });
    render(<FileViewer />);
    const img = screen.getByAltText("shot.png") as HTMLImageElement;
    expect(img.src).toContain("/api/files/raw?");
    expect(img.src).toContain("paneId=%25");
    expect(img.src).toContain("token=t0");
  });

  test("PDF target renders an iframe", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "report.pdf",
      name: "report.pdf",
      mime: "application/pdf",
      size: 1000
    });
    const { container } = render(<FileViewer />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.src).toContain("/api/files/raw?");
  });

  test("SVG target sandboxes the iframe", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "pic.svg",
      name: "pic.svg",
      mime: "image/svg+xml",
      size: 100
    });
    const { container } = render(<FileViewer />);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute("sandbox")).toBe("");
  });

  test("text target fetches via fetchFileText", async () => {
    const spy = vi.spyOn(filesApi, "fetchFileText").mockResolvedValue("hello\nworld");
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "note.txt",
      name: "note.txt",
      mime: "text/plain",
      size: 11
    });
    render(<FileViewer />);
    await waitFor(() => {
      expect(screen.getByText(/hello/)).toBeDefined();
    });
    expect(spy).toHaveBeenCalledWith("%1", "note.txt");
  });

  test("oversize text falls back to download notice", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "huge.log",
      name: "huge.log",
      mime: "text/plain",
      size: 50 * 1024 * 1024
    });
    render(<FileViewer />);
    expect(screen.getByText(/File too large|文件太大/)).toBeDefined();
  });

  test("unknown mime shows download-only notice", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "thing.docx",
      name: "thing.docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 1000
    });
    render(<FileViewer />);
    expect(screen.getByText(/has no built-in preview|没有内置预览/)).toBeDefined();
  });

  test("close button clears target", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "a.png",
      name: "a.png",
      mime: "image/png",
      size: 10
    });
    render(<FileViewer />);
    fireEvent.click(screen.getByLabelText(/^(Close|关闭)$/));
    expect(useViewerStore.getState().target).toBeNull();
  });

  test("Escape key closes the viewer", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "a.png",
      name: "a.png",
      mime: "image/png",
      size: 10
    });
    render(<FileViewer />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useViewerStore.getState().target).toBeNull();
  });

  test("download anchor points to /api/files/download", () => {
    useViewerStore.getState().open({
      paneId: "%1",
      rel: "r.pdf",
      name: "r.pdf",
      mime: "application/pdf",
      size: 100
    });
    render(<FileViewer />);
    const link = screen.getByText(/^(Download|下载)$/).closest("a") as HTMLAnchorElement;
    expect(link.href).toContain("/api/files/download?");
    expect(link.download).toBe("r.pdf");
  });
});
