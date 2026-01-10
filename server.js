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

// Configuration for your GitHub Pages sites
const DOCS_SITES = [
  {
    title: 'Customer Lifecycle',
    url: 'https://dfuzrindustries.github.io/ia-customer-lifecycle-md'
  },
  {
    title: 'Frameworks & References',
    url: 'https://dfuzrindustries.github.io/ia-frameworks-and-references-md'
  }
];

// Cache for documentation
let docsCache = {
  sites: [], // Will store: [{ title, url, pages: [...] }, ...]
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
  
  // Remove scripts, styles, navigation, and common doc site elements
  $('script, style, nav, header, footer, .navigation, .navbar, .menu, .sidebar, .toc, .breadcrumb, .page-header, .page-footer').remove();
  
  // Get the main content
  let content = '';
  const contentSelectors = ['main', 'article', '.content', '.markdown-body', '#content', '.post-content', '.doc-content', 'body'];
  
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
  
  // Remove common navigation patterns specific to this site
  content = content.replace(/ia-customer-lifecycle-md\s+M1\s+M2\s+M3\s+Day 1\s+POC\s+Pilot\s+Program\s+Partnership/gi, '');
  content = content.replace(/Back to Home\s+M1\s+M2\s+M3\s+Day 1\s+POC\s+Pilot\s+Program\s+Partnership/gi, '');
  
  // Clean up multiple spaces after removals
  content = content.replace(/\s+/g, ' ').trim();
  
  // Extract title - first try to get it from PAGE_TITLE comment
  let title = '';
  const pageTitleMatch = html.match(/<!--\s*PAGE_TITLE:\s*(.+?)\s*-->/i);
  if (pageTitleMatch) {
    title = pageTitleMatch[1].trim();
    console.log(`  📄 Found PAGE_TITLE comment: "${title}"`);
  } else {
    // Fall back to H1 or title tag
    title = $('h1').first().text() || $('title').text() || url.split('/').pop();
  }
  
  title = title.replace(/\s+/g, ' ').trim();
  
  // Remove navigation text from title
  title = title.replace(/ia-customer-lifecycle-md\s+M1\s+M2\s+M3\s+Day 1\s+POC\s+Pilot\s+Program\s+Partnership/gi, '').trim();
  title = title.replace(/Back to Home\s+M1\s+M2\s+M3\s+Day 1\s+POC\s+Pilot\s+Program\s+Partnership/gi, '').trim();
  
  return { title, content };
}

// Function to fetch all documentation from all sites
async function fetchDocumentation() {
  try {
    console.log('Fetching documentation from all GitHub Pages sites...');
    
    const sites = [];
    
    for (const site of DOCS_SITES) {
      console.log(`\n=== Fetching ${site.title} ===`);
      
      // Discover all pages for this site
      const pageUrls = await discoverPages(site.url);
      
      if (pageUrls.length === 0) {
        console.warn(`No pages discovered for ${site.title}!`);
        continue;
      }
      
      // Fetch content for each page
      const pages = await Promise.all(
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
              path: url.replace(site.url, '') || '/'
            };
          } catch (error) {
            console.error(`Error fetching ${url}:`, error.message);
            return null;
          }
        })
      );
      
      const validPages = pages.filter(page => page !== null && page.content.length > 0);
      
      sites.push({
        title: site.title,
        url: site.url,
        pages: validPages
      });
      
      console.log(`✅ Loaded ${validPages.length} pages for ${site.title}`);
    }
    
    return sites;
  } catch (error) {
    console.error('Error fetching documentation:', error);
    throw error;
  }
}

// Slash command handler for /product - displays directory of all docs
app.command('/product', async ({ command, ack, respond }) => {
  await ack();
  
  try {
    // Check cache and refresh if needed
    const now = Date.now();
    if (!docsCache.lastUpdated || (now - docsCache.lastUpdated) > CACHE_DURATION) {
      console.log('Refreshing documentation cache...');
      docsCache.sites = await fetchDocumentation();
      docsCache.lastUpdated = now;
    }
    
    // Build directory listing
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📚 Product Documentation Directory'
        }
      },
      {
        type: 'divider'
      }
    ];
    
    // Add each site's pages
    docsCache.sites.forEach((site, siteIndex) => {
      // Site title
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${site.title}*`
        }
      });
      
      // Page list
      if (site.pages.length === 0) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '_No pages found_'
          }
        });
      } else {
        // Format pages as a bulleted list with links
        const pageList = site.pages
          .map(page => `• <${page.url}|${page.title}>`)
          .join('\n');
        
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: pageList
          }
        });
      }
      
      // Add spacing between sites (unless it's the last one)
      if (siteIndex < docsCache.sites.length - 1) {
        blocks.push({
          type: 'divider'
        });
      }
    });
    
    // Footer
    const totalPages = docsCache.sites.reduce((sum, site) => sum + site.pages.length, 0);
    blocks.push(
      {
        type: 'divider'
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${docsCache.sites.length} documentation sites • ${totalPages} total pages`
          }
        ]
      }
    );
    
    await respond({
      blocks: blocks,
      text: 'Product Documentation Directory'
    });
    
    console.log(`Displayed directory with ${totalPages} pages across ${docsCache.sites.length} sites`);
    
  } catch (error) {
    console.error('Error handling /product command:', error);
    await respond({
      text: `Sorry, there was an error loading the documentation directory: ${error.message}`,
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
              text: '*How to use:*\n• Type `/product` to view the documentation directory\n• All pages from multiple documentation sites organized in one place\n\nDocumentation is automatically synced from GitHub Pages.'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Customer Lifecycle'
                },
                url: 'https://dfuzrindustries.github.io/ia-customer-lifecycle-md',
                action_id: 'view_docs_1'
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Frameworks & References'
                },
                url: 'https://dfuzrindustries.github.io/ia-frameworks-and-references-md',
                action_id: 'view_docs_2'
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
  const totalPages = docsCache.sites ? docsCache.sites.reduce((sum, site) => sum + site.pages.length, 0) : 0;
  res.status(200).json({
    status: 'ok',
    sitesLoaded: docsCache.sites ? docsCache.sites.length : 0,
    totalPages: totalPages,
    lastUpdated: docsCache.lastUpdated ? new Date(docsCache.lastUpdated).toISOString() : 'never',
    sites: DOCS_SITES.map(s => s.title)
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
    docsCache.sites = await fetchDocumentation();
    docsCache.lastUpdated = Date.now();
    
    const totalPages = docsCache.sites.reduce((sum, site) => sum + site.pages.length, 0);
    console.log(`\n✅ Successfully loaded ${totalPages} pages from ${docsCache.sites.length} documentation sites`);
    
    console.log(`\nSites loaded:`);
    docsCache.sites.forEach((site, i) => {
      console.log(`  ${i + 1}. ${site.title} - ${site.pages.length} pages`);
      site.pages.slice(0, 5).forEach((page, j) => {
        console.log(`     • ${page.title}`);
      });
      if (site.pages.length > 5) {
        console.log(`     ... and ${site.pages.length - 5} more pages`);
      }
    });
  } catch (error) {
    console.error('⚠️  Failed to preload documentation:', error.message);
    console.error('The bot will still start, but the directory may be empty until docs are loaded.');
  }
})();
