// sonos_home_controller.js
//
// This script runs a lightweight Node.js/Express web server.
// It listens for dynamic webhooks to play specific favorites from "My Sonos".
// Example Request: POST /play/upbeat-playlist -> Plays the "upbeat-playlist" favorite.

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const open = require('open');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION (from .env file) ---
const {
    SONOS_CLIENT_ID,
    SONOS_CLIENT_SECRET,
    SONOS_REDIRECT_URI,
    TARGET_DEVICE_NAME,
    ARRIVAL_DELAY_SECONDS, // A general delay applied to all requests
    SERVER_PORT
} = process.env;

// Basic validation to ensure required env vars are set
if (!SONOS_CLIENT_ID || !SONOS_CLIENT_SECRET || !TARGET_DEVICE_NAME) {
    console.error("FATAL ERROR: SONOS_CLIENT_ID, SONOS_CLIENT_SECRET, and TARGET_DEVICE_NAME must be set in the .env file.");
    process.exit(1);
}

// --- SCRIPT SETTINGS ---
const TOKEN_PATH = path.join(__dirname, '.sonos_tokens.json');
const AUTH_PORT = 8888;
const WEBHOOK_PORT = SERVER_PORT || 5001;
// Correctly parse the delay from seconds to milliseconds, with a default of 0.
const DELAY_MS = (parseInt(ARRIVAL_DELAY_SECONDS, 10) || 0) * 1000;
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
    const currentTokens = loadTokens();
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
        if (err.response && (err.response.status === 400 || err.response.status === 401)) {
            fs.unlinkSync(TOKEN_PATH);
            console.log("Invalid token file deleted.");
        }
        return false;
    }
}

/**
 * The core logic: waits for a delay, finds the speaker, finds the specified favorite, and plays it.
 * @param {string} favoriteName - The name of the favorite playlist to play.
 */
async function playFavoriteAfterDelay(favoriteName) {
    if (!favoriteName) {
        console.error("Playback error: No favorite name was provided.");
        return;
    }
    
    console.log(`Request received to play '${favoriteName}'. Waiting for ${DELAY_MS / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    console.log(`Wait finished. Attempting to play '${favoriteName}' on Sonos.`);

    try {
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

        console.log("Fetching 'My Sonos' favorites...");
        const { data: { items: favorites } } = await sonosApi.get(`/households/${householdId}/favorites`);
        
        if (!favorites || favorites.length === 0) {
            console.error("No favorites found in 'My Sonos'. Please add the desired playlist to your Sonos Favorites using the Sonos app.");
            return;
        }

        // Find the favorite matching the name from the URL parameter
        const targetFavorite = favorites.find(fav => fav.name.toLowerCase() === favoriteName.toLowerCase());

        if (!targetFavorite) {
            console.error(`Could not find a favorite named '${favoriteName}'.`);
            console.log("Available favorites:", favorites.map(fav => fav.name));
            return;
        }
        const favoriteId = targetFavorite.id;
        console.log(`Found target favorite '${targetFavorite.name}' with ID: ${favoriteId}`);

        console.log("Sending LOAD and PLAY command for favorite...");
        await sonosApi.post(`/groups/${groupId}/favorites`, {
            favoriteId: favoriteId,
            playOnCompletion: true,
            action: "REPLACE" // Replaces the current queue with the favorite.
        });
        
        console.log(`Successfully requested playback of favorite '${favoriteName}' on '${TARGET_DEVICE_NAME}'.`);

    } catch (err) {
        const errorData = err.response ? err.response.data : err.message;
        console.error('An error occurred during Sonos playback attempt:', JSON.stringify(errorData, null, 2));
    }
}

// --- WEB SERVER & AUTHENTICATION FLOW ---

/**
 * Handles the OAuth callback from Sonos.
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
        console.log('Sonos tokens found. Starting dynamic webhook server.');
        
        const initialTokens = loadTokens();
        const expiresIn = (initialTokens.expires_in || 3600) * 1000;
        setInterval(refreshToken, expiresIn * 0.9);

        // NEW: Dynamic route to handle different playlists
        app.post('/play/:favoriteName', (req, res) => {
            const favoriteName = req.params.favoriteName;
            console.log(`Received webhook trigger for favorite: ${favoriteName}`);
            // Replace spaces, underscores, etc. from URL encoding if necessary
            const cleanedName = favoriteName.replace(/%20/g, ' ').replace(/_/g, ' ');
            playFavoriteAfterDelay(cleanedName);
            res.status(202).send(`Webhook for '${cleanedName}' accepted. Processing playback request.`);
        });

        app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
            console.log(`Server listening on http://0.0.0.0:${WEBHOOK_PORT} for dynamic webhooks.`);
            console.log(`Example Usage: POST http://<YOUR_PI_IP>:${WEBHOOK_PORT}/play/Your_Favorite_Name`);
        });
    }
}

main().catch(error => {
    console.error("An unexpected error occurred in main:", error);
});
