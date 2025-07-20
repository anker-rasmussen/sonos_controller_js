// sonos_home_controller.js
//
// This script runs a lightweight Node.js/Express web server.
// It listens for a webhook to detect when you arrive home.
// After a specified delay, it uses the Sonos Control API to play a
// playlist from your "My Sonos" favorites on a designated speaker.

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const open = require('open');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION (from .env file) ---
// NOTE: You must now use FAVORITE_PLAYLIST_NAME instead of PLAYLIST_URI
const {
    SONOS_CLIENT_ID,
    SONOS_CLIENT_SECRET,
    SONOS_REDIRECT_URI,
    TARGET_DEVICE_NAME,
    FAVORITE_PLAYLIST_NAME, 
    ARRIVAL_DELAY_SECONDS,
    SERVER_PORT
} = process.env;

// Basic validation to ensure required env vars are set
if (!SONOS_CLIENT_ID || !SONOS_CLIENT_SECRET || !TARGET_DEVICE_NAME || !FAVORITE_PLAYLIST_NAME) {
    console.error("FATAL ERROR: SONOS_CLIENT_ID, SONOS_CLIENT_SECRET, TARGET_DEVICE_NAME, and FAVORITE_PLAYLIST_NAME must be set in the .env file.");
    process.exit(1);
}

// --- SCRIPT SETTINGS ---
const TOKEN_PATH = path.join(__dirname, '.sonos_tokens.json');
const AUTH_PORT = 8888;
const WEBHOOK_PORT = SERVER_PORT || 5001;
const DELAY_MS = ARRIVAL_DELAY_SECONDS;
const REDIRECT_URI = SONOS_REDIRECT_URI || `http://localhost:${AUTH_PORT}/callback`;

const app = express();
// The base URL for the Sonos Control API.
let sonosApi = axios.create({ baseURL: 'https://api.ws.sonos.com/control/api/v1' });

/**
 * Saves tokens to a local file.
 * @param {object} tokens - The token object from Sonos.
 */
function saveTokens(tokens) {
    try {
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log('Tokens saved to .sonos_tokens.json');
    } catch (err) {
        console.error("Error saving tokens:", err);
    }
}

/**
 * Loads tokens from a local file, validates scope, and configures the axios instance.
 * @returns {object|null} The loaded tokens or null if not found/invalid.
 */
function loadTokens() {
    if (!fs.existsSync(TOKEN_PATH)) {
        return null;
    }
    try {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

        // VALIDATION: Check if the loaded token has the required scope.
        if (!tokens.scope || !tokens.scope.includes('playback-control-all')) {
            console.error("Error: Stored token has an invalid or missing scope. Deleting it to force re-authentication.");
            fs.unlinkSync(TOKEN_PATH); // Delete invalid token file.
            return null;
        }

        sonosApi.defaults.headers.common['Authorization'] = `Bearer ${tokens.access_token}`;
        console.log('Sonos tokens loaded from file with valid scope.');
        return tokens;
    } catch (err) {
        console.error("Error loading or parsing token file. It might be corrupted.", err);
        // Attempt to delete the corrupted file to allow for a clean start.
        try {
            fs.unlinkSync(TOKEN_PATH);
        } catch (deleteErr) {
            console.error("Error deleting corrupted token file:", deleteErr);
        }
        return null;
    }
}

/**
 * Refreshes the access token using the refresh token.
 * @returns {Promise<boolean>} - True if the refresh was successful, false otherwise.
 */
async function refreshToken() {
    console.log('Refreshing Sonos token...');
    const currentTokens = loadTokens(); // Use loadTokens to ensure we have valid tokens to start with
    if (!currentTokens || !currentTokens.refresh_token) {
        console.error("No valid refresh token found. Cannot refresh. Please re-authenticate.");
        return false;
    }

    const authHeader = 'Basic ' + Buffer.from(`${SONOS_CLIENT_ID}:${SONOS_CLIENT_SECRET}`).toString('base64');

    try {
        const response = await axios.post('https://api.sonos.com/login/v3/oauth/access', new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: currentTokens.refresh_token
        }), {
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const newTokens = response.data;
        saveTokens(newTokens);
        sonosApi.defaults.headers.common['Authorization'] = `Bearer ${newTokens.access_token}`;
        console.log('Sonos token refreshed successfully.');
        return true;
    } catch (err) {
        console.error('Could not refresh Sonos token. You may need to re-authenticate.', err.response ? err.response.data : err.message);
        // If refresh fails (e.g., token revoked), delete the old token file to force re-auth.
        if (err.response && (err.response.status === 400 || err.response.status === 401)) {
            fs.unlinkSync(TOKEN_PATH);
            console.log("Invalid token file deleted.");
        }
        return false;
    }
}

/**
 * The core logic: wait, find the speaker, find the favorite, and play music.
 */
