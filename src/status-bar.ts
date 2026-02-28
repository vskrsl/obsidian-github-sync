export type SyncStatus =
  | { type: "synced" }
  | { type: "syncing" }
  | { type: "pending"; count: number }
  | { type: "error"; message: string };

export class StatusBar {
  private el: HTMLElement;
  private onClickCallback: () => void;

  constructor(el: HTMLElement, onClickCallback: () => void) {
    this.el = el;
    this.onClickCallback = onClickCallback;
    this.el.style.cursor = "pointer";
    this.el.title = "GitHub Sync — click to sync now";
    this.el.addEventListener("click", () => this.onClickCallback());
    this.set({ type: "synced" });
  }

  set(status: SyncStatus): void {
    switch (status.type) {
      case "synced":
        this.el.setText("⬡ Synced");
        this.el.style.color = "";
        break;
      case "syncing":
        this.el.setText("⟳ Syncing…");
        this.el.style.color = "";
        break;
      case "pending":
        this.el.setText(`↑ ${status.count} pending`);
        this.el.style.color = "var(--color-yellow)";
        break;
      case "error":
        this.el.setText("✗ Sync error");
        this.el.style.color = "var(--color-red)";
        this.el.title = `GitHub Sync error: ${status.message}`;
        break;
    }
  }
}
