const { App } = require('@slack/bolt');
const express = require('express');
const cheerio = require('cheerio');
require('dotenv').config();

// Node 18+ has built-in fetch, no need to import

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Configuration for your GitHub Pages site
const DOCS_BASE_URL = process.env.DOCS_BASE_URL;

// Cache for documentation
let docsCache = {
  data: [],
  lastUpdated: null
};

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// Function to discover all documentation pages
async function discoverPages(baseUrl) {
  const pages = [];
  const visited = new Set();
  
  // Try to fetch sitemap.xml first
  try {
    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    console.log(`Looking for sitemap at: ${sitemapUrl}`);
    const response = await fetch(sitemapUrl);
    if (response.ok) {
      const xml = await response.text();
      const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g);
      if (urlMatches) {
        urlMatches.forEach(match => {
          const url = match.replace(/<\/?loc>/g, '');
          if (url.startsWith(baseUrl)) {
            pages.push(url);
          }
        });
        console.log(`Found ${pages.length} pages from sitemap`);
        return pages;
      }
    }
  } catch (error) {
    console.log('No sitemap found, will crawl instead...');
  }
  
  // Fallback: crawl the site
  async function crawl(url, depth = 0) {
    if (depth > 3 || visited.has(url)) return;
    visited.add(url);
    
    try {
      console.log(`Crawling: ${url}`);
      const response = await fetch(url);
      if (!response.ok) return;
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      pages.push(url);
      
      // Find all internal links
      $('a[href]').each((_, elem) => {
        let href = $(elem).attr('href');
        if (!href) return;
        
        // Convert relative URLs to absolute
        if (href.startsWith('/')) {
          href = baseUrl + href;
        } else if (href.startsWith('./')) {
          href = url.substring(0, url.lastIndexOf('/')) + href.substring(1);
        } else if (!href.startsWith('http')) {
          href = url.substring(0, url.lastIndexOf('/') + 1) + href;
        }
        
        // Only crawl internal links
        if (href.startsWith(baseUrl) && !visited.has(href) && !href.includes('#')) {
          crawl(href, depth + 1);
        }
      });
    } catch (error) {
      console.error(`Error crawling ${url}:`, error.message);
    }
  }
  
  await crawl(baseUrl);
  console.log(`Discovered ${pages.length} pages by crawling`);
  return pages;
}

// Function to extract text content from HTML
function extractTextFromHtml(html, url) {
  const $ = cheerio.load(html);
  
  // Remove scripts, styles, and navigation
  $('script, style, nav, header, footer, .navigation').remove();
  
  // Get the main content
  let content = '';
  const contentSelectors = ['main', 'article', '.content', '.markdown-body', '#content', 'body'];
  
  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      content = element.text();
      break;
    }
  }
  
  if (!content) {
    content = $('body').text();
  }
  
  // Clean up whitespace
  content = content.replace(/\s+/g, ' ').trim();
  
  // Extract title
  let title = $('h1').first().text() || $('title').text() || url.split('/').pop();
  title = title.replace(/\s+/g, ' ').trim();
  
  return { title, content };
}

// Function to fetch all documentation
async function fetchDocumentation() {
  try {
    console.log('Fetching documentation from GitHub Pages...');
    
    if (!DOCS_BASE_URL) {
      throw new Error('DOCS_BASE_URL environment variable not set');
    }
    
    console.log(`Base URL: ${DOCS_BASE_URL}`);
    
    // Discover all pages
    const pageUrls = await discoverPages(DOCS_BASE_URL);
    
    if (pageUrls.length === 0) {
      console.warn('No pages discovered!');
      return [];
    }
    
    // Fetch content for each page
    const docs = await Promise.all(
      pageUrls.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          
          const html = await response.text();
          const { title, content } = extractTextFromHtml(html, url);
          
          return {
            url: url,
            title: title,
            content: content,
            path: url.replace(DOCS_BASE_URL, '') || '/'
          };
        } catch (error) {
          console.error(`Error fetching ${url}:`, error.message);
          return null;
        }
      })
    );
    
    return docs.filter(doc => doc !== null && doc.content.length > 0);
  } catch (error) {
    console.error('Error fetching documentation:', error);
    throw error;
  }
}

