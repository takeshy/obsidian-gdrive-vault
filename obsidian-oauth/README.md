# OAuth Server for GDrive Vault

This directory contains the OAuth server that handles Google authentication for the GDrive Vault plugin.

## Prerequisites

- Google Cloud Platform account
- gcloud CLI installed and configured

## Setup Steps

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" > "New Project"
3. Enter a project name and click "Create"
4. Wait for the project to be created and select it

### 2. Enable Google Drive API

1. Go to "APIs & Services" > "Library"
2. Search for "Google Drive API"
3. Click on it and then click "Enable"

### 3. Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Select "External" user type and click "Create"
3. Fill in the required fields:
   - App name: Your app name (e.g., "GDrive Vault")
   - User support email: Your email
   - Developer contact email: Your email
4. Click "Save and Continue"
5. On the "Scopes" page, click "Add or Remove Scopes"
6. Add scope: `https://www.googleapis.com/auth/drive.file`
7. Click "Save and Continue"
8. Add test users if in testing mode
9. Click "Save and Continue"

### 4. Create OAuth 2.0 Client ID

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Select "Web application" as application type
4. Enter a name (e.g., "GDrive Vault OAuth")
5. Under "Authorized redirect URIs", add:
   ```
   https://YOUR_PROJECT_ID.appspot.com/auth/obsidian/callback
   ```
   (Replace `YOUR_PROJECT_ID` with your actual project ID)
6. Click "Create"
7. Copy the Client ID and Client Secret

### 5. Configure app.yaml

1. Copy `app.yaml.example` to `app.yaml`:
   ```bash
   cp app.yaml.example app.yaml
   ```

2. Edit `app.yaml` and replace the placeholders:
   ```yaml
   runtime: nodejs22

   env_variables:
     CLIENT_ID: "your-client-id.apps.googleusercontent.com"
     CLIENT_SECRET: "your-client-secret"
     REDIRECT_URI: "https://your-project-id.appspot.com/auth/obsidian/callback"
   ```

### 6. Deploy to Google App Engine

1. Make sure gcloud CLI is installed and authenticated:
   ```bash
   gcloud auth login
   ```

2. Set your project:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

3. Deploy the app:
   ```bash
   gcloud app deploy
   ```

4. Note your app URL: `https://YOUR_PROJECT_ID.appspot.com`

### 7. Configure and Build the Plugin

1. In the plugin repository root, edit `config.ts` with your OAuth URLs:
   ```typescript
   export const OAUTH_CONFIG = {
     refreshAccessTokenURL: "https://YOUR_PROJECT_ID.appspot.com/auth/obsidian/refresh-token",
     fetchRefreshTokenURL: "https://YOUR_PROJECT_ID.appspot.com/auth/obsidian",
   };
   ```

2. Build the plugin:
   ```bash
   pnpm install
   pnpm build
   ```

3. Copy `main.js` and `manifest.json` to your plugin folder (`.obsidian/plugins/obsidian-gdrive-vault/`)

## Troubleshooting

### "Access blocked: This app's request is invalid"

- Check that the Redirect URI in your OAuth client matches the one in `app.yaml`
- Make sure the URI ends with `/auth/obsidian/callback`

### "Error 403: access_denied"

- If your app is in testing mode, make sure your Google account is added as a test user
- To publish the app for all users, go to OAuth consent screen and click "Publish App"

### "Error: redirect_uri_mismatch"

- The redirect URI in your OAuth client credentials must exactly match the one in `app.yaml`
- Check for trailing slashes or protocol mismatches (http vs https)

## Security Notes

- Never commit `app.yaml` with real credentials (it's in `.gitignore`)
- Keep your Client Secret confidential
- Consider restricting API access to only the scopes you need
