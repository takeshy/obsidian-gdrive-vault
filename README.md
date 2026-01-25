# Obsidian GDrive Vault Plugin

A manual sync plugin for Obsidian that syncs your vault to Google Drive.

## Features

- **Manual Sync**: Push and pull changes when you want
- **Safe Sync**: Preserves old versions for recovery
- **Conflict Resolution**: Side-by-side diff view for markdown files
- **Cross-Platform**: Works on desktop, Android, and iOS
- **i18n Support**: English and Japanese UI

## Installation

This plugin requires your own OAuth server. Follow these steps:

### 1. Deploy OAuth Server

See [obsidian-oauth/README.md](obsidian-oauth/README.md) for detailed instructions.

1. Create a Google Cloud Project
2. Configure OAuth consent screen and credentials
3. Deploy to Google App Engine

### 2. Build the Plugin

1. Fork this repository
2. Edit `config.ts` with your OAuth server URLs:
   ```typescript
   export const OAUTH_CONFIG = {
     refreshAccessTokenURL: "https://YOUR_PROJECT.appspot.com/auth/obsidian/refresh-token",
     fetchRefreshTokenURL: "https://YOUR_PROJECT.appspot.com/auth/obsidian",
   };
   ```
3. Push to main branch (GitHub Action will create a release)

### 3. Install via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings and click "Add Beta plugin"
3. Enter your fork URL: `https://github.com/YOUR_USERNAME/obsidian-gdrive-vault`
4. Click "Add Plugin"

### Manual Installation

1. Download `main.js` and `manifest.json` from your fork's Releases
2. Create folder `.obsidian/plugins/obsidian-gdrive-vault/`
3. Copy the files into the folder
4. Enable the plugin in Obsidian settings

## Setup

1. Open plugin settings and click the Login link
2. Sign in with your Google account and grant permissions
3. Copy the Refresh Token and paste it in settings
4. Reload the plugin
5. Click "Initialize vault" to create your vault folder on Google Drive

![Initial Setup](initial_setting.png)

For additional devices:
1. Create a vault with the same name
2. Install the plugin from your fork
3. Configure with the same Google account
4. Use **Pull Changes** to download all files

## Commands

| Command | Description |
|---------|-------------|
| **Push Changes** | Upload local changes (incremental) |
| **Pull Changes** | Download remote changes (incremental) |
| **Full Push** | Upload entire vault with backup |
| **Full Pull** | Download entire vault with backup |

Ribbon buttons: Upload icon = Push, Download icon = Pull

---

## Temporary Sync

Quick file sharing without full sync overhead. Use when:
- Push/Pull takes too long
- You want to avoid conflict resolution
- You need to quickly share a single file across devices

| Command | Description |
|---------|-------------|
| **Temporary upload current file** | Upload active file to temp storage |
| **Temporary download to current file** | Download temp version to active file |

**Tip**: Assign hotkeys in Obsidian Settings → Hotkeys for quick access.

**Manage temp files**: Settings → Temporary Sync → Manage Temporary Files (select and download or delete)

### How It Works

- Files are stored with `__TEMP__/` prefix on Google Drive
- **No metadata is updated** (neither local nor remote meta files)
- Equivalent to making the same edit on both devices manually

---

## How Sync Works

### Overview

The plugin tracks file states using metadata files:
- **Local Meta**: `.obsidian/gdrive-vault-meta.json`
- **Remote Meta**: `_gdrive-vault-meta.json` (on Google Drive)

Each meta file contains:
- `lastUpdatedAt`: Timestamp of last sync
- `files`: Hash and modification time for each file

---

## Push Changes (Incremental)

Uploads only changed files from local to remote.

### Flow

1. **Check preconditions**
   - No remote meta → Full Push
   - No local meta → Error: "Pull required first"
   - Remote newer than local → Dialog: "Pull required" with [Pull Now] button

2. **Calculate diff** (for each file)
   - Compare: Saved Meta vs Actual File

3. **Upload changed files**

### Preconditions

| Local Meta | Remote Meta | Remote Newer | Action |
|:----------:|:-----------:|:------------:|--------|
| - | - | - | Full Push (first sync) |
| - | exists | - | Error: "Pull required first" |
| exists | exists | Yes | Dialog: "Pull required" |
| exists | exists | No | Proceed with Push |

### Decision Table

After preconditions pass, saved local meta = remote meta (synced state).

#### Files in Current Vault

| Saved Meta | Actual File | Remote File | Action |
|:----------:|:-----------:|:-----------:|--------|
| A | A | exists | Skip (unchanged) |
| A | B | exists | **Upload** (local changed) |
| - | A | not exists | **Upload** (new file) |
| - | A | exists | **Upload** (overwrite remote) |

#### Files Deleted Locally

| Saved Meta | Actual File | Remote File | Action |
|:----------:|:-----------:|:-----------:|--------|
| A | - | exists | Skip (file stays on remote as "untracked") |

### Important Notes

- Push does **NOT** delete remote files
- Deleted local files become "untracked" on remote (recoverable)
- Use "Detect Untracked Files" in settings to manage them

---

## Pull Changes (Incremental)

Downloads only changed files from remote to local.

### Flow

1. **Check preconditions**
   - No remote meta → Nothing to pull
   - No local meta → Download all remote files

2. **Calculate diff** (for each file)
   - Compare: Local Meta vs Remote Meta vs Actual File

3. **Handle conflicts** (if any)
   - Show conflict dialog with diff view

4. **Download changed files**

5. **Delete files removed from remote**

### Decision Tables

#### Files in Both Metas

