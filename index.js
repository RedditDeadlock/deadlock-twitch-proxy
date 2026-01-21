import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Get keys from Coolify Environment Variables
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// Validate environment variables on startup
if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing required environment variables: TWITCH_CLIENT_ID and/or TWITCH_CLIENT_SECRET');
    process.exit(1);
}

// Enable CORS for all origins (adjust as needed for production)
app.use(cors());

let tokenCache = { token: null, expiresAt: 0 };
let tokenRefreshPromise = null;
let streamCache = { data: null, expiresAt: 0 };

// 1. Helper to get Twitch Token (Caches it to save API calls)
async function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
        return tokenCache.token;
    }

    // Prevent race condition with multiple simultaneous requests
    if (tokenRefreshPromise) {
        return tokenRefreshPromise;
    }

    console.log("Refreshing Twitch Token...");
    tokenRefreshPromise = (async () => {
        try {
            const params = new URLSearchParams();
            params.append('client_id', CLIENT_ID);
            params.append('client_secret', CLIENT_SECRET);
            params.append('grant_type', 'client_credentials');

            const response = await fetch('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                body: params,
                signal: AbortSignal.timeout(10000) // 10 second timeout
            });

            if (!response.ok) {
                throw new Error(`Twitch auth failed with status ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.access_token) {
                console.error("Twitch Auth Failed:", data);
                throw new Error("Failed to auth with Twitch");
            }

            tokenCache.token = data.access_token;
            tokenCache.expiresAt = Date.now() + (data.expires_in * 1000) - 60000; // Expire 1 minute early
            return tokenCache.token;
        } finally {
            tokenRefreshPromise = null;
        }
    })();

    return tokenRefreshPromise;
}

// 2. The Public Endpoint the Bot will call
app.get('/streams', async (_req, res) => {
    try {
        // Return cached data if still valid (cache for 60 seconds)
        if (streamCache.data && Date.now() < streamCache.expiresAt) {
            return res.json(streamCache.data);
        }

        const token = await getAccessToken();

        // Game ID for Deadlock is 2132205352
        const streamRes = await fetch('https://api.twitch.tv/helix/streams?game_id=2132205352&first=5', {
            headers: {
                'Client-ID': CLIENT_ID,
                'Authorization': `Bearer ${token}`
            },
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!streamRes.ok) {
            throw new Error(`Twitch API returned status ${streamRes.status}`);
        }

        const data = await streamRes.json();
        const streams = data.data || [];

        // Cache the result for 60 seconds
        streamCache.data = streams;
        streamCache.expiresAt = Date.now() + 60000;

        res.json(streams);
    } catch (error) {
        console.error('Error fetching streams:', error);
        res.status(500).json({ error: 'Failed to fetch streams' });
    }
});

// 3. Debug endpoint to search for Deadlock game ID
app.get('/debug/game', async (_req, res) => {
    try {
        const token = await getAccessToken();
        
        // Try both "Deadlock" and by the slug
        const [nameRes, slugRes] = await Promise.all([
            fetch('https://api.twitch.tv/helix/games?name=Deadlock', {
                headers: {
                    'Client-ID': CLIENT_ID,
                    'Authorization': `Bearer ${token}`
                }
            }),
            fetch('https://api.twitch.tv/helix/games?igdb_id=322644', {
                headers: {
                    'Client-ID': CLIENT_ID,
                    'Authorization': `Bearer ${token}`
                }
            })
        ]);

        const nameData = await nameRes.json();
        const slugData = await slugRes.json();
        
        res.json({
            byName: nameData,
            byIGDB: slugData,
            note: "Check the 'id' field in the results above. That's what you need for game_id parameter."
        });
    } catch (error) {
        console.error('Error fetching game:', error);
        res.status(500).json({ error: 'Failed to fetch game info' });
    }
});

// 4. Health Check
app.get('/', (_req, res) => res.send('Deadlock Proxy is running!'));

app.listen(PORT, () => {
    console.log(`Proxy running on port ${PORT}`);
});