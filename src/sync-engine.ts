import * as fs from "fs";
import * as path from "path";
import * as git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { Notice } from "obsidian";
import type { GitHubSyncSettings } from "./settings";
import type { StatusBar } from "./status-bar";

export class SyncEngine {
  private dir: string;
  private settings: () => GitHubSyncSettings;
  private statusBar: StatusBar;

  constructor(
    vaultPath: string,
    getSettings: () => GitHubSyncSettings,
    statusBar: StatusBar
  ) {
    this.dir = vaultPath;
    this.settings = getSettings;
    this.statusBar = statusBar;
  }

  // ─── Auth ───────────────────────────────────────────────────────────────────

  private get onAuth() {
    return () => ({
      username: this.settings().githubToken,
      password: this.settings().githubToken,
    });
  }

  private get remoteUrl(): string {
    return `https://github.com/${this.settings().repository}.git`;
  }

  private get author() {
    return {
      name: this.settings().authorName,
      email: this.settings().authorEmail,
    };
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  isInitialized(): boolean {
    return fs.existsSync(path.join(this.dir, ".git"));
  }

  async initRepo(): Promise<void> {
    const gitDir = path.join(this.dir, ".git");
    const alreadyInit = fs.existsSync(gitDir);

    if (!alreadyInit) {
      await git.init({ fs, dir: this.dir, defaultBranch: this.settings().branch });
    }

    // Ensure remote is set (update if changed)
    const remotes = await git.listRemotes({ fs, dir: this.dir });
    const hasOrigin = remotes.some((r) => r.remote === "origin");
    if (hasOrigin) {
      await git.deleteRemote({ fs, dir: this.dir, remote: "origin" });
    }
    await git.addRemote({
      fs,
      dir: this.dir,
      remote: "origin",
      url: this.remoteUrl,
    });

    // Try to fetch & checkout from remote (if repo already has content)
    try {
      await git.fetch({
        fs,
        http,
        dir: this.dir,
        remote: "origin",
        onAuth: this.onAuth,
        singleBranch: true,
        ref: this.settings().branch,
      });

      const branch = this.settings().branch;
      // Check if local branch exists
      const localBranches = await git.listBranches({ fs, dir: this.dir });
      if (!localBranches.includes(branch)) {
        await git.branch({
          fs,
          dir: this.dir,
          ref: branch,
          object: `origin/${branch}`,
          checkout: true,
        });
      }
    } catch {
      // Remote is empty or unreachable — that's fine, we'll push on first sync
    }
  }

  // ─── Full sync cycle ─────────────────────────────────────────────────────────

  async sync(): Promise<void> {
    const s = this.settings();
    if (!s.githubToken || !s.repository) {
      new Notice("GitHub Sync: configure token and repository first.");
      return;
    }

    this.statusBar.set({ type: "syncing" });

    try {
      await this.commitLocalChanges();
      await this.pullRemote();
      await this.push();
      this.statusBar.set({ type: "synced" });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error("[GitHub Sync]", e);
      this.statusBar.set({ type: "error", message: msg });
      new Notice(`GitHub Sync error: ${msg}`);
    }
  }

  // ─── Pull only (background refresh) ─────────────────────────────────────────

  async pullOnly(): Promise<void> {
    const s = this.settings();
    if (!s.githubToken || !s.repository) return;

    try {
      await this.pullRemote();
    } catch (e) {
      console.warn("[GitHub Sync] Background pull failed:", e);
    }
  }

  // ─── Internal steps ──────────────────────────────────────────────────────────

  private async commitLocalChanges(): Promise<void> {
    // Stage all changes (new, modified, deleted)
    const statusMatrix = await git.statusMatrix({ fs, dir: this.dir });

    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const [filepath, head, workdir, stage] of statusMatrix) {
      // head=1 workdir=0 → deleted
      if (head === 1 && workdir === 0) {
        toRemove.push(filepath as string);
      }
      // anything else that differs from head or stage
      else if (workdir !== stage) {
        toAdd.push(filepath as string);
      } else if (head !== stage) {
        toAdd.push(filepath as string);
      }
    }

    if (toAdd.length === 0 && toRemove.length === 0) return;

    for (const fp of toAdd) {
      await git.add({ fs, dir: this.dir, filepath: fp });
    }
    for (const fp of toRemove) {
      await git.remove({ fs, dir: this.dir, filepath: fp });
    }

    const timestamp = new Date().toISOString();
    await git.commit({
      fs,
      dir: this.dir,
      author: this.author,
      committer: this.author,
      message: `vault: sync ${timestamp}`,
    });
  }

  private async pullRemote(): Promise<void> {
    // fetch first, then merge
    await git.fetch({
      fs,
      http,
      dir: this.dir,
      remote: "origin",
      onAuth: this.onAuth,
      singleBranch: true,
      ref: this.settings().branch,
    });

    const remoteRef = `origin/${this.settings().branch}`;
    let remoteOid: string | undefined;
    try {
      remoteOid = await git.resolveRef({ fs, dir: this.dir, ref: remoteRef });
    } catch {
      // remote branch doesn't exist yet (fresh repo)
      return;
    }

    let localOid: string | undefined;
    try {
      localOid = await git.resolveRef({
        fs,
        dir: this.dir,
        ref: this.settings().branch,
      });
    } catch {
      // no local commit yet
    }

    if (localOid === remoteOid) return; // already up to date

    try {
      await git.merge({
        fs,
        dir: this.dir,
        ours: this.settings().branch,
        theirs: remoteOid,
        author: this.author,
        committer: this.author,
        fastForward: true,
      });
    } catch (mergeErr) {
      // Conflict: save conflicting files with .conflict suffix and accept ours
      await this.resolveConflicts();
    }
  }

  private async resolveConflicts(): Promise<void> {
    const statusMatrix = await git.statusMatrix({ fs, dir: this.dir });
    const conflicted: string[] = [];

    for (const [filepath, head, workdir, stage] of statusMatrix) {
      // stage === 2 indicates conflict in isomorphic-git
      if (stage === 2 || (head === 1 && workdir === 1 && stage === 0)) {
        conflicted.push(filepath as string);
      }
    }

    for (const fp of conflicted) {
      const fullPath = path.join(this.dir, fp);
      const conflictPath = fullPath + ".conflict";
      // Save the conflicting content as .conflict file
      if (fs.existsSync(fullPath)) {
        fs.copyFileSync(fullPath, conflictPath);
        new Notice(`Conflict saved: ${fp}.conflict`);
      }
      // Accept ours (re-add our version)
      await git.add({ fs, dir: this.dir, filepath: fp });
    }

    if (conflicted.length > 0) {
      await git.commit({
        fs,
        dir: this.dir,
        author: this.author,
        committer: this.author,
        message: `vault: resolve conflicts (ours wins) ${new Date().toISOString()}`,
      });
    }
  }

  private async push(): Promise<void> {
    const result = await git.push({
      fs,
      http,
      dir: this.dir,
      remote: "origin",
      ref: this.settings().branch,
      onAuth: this.onAuth,
    });

    if (!result.ok) {
      throw new Error(`Push failed: ${JSON.stringify(result.error)}`);
    }
  }
}