| Local Meta | Remote Meta | Actual | Action |
|:----------:|:-----------:|:------:|--------|
| A | A | A | Skip (unchanged) |
| A | A | B | Skip (local-only change, upload on next Push) |
| A | A | - | Skip (local deleted, propagates on next Push) |
| A | B | A | **Download** (remote changed) |
| A | B | B | **Conflict** (both changed) |
| A | B | C | **Conflict** (both changed differently) |
| A | B | - | **Download** (local deleted + remote updated) |

#### Files Only in Local Meta (Remote Deleted)

| Local Meta | Remote Meta | Actual | Action |
|:----------:|:-----------:|:------:|--------|
| A | - | A | **Delete local** (remote deleted) |
| A | - | B | **Conflict** (local modified, remote deleted) |
| A | - | - | Nothing (already deleted both sides) |

#### Files Only in Remote Meta (New Remote)

| Local Meta | Remote Meta | Actual | Action |
|:----------:|:-----------:|:------:|--------|
| - | A | - | **Download** (new remote file) |
| - | A | A | Skip (same content, update meta only) |
| - | A | B | **Conflict** (both have different new files) |

### Why This Approach?

- **Avoids false conflicts**: Local-only changes don't trigger conflicts
- **Safe overwrites**: Only downloads when remote actually changed
- **Clear separation**: Push handles uploads, Pull handles downloads
- **Handles deletions**: Respects intentional deletions while detecting conflicts

---

## Full Push

Uploads entire vault, preserving old remote versions.

### Flow

For each local file:

1. Compare hash with remote
2. If **same** → Skip (no change needed)
3. If **different** → Rename remote file (add timestamp) → Upload new version

### Decision Table

| Local File | Remote File | Remote Meta | Hashes | Action |
|:----------:|:-----------:|:-----------:|:------:|--------|
| A | exists | hash=A | Same | Skip (unchanged) |
| B | exists | hash=A | Different | Rename remote → **Upload** B |
| A | exists | - | - | **Upload** A |
| A | not exists | - | - | **Upload** A |

### Example

- Local: `notes/daily.md` ≠ Remote: `notes/daily.md`
- → Rename remote to: `notes/daily_20240124_103000.md` (becomes untracked)
- → Upload local as: `notes/daily.md`

### Recovery

Old versions become "untracked" and can be:
- **Restored**: Settings → Detect Untracked Files → Restore Selected
- **Deleted**: Settings → Detect Untracked Files → Delete Selected

---

## Full Pull

Downloads entire vault, preserving local versions.

### Flow

For each remote file:

1. Compare hash with local
2. If **same** → Skip (no change needed)
3. If **different** → Save local to `sync_conflicts/` → Download remote version

### Example

- Local: `notes/daily.md` ≠ Remote: `notes/daily.md`
- → Save local to: `sync_conflicts/daily_20240124_103000.md`
- → Download remote as: `notes/daily.md`

### Recovery

Old local versions are saved to `sync_conflicts/` folder:
- Browse the folder to find backup files
- Use Settings → Clear conflict files to delete all backups

---

## Conflict Resolution

Conflicts only occur during **Pull** when both local and remote have changes to the same file. A dialog appears:

- File path and timestamps for both versions
- **Show Diff** button for markdown files (side-by-side comparison)
- **Keep Local** / **Keep Remote** buttons

| Choice | What Happens |
|--------|--------------|
| **Keep Local** | Upload local, save remote to `sync_conflicts/` |
| **Keep Remote** | Download remote, save local to `sync_conflicts/` |

The unselected version is always backed up for manual merging if needed.

---

## File Recovery

### Scenario 1: Conflict - Need Both Versions

When a conflict occurs, you choose "Keep Local" or "Keep Remote", but the other version is always saved to `sync_conflicts/`.

**To merge manually:**
1. Open the file you kept
2. Browse `sync_conflicts/` folder to find the other version
3. Copy the parts you need from the backup
4. Delete the backup file when done

### Scenario 2: Realize Later You Need a Deleted File

When you delete a file locally and Push, the file stays on Google Drive as "untracked".

**To recover:**
1. Settings → Detect Untracked Files
2. Select the file you need
3. Click "Restore Selected"

### Scenario 3: Accidentally Modified or Deleted Locally

If you accidentally changed or deleted files locally and want to restore from remote.

**To recover:** Use **Full Pull** - this treats remote as authoritative and downloads files that differ. Local files that differ are backed up to `sync_conflicts/`, so you can restore any files you didn't want overwritten.

---

## Settings

![Settings](settings.png)

| Setting | Description |
|---------|-------------|
| Exclude patterns | Glob patterns for files to exclude |
| Conflict folder | Backup folder name (default: `sync_conflicts`) |
| Clear conflict files | Delete all backup files |
| Detect Untracked Files | Find/restore/delete untracked remote files |
| Full Push | Upload entire vault |
| Full Pull | Download entire vault |

### Default Exclude Patterns

- `.obsidian/**` - Obsidian config
- `.**` - Dot files
- `.*/**` - Dot folders
- `sync_conflicts/**` - Backup folder

---

## FAQ

### Does this work on mobile?

Yes! Works on Android and iOS.

### Must vault names match across devices?

Yes. The plugin uses vault name to identify the sync target.

### Can I add files directly to Google Drive?

No. The plugin can only access files it created (Google API restriction).

### Why are files stored flat in Google Drive?

Simpler implementation. Folder structure is preserved in filenames like `folder/note.md`.

### How do I exclude files?

Add glob patterns in settings:
- `*.tmp` - Exclude .tmp files
- `drafts/**` - Exclude drafts folder
- `**/private/**` - Exclude any "private" folder

---

## Troubleshooting

1. Check that the plugin is enabled
2. Verify refresh token is correct
3. Check internet connection
4. View console for error messages (Ctrl+Shift+I)

## Support

- [GitHub Issues](https://github.com/takeshy/obsidian-gdrive-vault/issues)

## License

MIT
