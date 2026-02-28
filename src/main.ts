import { FileSystemAdapter, Notice, Plugin, TAbstractFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  GitHubSyncSettingTab,
  GitHubSyncSettings,
} from "./settings";
import { StatusBar } from "./status-bar";
import { SyncEngine } from "./sync-engine";

export default class GitHubSyncPlugin extends Plugin {
  settings: GitHubSyncSettings;
  syncEngine: SyncEngine;

  private statusBar: StatusBar;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pullIntervalId: ReturnType<typeof setInterval> | null = null;
  private pendingChanges = 0;

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async onload() {
    await this.loadSettings();

    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      new Notice(
        "GitHub Sync: vault path unavailable (mobile not supported)."
      );
      return;
    }

    // Status bar
    const sbEl = this.addStatusBarItem();
    this.statusBar = new StatusBar(sbEl, () => this.triggerSync());

    // Sync engine
    this.syncEngine = new SyncEngine(
      vaultPath,
      () => this.settings,
      this.statusBar
    );

    // Settings tab
    this.addSettingTab(new GitHubSyncSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => this.triggerSync(),
    });

    this.addCommand({
      id: "init-repo",
      name: "Initialize repository",
      callback: async () => {
        try {
          await this.syncEngine.initRepo();
          new Notice("GitHub Sync: repository initialized.");
        } catch (e) {
          new Notice(`GitHub Sync init error: ${(e as Error).message}`);
        }
      },
    });

    // File watchers
    this.registerVaultEvents();

    // Pull on startup
    this.syncEngine.pullOnly();

    // Schedule periodic pulls
    this.startPullInterval();
  }

  onunload() {
    this.stopPullInterval();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  // ─── Settings ────────────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ─── Vault events ─────────────────────────────────────────────────────────────

  private registerVaultEvents() {
    const onChange = (file: TAbstractFile) => {
      // Ignore hidden/system files
      if (file.path.startsWith(".obsidian/")) return;
      this.onFileChanged();
    };

    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(
      this.app.vault.on("rename", (file, _oldPath) => {
        if (file.path.startsWith(".obsidian/")) return;
        this.onFileChanged();
      })
    );
  }

  private onFileChanged() {
    if (!this.settings.autoSync) return;

    this.pendingChanges++;
    this.statusBar.set({ type: "pending", count: this.pendingChanges });

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.pendingChanges = 0;
      this.triggerSync();
    }, this.settings.debounceSeconds * 1000);
  }

  // ─── Sync ─────────────────────────────────────────────────────────────────────

  async triggerSync() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges = 0;
    await this.syncEngine.sync();
  }

  // ─── Interval ────────────────────────────────────────────────────────────────

  restartSyncSchedule() {
    this.stopPullInterval();
    if (this.settings.autoSync) {
      this.startPullInterval();
    }
  }

  private startPullInterval() {
    const ms = this.settings.syncIntervalMinutes * 60 * 1000;
    this.pullIntervalId = setInterval(() => {
      this.syncEngine.pullOnly();
    }, ms);
  }

  private stopPullInterval() {
    if (this.pullIntervalId) {
      clearInterval(this.pullIntervalId);
      this.pullIntervalId = null;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    return null;
  }
}
