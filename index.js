import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Get keys from Coolify Environment Variables
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

let tokenCache = { token: null, expiresAt: 0 };

// 1. Helper to get Twitch Token (Caches it to save API calls)
async function getAccessToken() {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
        return tokenCache.token;
    }

    console.log("Refreshing Twitch Token...");
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('grant_type', 'client_credentials');

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: params
    });

    const data = await response.json();
    
    if (!data.access_token) {
        console.error("Twitch Auth Failed:", data);
        throw new Error("Failed to auth with Twitch");
    }

    tokenCache.token = data.access_token;
    tokenCache.expiresAt = Date.now() + (data.expires_in * 1000) - 60000; // Expire 1 minute early
    return tokenCache.token;
}

// 2. The Public Endpoint your Bot will call
app.get('/streams', async (req, res) => {
    try {
        const token = await getAccessToken();

        // Game ID for Deadlock is 322644
        const streamRes = await fetch('https://api.twitch.tv/helix/streams?game_id=322644&first=5', {
            headers: {
                'Client-ID': CLIENT_ID,
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await streamRes.json();
        res.json(data.data || []);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch streams' });
    }
});

// 3. Health Check
app.get('/', (req, res) => res.send('Deadlock Proxy is running!'));

app.listen(PORT, () => {
    console.log(`Proxy running on port ${PORT}`);
});