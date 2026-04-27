// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { pushRecent, useNewSessionStore } from "../../../src/frontend/stores/new-session-store.js";

beforeEach(() => {
  window.localStorage.clear();
  useNewSessionStore.setState({
    recentCwds: [],
    customCommands: [],
    lastForm: null
  });
});

describe("pushRecent", () => {
  test("prepends new entry, dedupes, caps at 5", () => {
    let list: string[] = [];
    list = pushRecent(list, "/a");
    list = pushRecent(list, "/b");
    list = pushRecent(list, "/c");
    list = pushRecent(list, "/a");
    expect(list).toEqual(["/a", "/c", "/b"]);

    list = pushRecent(list, "/d");
    list = pushRecent(list, "/e");
    list = pushRecent(list, "/f");
    expect(list).toEqual(["/f", "/e", "/d", "/a", "/c"]);
    expect(list.length).toBe(5);
  });

  test("ignores empty / whitespace", () => {
    let list: string[] = ["/a"];
    list = pushRecent(list, "");
    list = pushRecent(list, "   ");
    expect(list).toEqual(["/a"]);
  });
});

describe("useNewSessionStore", () => {
  test("addCustomCommand prepends, dedupes by command, persists", () => {
    const store = useNewSessionStore.getState();
    store.addCustomCommand("first", "echo 1");
    store.addCustomCommand("second", "echo 2");
    store.addCustomCommand("dup", "echo 1");
    const cmds = useNewSessionStore.getState().customCommands;
    expect(cmds.map((c) => c.command)).toEqual(["echo 1", "echo 2"]);
    expect(cmds[0].label).toBe("dup");

    const persisted = JSON.parse(
      window.localStorage.getItem("tm-agent.new-session.custom-commands")!
    );
    expect(persisted).toHaveLength(2);
  });

  test("addRecentCwd persists to localStorage", () => {
    useNewSessionStore.getState().addRecentCwd("/root/repos/TM-Agent");
    useNewSessionStore.getState().addRecentCwd("/tmp");
    const persisted = JSON.parse(window.localStorage.getItem("tm-agent.new-session.recent-cwds")!);
    expect(persisted).toEqual(["/tmp", "/root/repos/TM-Agent"]);
  });

  test("removeCustomCommand drops the entry", () => {
    const store = useNewSessionStore.getState();
    const entry = store.addCustomCommand("x", "xcmd");
    store.removeCustomCommand(entry.id);
    expect(useNewSessionStore.getState().customCommands).toEqual([]);
  });

  test("rememberLast persists form values", () => {
    useNewSessionStore.getState().rememberLast({
      cwd: "/tmp",
      command: "preset:claude",
      flags: ["--resume"]
    });
    const persisted = JSON.parse(window.localStorage.getItem("tm-agent.new-session.last")!);
    expect(persisted.command).toBe("preset:claude");
    expect(persisted.flags).toEqual(["--resume"]);
  });
});