// Function to search documentation
function searchDocs(query, docs) {
  const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 2);
  
  if (searchTerms.length === 0) {
    searchTerms.push(query.toLowerCase());
  }
  
  const results = docs.map(doc => {
    let score = 0;
    const contentLower = doc.content.toLowerCase();
    const titleLower = doc.title.toLowerCase();
    
    searchTerms.forEach(term => {
      // Higher score for title matches
      if (titleLower.includes(term)) {
        score += 20;
      }
      
      // Score for content matches
      const matches = (contentLower.match(new RegExp(term, 'g')) || []).length;
      score += matches;
    });
    
    return { ...doc, score };
  })
  .filter(doc => doc.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);
  
  return results;
}

// Function to extract relevant snippet
function extractSnippet(content, query, maxLength = 250) {
  const words = content.split(' ');
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(' ').filter(term => term.length > 2);
  
  if (queryTerms.length === 0) {
    queryTerms.push(queryLower);
  }
  
  // Find first occurrence of any search term
  let bestIndex = -1;
  for (let i = 0; i < words.length; i++) {
    const wordLower = words[i].toLowerCase();
    if (queryTerms.some(term => wordLower.includes(term))) {
      bestIndex = i;
      break;
    }
  }
  
  if (bestIndex === -1) {
    return words.slice(0, 40).join(' ') + '...';
  }
  
  // Get context around the match
  const start = Math.max(0, bestIndex - 15);
  const end = Math.min(words.length, bestIndex + 25);
  let snippet = words.slice(start, end).join(' ');
  
  if (start > 0) snippet = '...' + snippet;
  if (end < words.length) snippet = snippet + '...';
  
  return snippet;
}

// Slash command handler for /product
app.command('/product', async ({ command, ack, say }) => {
  await ack();
  
  const query = command.text.trim();
  
  if (!query) {
    await say({
      text: 'Please provide a search query. Example: `/product authentication`',
      response_type: 'ephemeral'
    });
    return;
  }
  
  try {
    // Check cache and refresh if needed
    const now = Date.now();
    if (!docsCache.lastUpdated || (now - docsCache.lastUpdated) > CACHE_DURATION) {
      console.log('Refreshing documentation cache...');
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
            text: `*${index + 1}. ${result.title}*\n_${result.path}_`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${snippet}`
          },
          accessory: {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Page'
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
          text: `Found ${results.length} result(s) | <${DOCS_BASE_URL}|View all docs>`
        }
      ]
    });
    
    await say({
      blocks: blocks,
      text: `Search results for "${query}"`
    });
    
    console.log(`Handled search for: "${query}" - found ${results.length} results`);
    
  } catch (error) {
    console.error('Error handling /product command:', error);
    await say({
      text: `Sorry, there was an error searching the documentation: ${error.message}`,
      response_type: 'ephemeral'
    });
  }
});

// App home handler
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
              text: '*How to use:*\n• Type `/product [search query]` to search documentation\n• Example: `/product api authentication`\n\nDocumentation is synced from our GitHub Pages site.'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Documentation'
                },
                url: DOCS_BASE_URL || 'https://github.com',
                action_id: 'view_docs'
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

// Health check endpoint
const healthCheckApp = express();

healthCheckApp.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    docsLoaded: docsCache.data.length,
    lastUpdated: docsCache.lastUpdated ? new Date(docsCache.lastUpdated).toISOString() : 'never',
    docsUrl: DOCS_BASE_URL
  });
});

healthCheckApp.get('/', (req, res) => {
  res.send('Slack Documentation Bot is running! Use /product command in Slack.');
});

// Start the app
(async () => {
  const port = process.env.PORT || 3000;
  
  // Start health check server
  healthCheckApp.listen(port, () => {
    console.log(`🏥 Health check running at http://localhost:${port}/health`);
  });
  
  // Start Slack app
  await app.start();
  console.log(`⚡️ Slack Documentation Bot is running!`);
  
  // Preload documentation cache
  try {
    docsCache.data = await fetchDocumentation();
    docsCache.lastUpdated = Date.now();
    console.log(`✅ Loaded ${docsCache.data.length} documentation pages from ${DOCS_BASE_URL}`);
  } catch (error) {
    console.error('⚠️  Failed to preload documentation:', error.message);
    console.error('The bot will still start, but searches may fail until docs are loaded.');
  }
})();
