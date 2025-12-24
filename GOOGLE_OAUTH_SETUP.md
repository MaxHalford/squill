# Google OAuth Setup Guide

This application uses Google OAuth to authenticate users and run BigQuery queries on their behalf.

## Setup Steps

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your Project ID

### 2. Enable Required APIs

Enable these APIs in your project:

1. **BigQuery API**
   - Go to [BigQuery API](https://console.cloud.google.com/apis/library/bigquery.googleapis.com)
   - Click "Enable"

2. **Cloud Resource Manager API**
   - Go to [Cloud Resource Manager API](https://console.cloud.google.com/apis/library/cloudresourcemanager.googleapis.com)
   - Click "Enable"

### 3. Configure OAuth Consent Screen

1. Go to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Choose **External** user type (or Internal if using Google Workspace)
3. Fill in the required fields:
   - **App name**: SQL Shell (or your app name)
   - **User support email**: Your email
   - **Developer contact email**: Your email
4. Click "Save and Continue"
5. On the **Scopes** page, click "Save and Continue" (we'll add scopes programmatically)
6. On the **Test users** page:
   - Click "Add Users"
   - Add your email address
   - Click "Save and Continue"
7. Review and click "Back to Dashboard"

### 4. Create OAuth Client ID

1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Click "Create Credentials" → "OAuth client ID"
3. Choose **Web application**
4. Fill in the details:
   - **Name**: SQL Shell Web Client
   - **Authorized JavaScript origins**:
     - For development: `http://localhost:5173`
     - For production: Add your deployed domain (e.g., `https://yourdomain.com`)
   - **Authorized redirect URIs**: Leave empty (we're using the Token flow, not Authorization Code flow)
5. Click "Create"
6. Copy the **Client ID** (looks like `xxxxx.apps.googleusercontent.com`)

### 5. Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Client ID:
   ```
   VITE_GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
   ```

3. Restart your dev server:
   ```bash
   npm run dev
   ```

### 6. Test the Authentication

1. Open the app in your browser (usually `http://localhost:5173`)
2. Open the sidebar (click the button on the right)
3. Click "Sign in with Google"
4. You'll see a Google consent screen asking for permissions:
   - View and manage data in BigQuery
   - View your email address
   - View your basic profile info
   - View your Google Cloud projects
5. Click "Allow"
6. You should now be signed in!

## Required OAuth Scopes

The app requests these scopes:

- `https://www.googleapis.com/auth/bigquery` - Run BigQuery queries
- `https://www.googleapis.com/auth/userinfo.email` - Get user email
- `https://www.googleapis.com/auth/userinfo.profile` - Get user name and photo
- `https://www.googleapis.com/auth/cloud-platform.read-only` - List available projects

## Security Notes

- ✅ **Local Storage**: Access tokens are stored in localStorage with 7-day expiry
- ✅ **No Private Keys**: No service account keys stored in browser
- ✅ **User Permissions**: Users authenticate with their own Google account
- ✅ **Token Expiry**: Tokens expire after 7 days (one business week)
- ✅ **Automatic Expiry**: Users only need to re-authenticate once per week

## Troubleshooting

### "Google Client ID not configured" Error

- Make sure `.env` file exists with `VITE_GOOGLE_CLIENT_ID`
- Restart dev server after creating/updating `.env`

### "Access blocked: This app's request is invalid"

- Check that your JavaScript origin matches exactly (including protocol and port)
- For localhost, use `http://localhost:5173` (not `http://127.0.0.1`)

### "No projects found"

- Make sure you have at least one Google Cloud project
- Check that Cloud Resource Manager API is enabled
- Verify your Google account has access to projects

### "Failed to fetch projects"

- Enable Cloud Resource Manager API in your project
- Wait a few minutes after enabling the API

## Production Deployment

When deploying to production:

1. Add your production domain to **Authorized JavaScript origins** in Google Cloud Console
2. Set `VITE_GOOGLE_CLIENT_ID` in your production environment variables
3. Consider changing OAuth consent screen to "Published" state (requires verification)
