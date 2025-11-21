const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

if (!OPENAI_API_KEY) {
    console.warn('Warning: OPENAI_API_KEY is not set. Set it in your environment before starting the server.');
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
        return respond(res, 204, null, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    }

    if (req.method === 'POST' && url.pathname === '/api/agentflow') {
        try {
            const body = await readBody(req);
            const request = JSON.parse(body || '{}');

            if (!OPENAI_API_KEY) {
                return respond(res, 500, { error: 'Server missing OPENAI_API_KEY. Set it in your environment.' });
            }

            const apiResponse = await fetch(OPENAI_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify(request)
            });

            const data = await apiResponse.json();

            if (!apiResponse.ok) {
                return respond(res, apiResponse.status, { error: data.error || data });
            }

            const messageContent = data.choices?.[0]?.message?.content;
            const content = normalizeContent(messageContent);
            return respond(res, 200, { content });
        } catch (error) {
            console.error('Proxy error:', error);
            return respond(res, 500, { error: 'Unexpected server error.' });
        }
    }

    if (req.method === 'POST' && url.pathname === '/api/summarize') {
        try {
            const body = await readBody(req);
            const { url: targetUrl } = JSON.parse(body || '{}');
            if (!targetUrl) {
                return respond(res, 400, { error: 'Missing url' });
            }
            const parsed = new URL(targetUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return respond(res, 400, { error: 'Invalid URL protocol' });
            }

            const pageText = await fetchTextWithLimit(targetUrl, 15000);
            const trimmed = stripHtml(pageText).slice(0, 8000);

            const summaryReq = {
                model: 'gpt-4o-mini',
                temperature: 0.3,
                messages: [
                    {
                        role: 'system',
                        content: 'Summarize the business website content in <=120 words. Focus on products/services, target audience, regions served, and value proposition. Avoid fluff and ignore navigation/footer text.'
                    },
                    { role: 'user', content: trimmed || 'No content found.' }
                ]
            };

            const apiResponse = await fetch(OPENAI_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify(summaryReq)
            });

            const data = await apiResponse.json();
            if (!apiResponse.ok) {
                return respond(res, apiResponse.status, { error: data.error || data });
            }

            const messageContent = data.choices?.[0]?.message?.content;
            const summary = normalizeContent(messageContent);
            return respond(res, 200, { summary });
        } catch (error) {
            console.error('Summarize error:', error);
            return respond(res, 500, { error: 'Unexpected server error.' });
        }
    }

    if (req.method === 'GET') {
        return serveStatic(url, res);
    }

    respond(res, 404, { error: 'Not found' });
});

// Bind to 0.0.0.0 for Cloud Run/containers.
server.listen(PORT, '0.0.0.0', () => {
    console.log(`AgentFlow API proxy listening on http://0.0.0.0:${PORT}`);
});

function respond(res, status, body, extraHeaders = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        ...extraHeaders
    };
    res.writeHead(status, headers);
    if (body !== null && body !== undefined) {
        res.end(JSON.stringify(body));
    } else {
        res.end();
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            if (data.length > 1e6) { // ~1MB guardrail
                req.connection.destroy();
                reject(new Error('Request too large'));
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function serveStatic(url, res) {
    const routes = {
        '/': path.join(__dirname, 'index.html'),
        '/index.html': path.join(__dirname, 'index.html'),
        '/styles.css': path.join(__dirname, 'styles.css'),
        '/agentflow.js': path.join(__dirname, 'agentflow.js')
    };

    const filePath = routes[url.pathname];
    if (!filePath) {
        respond(res, 404, { error: 'Not found' });
        return;
    }

    const ext = path.extname(filePath);
    const typeMap = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
    const contentType = typeMap[ext] || 'text/plain';

    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    } catch (error) {
        console.error('Static serve error:', error);
        respond(res, 500, { error: 'Failed to load file.' });
    }
}

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    raw.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const idx = trimmed.indexOf('=');
        if (idx === -1) return;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
            process.env[key] = value;
        }
    });
}

function normalizeContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        // Handle chat content parts if the API returns an array of segments
        return content
            .map(part => {
                if (typeof part === 'string') return part;
                if (part?.text) return part.text;
                if (part?.content?.text) return part.content.text;
                return typeof part === 'object' ? JSON.stringify(part) : String(part);
            })
            .join('\n')
            .trim();
    }
    // Fallback: stringify objects
    return JSON.stringify(content, null, 2);
}

async function fetchTextWithLimit(targetUrl, limit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
        const response = await fetch(targetUrl, { signal: controller.signal, headers: { 'User-Agent': 'AgentFlow/1.0' } });
        if (!response.ok) {
            throw new Error(`Fetch failed ${response.status}`);
        }
        const text = await response.text();
        return text.slice(0, limit);
    } finally {
        clearTimeout(timeout);
    }
}

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
