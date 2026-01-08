# Slack Documentation Bot

A Slack app that makes your GitHub-hosted product documentation searchable directly from Slack.

## Features

- 🔍 Search documentation using the `/docs` command
- 📝 Displays relevant snippets from your documentation
- 🔗 Direct links to view full docs on GitHub
- 💾 Caching to minimize GitHub API calls
- 🏠 App Home with usage instructions

## Prerequisites

- Node.js (v14 or higher)
- A Slack workspace where you can install apps
- A GitHub repository with documentation in Markdown format
- GitHub personal access token
- Slack app credentials

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
npm install
```

### 2. Create a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" (classic)
3. Give it a descriptive name like "Slack Docs Bot"
4. Select the `repo` scope (or `public_repo` if your docs are in a public repository)
5. Click "Generate token" and copy it

### 3. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name it "Documentation Bot" and select your workspace
4. Navigate to "OAuth & Permissions" in the sidebar
5. Add the following Bot Token Scopes:
   - `chat:write`
   - `commands`
   - `app_mentions:read`
6. Install the app to your workspace
7. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

### 4. Enable Socket Mode

1. Go to "Socket Mode" in the sidebar
2. Enable Socket Mode
3. Give your token a name and click "Generate"
4. Copy the App-Level Token (starts with `xapp-`)

### 5. Add a Slash Command

1. Go to "Slash Commands" in the sidebar
2. Click "Create New Command"
3. Command: `/docs`
4. Short Description: "Search product documentation"
5. Usage Hint: "[search query]"
6. Click "Save"

### 6. Configure Event Subscriptions (Optional)

1. Go to "Event Subscriptions" in the sidebar
2. Enable Events
3. Subscribe to bot events:
   - `app_home_opened`

### 7. Get Your Signing Secret

1. Go to "Basic Information" in the sidebar
2. Under "App Credentials", copy the "Signing Secret"

### 8. Configure Environment Variables

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in your credentials:
   ```
   SLACK_BOT_TOKEN=xoxb-your-bot-token-here
   SLACK_SIGNING_SECRET=your-signing-secret-here
   SLACK_APP_TOKEN=xapp-your-app-token-here
   GITHUB_TOKEN=ghp_your-github-token-here
   GITHUB_OWNER=your-github-username-or-org
   GITHUB_REPO=your-repository-name
   DOCS_PATH=docs
   ```

### 9. Run the App

```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

You should see:
```
⚡️ Slack Documentation Bot is running on port 3000
✅ Loaded X documentation files
```

## Usage

### Search Documentation

In any Slack channel where the bot is present, or via direct message:

```
/docs authentication
/docs api endpoints
/docs getting started
```

The bot will:
1. Search through all markdown files in your GitHub docs folder
2. Return the top 5 most relevant results
3. Show snippets with context
4. Provide buttons to view the full documentation on GitHub

### App Home

Click on the app in Slack's sidebar to see:
- Usage instructions
- Quick link to GitHub documentation

## How It Works

1. **Fetching**: The app fetches all markdown files from your specified GitHub repository path
2. **Caching**: Documentation is cached for 10 minutes to minimize GitHub API calls
3. **Searching**: When you use `/docs`, it searches through cached documentation
4. **Scoring**: Results are ranked based on:
   - Matches in file names (higher weight)
   - Frequency of search terms in content
5. **Display**: Top results are formatted and sent back to Slack with snippets and links

## Configuration Options

### Cache Duration

Modify `CACHE_DURATION` in `server.js` (default: 10 minutes):
```javascript
const CACHE_DURATION = 10 * 60 * 1000; // milliseconds
```

### Documentation Path

Change where the bot looks for docs in your GitHub repo:
```
DOCS_PATH=documentation
DOCS_PATH=wiki
DOCS_PATH=docs/product
```

### Number of Results

Modify the `.slice()` in the `searchDocs` function (default: 5):
```javascript
.slice(0, 10); // Show top 10 results
```

## Deployment

### Heroku

1. Create a new Heroku app:
   ```bash
   heroku create your-app-name
   ```

2. Set environment variables:
   ```bash
   heroku config:set SLACK_BOT_TOKEN=xoxb-...
   heroku config:set SLACK_SIGNING_SECRET=...
   heroku config:set SLACK_APP_TOKEN=xapp-...
   heroku config:set GITHUB_TOKEN=ghp_...
   heroku config:set GITHUB_OWNER=...
   heroku config:set GITHUB_REPO=...
   heroku config:set DOCS_PATH=docs
   ```

3. Deploy:
   ```bash
   git push heroku main
   ```

### Docker

Create a `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t slack-docs-bot .
docker run -p 3000:3000 --env-file .env slack-docs-bot
```

## Troubleshooting

### "No documentation found"
- Check that `DOCS_PATH` matches your GitHub repository structure
- Verify your GitHub token has proper permissions
- Ensure documentation files are in Markdown format (.md or .markdown)

### "Error fetching documentation"
- Verify GitHub credentials are correct
- Check that the repository name and owner are correct
- Ensure the default branch is named 'main' (or update in code if different)

### Slash command doesn't respond
- Verify Socket Mode is enabled
- Check that all tokens are correct in `.env`
- Look for errors in the console output

## Advanced Features (Future Enhancements)

Potential improvements you could add:
- Full-text search with better ranking algorithms
- Support for multiple repositories
- Webhook integration for real-time updates when docs change
- Interactive browsing by category/folder
- Fuzzy search for typo tolerance
- Search within specific sections or categories
- User favorites/bookmarks
- Analytics on most-searched topics

## Support

For issues or questions:
1. Check the console logs for error messages
2. Verify all environment variables are set correctly
3. Ensure GitHub repository is accessible with your token
4. Test GitHub API access: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user`

## License

MIT License - Feel free to modify and use as needed.
