import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type GitHubSyncPlugin from "./main";

export interface GitHubSyncSettings {
  githubToken: string;
  repository: string; // "owner/repo"
  branch: string;
  authorName: string;
  authorEmail: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  debounceSeconds: number;
}

export const DEFAULT_SETTINGS: GitHubSyncSettings = {
  githubToken: "",
  repository: "",
  branch: "main",
  authorName: "Obsidian Sync",
  authorEmail: "obsidian-sync@localhost",
  autoSync: true,
  syncIntervalMinutes: 5,
  debounceSeconds: 10,
};

export class GitHubSyncSettingTab extends PluginSettingTab {
  plugin: GitHubSyncPlugin;

  constructor(app: App, plugin: GitHubSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "GitHub Sync" });

    // --- Connection ---
    containerEl.createEl("h3", { text: "Connection" });

    new Setting(containerEl)
      .setName("GitHub Personal Access Token")
      .setDesc(
        "Token with repo scope. Create at GitHub → Settings → Developer settings → Personal access tokens."
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("ghp_...")
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Repository")
      .setDesc("GitHub repository in owner/repo format.")
      .addText((text) =>
        text
          .setPlaceholder("username/my-vault")
          .setValue(this.plugin.settings.repository)
          .onChange(async (value) => {
            this.plugin.settings.repository = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Branch")
      .setDesc("Branch to sync with.")
      .addText((text) =>
        text
          .setPlaceholder("main")
          .setValue(this.plugin.settings.branch)
          .onChange(async (value) => {
            this.plugin.settings.branch = value.trim() || "main";
            await this.plugin.saveSettings();
          })
      );

    // --- Commit identity ---
    containerEl.createEl("h3", { text: "Commit Identity" });

    new Setting(containerEl)
      .setName("Author name")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.authorName)
          .onChange(async (value) => {
            this.plugin.settings.authorName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Author email")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.authorEmail)
          .onChange(async (value) => {
            this.plugin.settings.authorEmail = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Sync behaviour ---
    containerEl.createEl("h3", { text: "Sync Behaviour" });

    new Setting(containerEl)
      .setName("Auto sync")
      .setDesc("Automatically commit and push changes when files are modified.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSync)
          .onChange(async (value) => {
            this.plugin.settings.autoSync = value;
            await this.plugin.saveSettings();
            this.plugin.restartSyncSchedule();
          })
      );

    new Setting(containerEl)
      .setName("Sync interval (minutes)")
      .setDesc("How often to pull remote changes in the background.")
      .addSlider((slider) =>
        slider
          .setLimits(1, 60, 1)
          .setValue(this.plugin.settings.syncIntervalMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.syncIntervalMinutes = value;
            await this.plugin.saveSettings();
            this.plugin.restartSyncSchedule();
          })
      );

    new Setting(containerEl)
      .setName("Debounce delay (seconds)")
      .setDesc(
        "Wait this many seconds after the last file change before committing."
      )
      .addSlider((slider) =>
        slider
          .setLimits(3, 60, 1)
          .setValue(this.plugin.settings.debounceSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.debounceSeconds = value;
            await this.plugin.saveSettings();
          })
      );

    // --- Actions ---
    containerEl.createEl("h3", { text: "Actions" });

    const alreadyInit = this.plugin.syncEngine.isInitialized();

    new Setting(containerEl)
      .setName("Initialize repository")
      .setDesc(
        alreadyInit
          ? "Repository is already initialized in this vault."
          : "Set up git in the current vault and connect to the GitHub repository. Run this once on first use."
      )
      .addButton((btn) => {
        btn
          .setButtonText(alreadyInit ? "Initialized" : "Initialize")
          .setCta()
          .setDisabled(alreadyInit)
          .onClick(async () => {
            try {
              await this.plugin.syncEngine.initRepo();
              new Notice("Repository initialized successfully.");
              this.display(); // refresh tab to update button state
            } catch (e) {
              new Notice(`Init failed: ${(e as Error).message}`);
            }
          });
      });

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Commit local changes, pull remote, then push.")
      .addButton((btn) =>
        btn.setButtonText("Sync Now").onClick(async () => {
          await this.plugin.triggerSync();
        })
      );
  }
}
