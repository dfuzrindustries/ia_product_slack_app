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
  
  // Normalize base URL - remove trailing slash
  baseUrl = baseUrl.replace(/\/$/, '');
  
  console.log(`\n=== Starting page discovery for: ${baseUrl} ===`);
  
  // Try to fetch sitemap.xml first
  try {
    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    console.log(`Checking for sitemap at: ${sitemapUrl}`);
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
        console.log(`✅ Found ${pages.length} pages from sitemap`);
        return pages;
      }
    } else {
      console.log(`No sitemap found (${response.status}), will crawl instead`);
    }
  } catch (error) {
    console.log(`Sitemap check failed: ${error.message}, will crawl instead`);
  }
  
  // Fallback: crawl the site
  async function crawl(url, depth = 0) {
    if (depth > 5 || visited.has(url)) {
      if (depth > 5) console.log(`⚠️  Max depth reached at: ${url}`);
      return;
    }
    visited.add(url);
    
    try {
      console.log(`\n[Depth ${depth}] Crawling: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`  ❌ Failed to fetch (${response.status})`);
        return;
      }
      
      const html = await response.text();
      const $ = cheerio.load(html);
      
      pages.push(url);
      console.log(`  ✅ Added page #${pages.length}`);
      
      // Find all internal links
      const allLinks = [];
      $('a[href]').each((_, elem) => {
        const href = $(elem).attr('href');
        if (href) allLinks.push(href);
      });
      
      console.log(`  📎 Found ${allLinks.length} total links on this page`);
      
      const links = [];
      allLinks.forEach(href => {
        const original = href;
        
        // Parse the base URL to get origin and path
        const baseUrlObj = new URL(baseUrl);
        const baseOrigin = baseUrlObj.origin; // https://dfuzrindustries.github.io
        const basePath = baseUrlObj.pathname; // /ia-customer-lifecycle-md/
        
        // Convert relative URLs to absolute
        if (href.startsWith('/')) {
          // Absolute path from root - use origin + href
          href = baseOrigin + href;
        } else if (href.startsWith('./')) {
          // Relative to current directory
          href = url.substring(0, url.lastIndexOf('/')) + href.substring(1);
        } else if (href.startsWith('../')) {
          // Handle parent directory references
          const urlParts = url.split('/');
          urlParts.pop(); // remove current page
          const upLevels = (href.match(/\.\.\//g) || []).length;
          for (let i = 0; i < upLevels; i++) {
            urlParts.pop();
          }
          href = urlParts.join('/') + '/' + href.replace(/\.\.\//g, '');
        } else if (!href.startsWith('http')) {
          // Relative path - append to current URL directory
          const currentDir = url.endsWith('/') ? url : url.substring(0, url.lastIndexOf('/') + 1);
          href = currentDir + href;
        }
        
        // Remove trailing slashes and fragments for comparison
        const cleanHref = href.replace(/\/$/, '').split('#')[0];
        const cleanBase = baseUrl.replace(/\/$/, '');
        
        // Filter logic
        if (!cleanHref.startsWith(cleanBase)) {
          console.log(`    ⊘ Skipped (external): ${original} → ${href}`);
          return;
        }
        if (visited.has(cleanHref)) {
          console.log(`    ⊘ Skipped (visited): ${original}`);
          return;
        }
        if (href.includes('#') && href.split('#')[0] === url.split('#')[0]) {
          console.log(`    ⊘ Skipped (same page anchor): ${original}`);
          return;
        }
        
        console.log(`    ✓ Will crawl: ${original} → ${cleanHref}`);
        links.push(cleanHref);
      });
      
      console.log(`  🔗 ${links.length} links to crawl at next depth`);
      
      // Crawl links sequentially
      for (const link of links) {
        await crawl(link, depth + 1);
      }
    } catch (error) {
      console.error(`  ❌ Error crawling ${url}:`, error.message);
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
  .slice(0, 5); // Top 5 results with detailed snippets
  
  return results;
}

// Function to extract relevant snippets with context
function extractSnippets(content, query, maxSnippets = 3) {
  const words = content.split(/\s+/);
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(' ').filter(term => term.length > 2);
  
  if (queryTerms.length === 0) {
    queryTerms.push(queryLower);
  }
  
  const snippets = [];
  const usedIndices = new Set();
  
  // Find all occurrences of search terms
  for (let i = 0; i < words.length; i++) {
    const wordLower = words[i].toLowerCase();
    
    // Check if this word contains any search term
    const matchedTerm = queryTerms.find(term => wordLower.includes(term));
    
    if (matchedTerm && !usedIndices.has(i)) {
      // Extract 10 words before and 10 words after
      const start = Math.max(0, i - 10);
      const end = Math.min(words.length, i + 11); // +11 to include the matched word
      
      // Mark these indices as used to avoid duplicate snippets
      for (let j = start; j < end; j++) {
        usedIndices.add(j);
      }
      
      let snippet = words.slice(start, end).join(' ');
      
      // Add ellipsis if not at document boundaries
      if (start > 0) snippet = '...' + snippet;
      if (end < words.length) snippet = snippet + '...';
      
      // Bold the matched word (Slack markdown uses *)
      // Escape special regex characters in the matched word
      const matchedWord = words[i];
      const escapedWord = matchedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      snippet = snippet.replace(
        new RegExp(`\\b${escapedWord}\\b`, 'gi'), 
        `*${matchedWord}*`
      );
      
      snippets.push(snippet);
      
      if (snippets.length >= maxSnippets) break;
    }
  }
  
  // If no matches found, return beginning of content
  if (snippets.length === 0) {
    const snippet = words.slice(0, 20).join(' ') + '...';
    snippets.push(snippet);
  }
  
  return snippets;
}

// Slash command handler for /product
app.command('/product', async ({ command, ack, respond }) => {
  await ack();
  
  const query = command.text.trim();
  
  if (!query) {
    await respond({
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
    
    console.log(`Searching ${docsCache.data.length} pages for: "${query}"`);
    
    // Search documentation
    const results = searchDocs(query, docsCache.data);
    
    console.log(`Search returned ${results.length} results`);
    
    if (results.length === 0) {
      await respond({
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
      const snippets = extractSnippets(result.content, query, 3);
      
      // Format the page title and URL
      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${index + 1}. ${result.title}*\n<${result.url}|View page →>`
          }
        }
      );
      
      // Add each snippet as a separate section
      snippets.forEach((snippet, idx) => {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `>${snippet}`
          }
        });
      });
      
      blocks.push({
        type: 'divider'
      });
    });
    
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Found ${results.length} relevant page${results.length === 1 ? '' : 's'} • Searched ${docsCache.data.length} total pages`
        }
      ]
    });
    
    await respond({
      blocks: blocks,
      text: `Search results for "${query}"`
    });
    
    console.log(`Handled search for: "${query}" - found ${results.length} results`);
    
  } catch (error) {
    console.error('Error handling /product command:', error);
    await respond({
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
    console.log(`\n✅ Successfully loaded ${docsCache.data.length} documentation pages from ${DOCS_BASE_URL}`);
    console.log(`\nPage titles loaded:`);
    docsCache.data.slice(0, 10).forEach((doc, i) => {
      console.log(`  ${i + 1}. ${doc.title} (${doc.url})`);
    });
    if (docsCache.data.length > 10) {
      console.log(`  ... and ${docsCache.data.length - 10} more pages`);
    }
  } catch (error) {
    console.error('⚠️  Failed to preload documentation:', error.message);
    console.error('The bot will still start, but searches may fail until docs are loaded.');
  }
})();
