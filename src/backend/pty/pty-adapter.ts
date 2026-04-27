export interface PtyProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(handler: (data: string) => void): void;
  onExit(handler: (code: number) => void): void;
  kill(): void;
}

export interface PtySpawnOptions {
  cols: number;
  rows: number;
}

export interface PtyFactory {
  spawnTmuxAttach(session: string, options: PtySpawnOptions): PtyProcess;
}
