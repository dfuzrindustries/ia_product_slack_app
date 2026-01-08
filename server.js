const { App } = require('@slack/bolt');
const { Octokit } = require('@octokit/rest');
const express = require('express');
require('dotenv').config();

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Configuration for your GitHub repo
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const DOCS_PATH = process.env.DOCS_PATH || 'docs'; // Default path to docs in repo

// Cache for documentation to avoid hitting GitHub API too frequently
let docsCache = {
  data: [],
  lastUpdated: null
};

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Function to fetch all markdown files from GitHub
async function fetchDocumentation() {
  try {
    console.log('Fetching documentation from GitHub...');
    const { data: tree } = await octokit.rest.git.getTree({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      tree_sha: 'main',
      recursive: true
    });

    // Filter for markdown files in the docs path
    const docFiles = tree.tree.filter(item => 
      item.path.startsWith(DOCS_PATH) && 
      (item.path.endsWith('.md') || item.path.endsWith('.markdown')) &&
      item.type === 'blob'
    );

    // Fetch content for each documentation file
    const docs = await Promise.all(
      docFiles.map(async (file) => {
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: file.path
          });

          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          
          return {
            path: file.path,
            name: file.path.split('/').pop().replace(/\.md$/, ''),
            content: content,
            url: data.html_url
          };
        } catch (error) {
          console.error(`Error fetching ${file.path}:`, error.message);
          return null;
        }
      })
    );

    return docs.filter(doc => doc !== null);
  } catch (error) {
    console.error('Error fetching documentation:', error);
    throw error;
  }
}

// Function to search documentation
function searchDocs(query, docs) {
  const searchTerms = query.toLowerCase().split(' ');
  
  const results = docs.map(doc => {
    let score = 0;
    const contentLower = doc.content.toLowerCase();
    const nameLower = doc.name.toLowerCase();
    
    searchTerms.forEach(term => {
      // Higher score for matches in file name
      if (nameLower.includes(term)) {
        score += 10;
      }
      
      // Score for matches in content
      const matches = (contentLower.match(new RegExp(term, 'g')) || []).length;
      score += matches;
    });
    
    return { ...doc, score };
  })
  .filter(doc => doc.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5); // Top 5 results
  
  return results;
}

// Function to extract relevant snippet from content
function extractSnippet(content, query, maxLength = 200) {
  const lines = content.split('\n');
  const queryLower = query.toLowerCase();
  
  // Find the first line that contains any search term
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(queryLower.split(' ')[0])) {
      // Get surrounding context
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 3);
      let snippet = lines.slice(start, end).join('\n');
      
      if (snippet.length > maxLength) {
        snippet = snippet.substring(0, maxLength) + '...';
      }
      
      return snippet;
    }
  }
  
  // If no match found, return beginning of content
  return content.substring(0, maxLength) + '...';
}

// Slash command handler
app.command('/docs', async ({ command, ack, say, client }) => {
  await ack();
  
  const query = command.text.trim();
  
  if (!query) {
    await say({
      text: 'Please provide a search query. Example: `/docs authentication`',
      response_type: 'ephemeral'
    });
    return;
  }
  
  try {
    // Check cache and refresh if needed
    const now = Date.now();
    if (!docsCache.lastUpdated || (now - docsCache.lastUpdated) > CACHE_DURATION) {
      docsCache.data = await fetchDocumentation();
      docsCache.lastUpdated = now;
    }
    
    // Search documentation
    const results = searchDocs(query, docsCache.data);
    
    if (results.length === 0) {
      await say({
        text: `No documentation found for "${query}". Try different keywords.`,
        response_type: 'ephemeral'
      });
      return;
    }
    
    // Build Slack blocks for results
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📚 Search Results for "${query}"`
        }
      },
      {
        type: 'divider'
      }
    ];
    
    results.forEach((result, index) => {
      const snippet = extractSnippet(result.content, query);
      
      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${index + 1}. ${result.name}*\n\`${result.path}\``
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\`\`\`${snippet}\`\`\``
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View on GitHub'
            },
            url: result.url,
            action_id: `view_doc_${index}`
          }
        },
        {
          type: 'divider'
        }
      );
    });
    
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Found ${results.length} result(s) | <https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}|View all docs on GitHub>`
        }
      ]
    });
    
    await say({
      blocks: blocks,
      text: `Search results for "${query}"`
    });
    
  } catch (error) {
    console.error('Error handling /docs command:', error);
    await say({
      text: `Sorry, there was an error searching the documentation: ${error.message}`,
      response_type: 'ephemeral'
    });
  }
});

// App home handler (optional - shows when user opens the app)
app.event('app_home_opened', async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '📚 Product Documentation'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Welcome to the Documentation Bot!*\n\nSearch our product documentation directly from Slack.'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*How to use:*\n• Type `/docs [search query]` to search documentation\n• Example: `/docs api authentication`\n\nDocumentation is synced from our GitHub repository.'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Docs on GitHub'
                },
                url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
                action_id: 'view_github'
              }
            ]
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error publishing home view:', error);
  }
});

// Health check endpoint (useful for Railway monitoring)
const express = require('express');
const healthCheckApp = express();

healthCheckApp.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    docsLoaded: docsCache.data.length,
    lastUpdated: docsCache.lastUpdated ? new Date(docsCache.lastUpdated).toISOString() : 'never'
  });
});

// Start the app
(async () => {
  const port = process.env.PORT || 3000;
  
  // Start health check server
  healthCheckApp.listen(port, () => {
    console.log(`🏥 Health check endpoint running at http://localhost:${port}/health`);
  });
  
  // Start Slack app (Socket Mode doesn't need the port, but we keep it for compatibility)
  await app.start();
  console.log(`⚡️ Slack Documentation Bot is running`);
  
  // Preload documentation cache
  try {
    docsCache.data = await fetchDocumentation();
    docsCache.lastUpdated = Date.now();
    console.log(`✅ Loaded ${docsCache.data.length} documentation files`);
  } catch (error) {
    console.error('⚠️  Failed to preload documentation:', error.message);
  }
})();