async function playMusicAfterDelay() {
    console.log(`Arrival detected. Waiting for ${DELAY_MS / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    console.log("Wait finished. Attempting to play music on Sonos.");

    try {
        // Refreshing the token right before we use it is a robust pattern.
        const refreshed = await refreshToken();
        if (!refreshed) {
            console.error("Aborting playback due to token refresh failure.");
            return;
        }

        console.log("Fetching Sonos households...");
        const { data: { households } } = await sonosApi.get('/households');
        if (!households || households.length === 0) {
            console.error("No Sonos households found on this account.");
            return;
        }
        const householdId = households[0].id;
        console.log(`Found household ID: ${householdId}`);

        console.log("Fetching groups/speakers in household...");
        const { data: { groups } } = await sonosApi.get(`/households/${householdId}/groups`);
        const targetGroup = groups.find(g => g.name.toLowerCase() === TARGET_DEVICE_NAME.toLowerCase());

        if (!targetGroup) {
            console.warn(`Could not find a Sonos speaker or group named '${TARGET_DEVICE_NAME}'.`);
            console.log("Available groups:", groups.map(g => g.name));
            return;
        }
        const groupId = targetGroup.id;
        console.log(`Found target group '${targetGroup.name}' with ID: ${groupId}`);

        // --- REFACTORED LOGIC: PLAY FROM "MY SONOS" FAVORITES ---

        console.log("Fetching 'My Sonos' favorites...");
        const { data: { items: favorites } } = await sonosApi.get(`/households/${householdId}/favorites`);
        
        if (!favorites || favorites.length === 0) {
            console.error("No favorites found in 'My Sonos'. Please add the desired playlist to your Sonos Favorites using the Sonos app.");
            return;
        }

        const targetFavorite = favorites.find(fav => fav.name.toLowerCase() === FAVORITE_PLAYLIST_NAME.toLowerCase());

        if (!targetFavorite) {
            console.error(`Could not find a favorite named '${FAVORITE_PLAYLIST_NAME}'.`);
            console.log("Available favorites:", favorites.map(fav => fav.name));
            return;
        }
        const favoriteId = targetFavorite.id;
        console.log(`Found target favorite '${targetFavorite.name}' with ID: ${favoriteId}`);

        console.log("Sending LOAD and PLAY command for favorite...");
        // This is the correct API call to play an item from "My Sonos".
        await sonosApi.post(`/groups/${groupId}/favorites`, {
            favoriteId: favoriteId,
            playOnCompletion: true,
            action: "REPLACE" // Replaces the current queue with the favorite.
        });
        
        console.log(`Successfully requested playback of favorite '${FAVORITE_PLAYLIST_NAME}' on '${TARGET_DEVICE_NAME}'.`);

    } catch (err) {
        const errorData = err.response ? err.response.data : err.message;
        console.error('An error occurred during Sonos playback attempt:', JSON.stringify(errorData, null, 2));
    }
}

// --- WEB SERVER & AUTHENTICATION FLOW ---

/**
 * Handles the OAuth callback from Sonos, exchanges the code for tokens.
 */
const handleSonosCallback = async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.status(400).send("<h1>Error</h1><p>No authorization code provided in the callback.</p>");
    }

    console.log("Received authorization code, exchanging for tokens...");
    const authHeader = 'Basic ' + Buffer.from(`${SONOS_CLIENT_ID}:${SONOS_CLIENT_SECRET}`).toString('base64');

    try {
        const response = await axios.post('https://api.sonos.com/login/v3/oauth/access', new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
        }), { 
            headers: { 
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded'
            } 
        });
        
        saveTokens(response.data);
        sonosApi.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;

        res.send('<h1>Success!</h1><p>Sonos authentication complete. The server is ready. You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script>');
        console.log('Sonos authentication successful! Restarting server in operational mode...');
        
        // Exit gracefully so the process manager (like PM2) can restart it in webhook mode.
        setTimeout(() => process.exit(0), 1000); 
    } catch (err) {
        console.error("Error exchanging code for Sonos tokens:", err.response ? err.response.data : err.message);
        res.status(500).send("<h1>Error</h1><p>Could not get Sonos tokens. Check the console for details.</p>");
    }
};

/**
 * Main function to initialize and start the appropriate server.
 */
async function main() {
    if (!loadTokens()) {
        // --- FIRST-TIME AUTH MODE ---
        const authUrl = `https://api.sonos.com/login/v3/oauth?client_id=${SONOS_CLIENT_ID}&response_type=code&state=sonos-auth&scope=playback-control-all&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
        
        console.log('--- FIRST-TIME SONOS SETUP ---');
        console.log('No valid tokens found. Starting authentication server.');
        console.log('Please visit this URL to authorize the application with your Sonos account:');
        console.log(authUrl);

        const authApp = express();
        authApp.get('/callback', handleSonosCallback);
        authApp.listen(AUTH_PORT, () => {
            console.log(`Listening on http://localhost:${AUTH_PORT} for Sonos callback...`);
            open(authUrl);
        });
    } else {
        // --- NORMAL WEBHOOK MODE ---
        console.log('Sonos tokens found. Starting webhook server.');
        
        // Schedule a token refresh well before it expires.
        const initialTokens = loadTokens();
        const expiresIn = (initialTokens.expires_in || 3600) * 1000;
        setInterval(refreshToken, expiresIn * 0.9); // Refresh at 90% of expiry time.

        app.post('/webhook/arrive', (req, res) => {
            console.log("Received an arrival webhook trigger.");
            playMusicAfterDelay(); // This is asynchronous, no need to await it here.
            res.status(202).send("Webhook accepted. Processing playback request.");
        });

        app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
            console.log(`Server listening on http://0.0.0.0:${WEBHOOK_PORT} for webhooks.`);
        });
    }
}

main().catch(error => {
    console.error("An unexpected error occurred in main:", error);
});
