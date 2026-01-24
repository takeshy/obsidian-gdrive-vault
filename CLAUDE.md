# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin that syncs vault files to Google Drive. It provides automatic synchronization, offline support with pending sync queue, and cross-device vault access.

## Build Commands

```bash
# Development build (with watch mode)
pnpm dev

# Production build
pnpm build

# Install dependencies
pnpm install
```

## Architecture

### File Structure
- `main.ts` - Main plugin class (`driveSyncPlugin`), settings tab, and all event handlers
- `actions.js` - Google Drive API wrapper functions (upload, download, rename, delete files)
- `esbuild.config.mjs` - Build configuration

### Key Components

**driveSyncPlugin class (main.ts)**
- Extends Obsidian's `Plugin` class
- Manages sync state: `cloudFiles[]`, `localFiles[]`, `syncQueue[]`
- Handles offline mode with `pendingSyncItems` queue persisted to `pendingSync-gdrive-plugin` file
- Uses `lastSync` YAML frontmatter tag in markdown files for sync tracking
- Binary files tracked via `.attachment-tracking-obsidian-gdrive-sync/` folder

**Sync Flow**
1. On load: `initFunction()` fetches access token and vault ID from Google Drive
2. Periodic `refreshAll()` compares cloud vs local files, downloads new/modified files
3. File events (create, modify, rename, delete) trigger corresponding Drive API calls
4. Offline changes queued in `pendingSyncItems`, synced when connection restored via `completeAllPendingSyncs()`

**Google Drive API (actions.js)**
- Uses Obsidian's `requestUrl` for API calls
- Files stored flat in Drive with full path as filename (no folder hierarchy)
- Vault folder created under `obsidian/` root folder in Drive

### Settings Storage
Plugin settings stored in Obsidian's data.json include:
- `refreshToken`, `accessToken` - OAuth tokens
- `vaultId`, `rootFolderId` - Drive folder IDs
- `filesList` - Cached list of files in Drive (used for offline operations)
- `blacklistPaths` - Files/folders excluded from sync

### Important Patterns
- Files use `lastSync` YAML property for sync tracking
- Attachment tracking uses separate hidden folder with safe filenames (slashes replaced with dots)
- Error rate limiting: halts operations after 5+ errors within a minute
- `forceFocus` setting for editor focus issues during sync
