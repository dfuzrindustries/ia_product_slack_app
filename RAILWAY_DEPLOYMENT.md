# Deploying to Railway - Quick Start Guide

## Step 1: Prepare Your Code

1. Create a new GitHub repository
2. Push all the app files to your repository:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

## Step 2: Set Up Railway

1. Go to [Railway.app](https://railway.app/)
2. Click "Start a New Project"
3. Choose "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect it's a Node.js app

## Step 3: Configure Environment Variables

After deployment starts, add your environment variables:

1. Click on your project
2. Go to the "Variables" tab
3. Add each variable (click "+ New Variable"):

```
SLACK_BOT_TOKEN = xoxb-your-bot-token
SLACK_SIGNING_SECRET = your-signing-secret
SLACK_APP_TOKEN = xapp-your-app-token
GITHUB_TOKEN = ghp_your-github-token
GITHUB_OWNER = your-github-username
GITHUB_REPO = your-repo-name
DOCS_PATH = docs
```

4. Click "Deploy" to restart with the new variables

## Step 4: Verify Deployment

1. Check the "Deployments" tab - it should show "Success"
2. Click "View Logs" to see:
   ```
   ⚡️ Slack Documentation Bot is running on port 3000
   ✅ Loaded X documentation files
   ```

## Step 5: Test Your App

1. Go to Slack
2. Type `/docs test` in any channel
3. You should see search results!

## Troubleshooting

### Deployment Failed
- Check the build logs in Railway
- Make sure `package.json` is in the root directory
- Verify Node.js version compatibility

### App Starts But Commands Don't Work
- Double-check all environment variables are set correctly
- Verify Socket Mode is enabled in your Slack app settings
- Check the runtime logs for error messages

### GitHub Connection Issues
- Verify your GitHub token has `repo` scope
- Check that GITHUB_OWNER and GITHUB_REPO are correct
- Test the token: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user`

## Railway Features You'll Love

**Auto-Deploy on Git Push**
Every time you push to your GitHub repo, Railway automatically deploys the changes.

**View Logs**
Click "View Logs" to see real-time output from your app - great for debugging.

**Metrics**
See CPU, memory, and network usage in the Metrics tab.

**Free Tier**
You get $5/month credit for free. This app uses minimal resources and should easily fit within that.

## Updating Your App

Just push changes to GitHub:
```bash
git add .
git commit -m "Updated search algorithm"
git push
```

Railway will automatically detect the changes and redeploy!

## Cost Estimate

This app typically uses:
- ~10-20MB memory
- Minimal CPU (only active during searches)
- Should cost well under $5/month (often $1-2)

## Alternative: Railway CLI

You can also deploy using the CLI:

```bash
# Install
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Add variables
railway variables set SLACK_BOT_TOKEN=xoxb-...
railway variables set SLACK_SIGNING_SECRET=...
# ... add all other variables

# Deploy
railway up
```

## Next Steps

- Set up a custom domain (optional): Railway provides a free subdomain
- Monitor usage in Railway dashboard
- Check logs periodically for any errors
- Update documentation in GitHub and it auto-syncs!
