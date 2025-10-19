module.exports = (dependencies) => {
  const {
    axios, fs, open, express, path, dotenv,
  } = dependencies;

  dotenv.config();

  const {
    SONOS_CLIENT_ID,
    SONOS_CLIENT_SECRET,
    SONOS_REDIRECT_URI,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI,
    TARGET_DEVICE_NAME,
    ARRIVAL_DELAY_SECONDS,
    SERVER_PORT,
  } = process.env;

  if (!SONOS_CLIENT_ID || !SONOS_CLIENT_SECRET || !TARGET_DEVICE_NAME) {
    console.error(
      'FATAL ERROR: SONOS_CLIENT_ID, SONOS_CLIENT_SECRET, and TARGET_DEVICE_NAME must be set in the .env file.',
    );
    process.exit(1);
  }

  const SONOS_TOKEN_PATH = path.join(__dirname, '.sonos_tokens.json');
  const SPOTIFY_TOKEN_PATH = path.join(__dirname, '.spotify_tokens.json');
  const AUTH_PORT = 8888;
  const WEBHOOK_PORT = SERVER_PORT || 5001;
  const DELAY_MS = (parseInt(ARRIVAL_DELAY_SECONDS, 10) || 0) * 1000;
  const SONOS_REDIRECT_URI_FULL = SONOS_REDIRECT_URI || `http://localhost:${AUTH_PORT}/sonos_callback`;
  const SPOTIFY_REDIRECT_URI_FULL = SPOTIFY_REDIRECT_URI || `http://localhost:${AUTH_PORT}/spotify_callback`;

  const app = express();
  app.use(express.json());
  const sonosApi = axios.create({ baseURL: 'https://api.ws.sonos.com/control/api/v1' });
  const spotifyApi = axios.create({ baseURL: 'https://api.spotify.com/v1' });

  function saveSonosTokens(tokens) {
    try {
      fs.writeFileSync(SONOS_TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('Sonos tokens saved to .sonos_tokens.json');
    } catch (err) {
      console.error('Error saving Sonos tokens:', err);
    }
  }

  function saveSpotifyTokens(tokens) {
    try {
      fs.writeFileSync(SPOTIFY_TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('Spotify tokens saved to .spotify_tokens.json');
    } catch (err) {
      console.error('Error saving Spotify tokens:', err);
    }
  }

  function loadSonosTokens() {
    if (!fs.existsSync(SONOS_TOKEN_PATH)) {
      return null;
    }
    try {
      const tokens = JSON.parse(fs.readFileSync(SONOS_TOKEN_PATH, 'utf8'));
      if (!tokens.scope || !tokens.scope.includes('playback-control-all')) {
        console.error(
          'Error: Stored Sonos token has an invalid or missing scope. Deleting it to force re-authentication.',
        );
        fs.unlinkSync(SONOS_TOKEN_PATH);
        return null;
      }
      sonosApi.defaults.headers.common.Authorization = `Bearer ${tokens.access_token}`;
      console.log('Sonos tokens loaded from file with valid scope.');
      return tokens;
    } catch (err) {
      console.error('Error loading or parsing Sonos token file. It might be corrupted.', err);
      try {
        fs.unlinkSync(SONOS_TOKEN_PATH);
      } catch (deleteErr) {
        console.error('Error deleting corrupted Sonos token file:', deleteErr);
      }
      return null;
    }
  }

  function loadSpotifyTokens() {
    if (!fs.existsSync(SPOTIFY_TOKEN_PATH)) {
      return null;
    }
    try {
      const tokens = JSON.parse(fs.readFileSync(SPOTIFY_TOKEN_PATH, 'utf8'));
      spotifyApi.defaults.headers.common.Authorization = `Bearer ${tokens.access_token}`;
      console.log('Spotify tokens loaded from file.');
      return tokens;
    } catch (err) {
      console.error('Error loading or parsing Spotify token file. It might be corrupted.', err);
      try {
        fs.unlinkSync(SPOTIFY_TOKEN_PATH);
      } catch (deleteErr) {
        console.error('Error deleting corrupted Spotify token file:', deleteErr);
      }
      return null;
    }
  }

  async function refreshSonosToken() {
    console.log('Refreshing Sonos token...');
    const currentTokens = loadSonosTokens();
    if (!currentTokens || !currentTokens.refresh_token) {
      console.error('No valid Sonos refresh token found. Cannot refresh. Please re-authenticate.');
      return false;
    }

    const authHeader = `Basic ${Buffer.from(`${SONOS_CLIENT_ID}:${SONOS_CLIENT_SECRET}`).toString('base64')}`;

    try {
      const response = await axios.post(
        'https://api.sonos.com/login/v3/oauth/access',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: currentTokens.refresh_token,
        }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const newTokens = response.data;
      saveSonosTokens(newTokens);
      sonosApi.defaults.headers.common.Authorization = `Bearer ${newTokens.access_token}`;
      console.log('Sonos token refreshed successfully.');
      return true;
    } catch (err) {
      console.error(
        'Could not refresh Sonos token. You may need to re-authenticate.',
        err.response ? err.response.data : err.message,
      );
      if (err.response && (err.response.status === 400 || err.response.status === 401)) {
        fs.unlinkSync(SONOS_TOKEN_PATH);
        console.log('Invalid Sonos token file deleted.');
      }
      return false;
    }
  }

  async function refreshSpotifyToken() {
    console.log('Refreshing Spotify token...');
    const currentTokens = loadSpotifyTokens();
    if (!currentTokens || !currentTokens.refresh_token) {
      console.error('No valid Spotify refresh token found. Cannot refresh. Please re-authenticate.');
      return false;
    }

    const authHeader = `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`;

    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: currentTokens.refresh_token,
        }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const newTokens = { ...currentTokens, ...response.data };
      saveSpotifyTokens(newTokens);
      spotifyApi.defaults.headers.common.Authorization = `Bearer ${newTokens.access_token}`;
      console.log('Spotify token refreshed successfully.');
      return true;
    } catch (err) {
      console.error(
        'Could not refresh Spotify token. You may need to re-authenticate.',
        err.response ? err.response.data : err.message,
      );
      if (err.response && (err.response.status === 400 || err.response.status === 401)) {
        fs.unlinkSync(SPOTIFY_TOKEN_PATH);
        console.log('Invalid Spotify token file deleted.');
      }
      return false;
    }
  }

  async function pauseSpotify() {
    console.log('Attempting to pause Spotify...');
    try {
      await spotifyApi.put('/me/player/pause');
      console.log('Successfully paused Spotify.');
    } catch (err) {
      const errorData = err.response ? err.response.data : err.message;
      if (err.response && err.response.status === 404) {
        console.log('No active Spotify device found to pause.');
      } else {
        console.error(
          'An error occurred during Spotify pause attempt:',
          JSON.stringify(errorData, null, 2),
        );
      }
    }
  }

  async function getSonosGroup() {
    const sonosRefreshed = await refreshSonosToken();
    if (!sonosRefreshed) {
      console.error('Aborting due to Sonos token refresh failure.');
      return null;
    }

    console.log('Fetching Sonos households...');
    const {
      data: { households },
    } = await sonosApi.get('/households');
    if (!households || households.length === 0) {
      console.error('No Sonos households found on this account.');
      return null;
    }
    const householdId = households[0].id;
    console.log(`Found household ID: ${householdId}`);

    console.log('Fetching groups/speakers in household...');
    const {
      data: { groups },
    } = await sonosApi.get(`/households/${householdId}/groups`);
    const targetGroup = groups.find(
      (g) => g.name.toLowerCase() === TARGET_DEVICE_NAME.toLowerCase(),
    );

    if (!targetGroup) {
      console.warn(`Could not find a Sonos speaker or group named '${TARGET_DEVICE_NAME}'.`);
      console.log(
        'Available groups:',
        groups.map((g) => g.name),
      );
      return null;
    }
    const groupId = targetGroup.id;
    console.log(`Found target group '${targetGroup.name}' with ID: ${groupId}`);
    return { householdId, groupId };
  }

  async function setVolume(volume) {
    console.log(`Attempting to set volume to ${volume}...`);
    try {
      const group = await getSonosGroup();
      if (!group) {
        console.error('Could not get Sonos group. Aborting volume change.');
        return;
      }
      const { groupId } = group;
      await sonosApi.post(`/groups/${groupId}/groupVolume`, { volume });
      console.log(`Successfully set volume to ${volume}.`);
    } catch (err) {
      const errorData = err.response ? err.response.data : err.message;
      console.error(
        'An error occurred during volume change attempt:',
        JSON.stringify(errorData, null, 2),
      );
    }
  }

  async function playFavoriteAfterDelay(favoriteName) {
    if (!favoriteName) {
      console.error('Playback error: No favorite name was provided.');
      return;
    }

    console.log(
      `Request received to play '${favoriteName}'. Pausing Spotify and waiting for ${DELAY_MS / 1000} seconds...`,
    );

    await pauseSpotify();
    await new Promise((resolve) => {
      setTimeout(resolve, DELAY_MS);
    });

    console.log(`Wait finished. Attempting to play '${favoriteName}' on Sonos.`);

    try {
      const group = await getSonosGroup();
      if (!group) {
        console.error('Could not get Sonos group. Aborting playback.');
        return;
      }
      const { householdId, groupId } = group;
      await sonosApi.post(`/groups/${groupId}/groupVolume`, { volume: 30 });

      console.log("Fetching 'My Sonos' favorites...");
      const {
        data: { items: favorites },
      } = await sonosApi.get(`/households/${householdId}/favorites`);

      if (!favorites || favorites.length === 0) {
        console.error(
          "No favorites found in 'My Sonos'. Please add the desired playlist to your Sonos Favorites using the Sonos app.",
        );
        return;
      }

      const targetFavorite = favorites.find(
        (fav) => fav.name.toLowerCase() === favoriteName.toLowerCase(),
      );

      if (!targetFavorite) {
        console.error(`Could not find a favorite named '${favoriteName}'.`);
        console.log(
          'Available favorites:',
          favorites.map((fav) => fav.name),
        );
        return;
      }
      const favoriteId = targetFavorite.id;
      console.log(`Found target favorite '${targetFavorite.name}' with ID: ${favoriteId}`);

      console.log('Sending LOAD and PLAY command for favorite...');
      await sonosApi.post(`/groups/${groupId}/favorites`, {
        favoriteId,
        playOnCompletion: true,
        action: 'REPLACE',
      });

      console.log(
        `Successfully requested playback of favorite '${favoriteName}' on '${TARGET_DEVICE_NAME}'.`,
      );
    } catch (err) {
      const errorData = err.response ? err.response.data : err.message;
      console.error(
        'An error occurred during Sonos playback attempt:',
        JSON.stringify(errorData, null, 2),
      );
    }
  }

  async function switchToLineIn() {
    console.log('Request received to switch to Line-In. Pausing Spotify...');

    await pauseSpotify();

    console.log('Attempting to switch to Line-In on Sonos.');

    try {
      const group = await getSonosGroup();
      if (!group) {
        console.error('Could not get Sonos group. Aborting switch to Line-In.');
        return;
      }
      const { groupId } = group;

      console.log('Pausing current playback...');
      await sonosApi.post(`/groups/${groupId}/playback/pause`);

      console.log('Sending command to switch to Line-In...');
      await sonosApi.post(`/groups/${groupId}/playback/lineIn`);
      await sonosApi.post(`/groups/${groupId}/playback/play`);

      console.log(`Successfully requested switch to Line-In on '${TARGET_DEVICE_NAME}'.`);
    } catch (err) {
      const errorData = err.response ? err.response.data : err.message;
      console.error(
        'An error occurred during the switch to Line-In attempt:',
        JSON.stringify(errorData, null, 2),
      );
    }
  }

  const handleSonosCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res
        .status(400)
        .send('<h1>Error</h1><p>No authorization code provided in the Sonos callback.</p>');
    }

    console.log('Received Sonos authorization code, exchanging for tokens...');
    const authHeader = `Basic ${Buffer.from(`${SONOS_CLIENT_ID}:${SONOS_CLIENT_SECRET}`).toString('base64')}`;

    try {
      const response = await axios.post(
        'https://api.sonos.com/login/v3/oauth/access',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: SONOS_REDIRECT_URI_FULL,
        }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      saveSonosTokens(response.data);
      sonosApi.defaults.headers.common.Authorization = `Bearer ${response.data.access_token}`;

      res.send(
        '<h1>Success!</h1><p>Sonos authentication complete. You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script>',
      );
      console.log('Sonos authentication successful! Please restart the server.');
      return res;
    } catch (err) {
      console.error(
        'Error exchanging code for Sonos tokens:',
        err.response ? err.response.data : err.message,
      );
      return res
        .status(500)
        .send('<h1>Error</h1><p>Could not get Sonos tokens. Check the console for details.</p>');
    }
  };

  const handleSpotifyCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res
        .status(400)
        .send('<h1>Error</h1><p>No authorization code provided in the Spotify callback.</p>');
    }

    console.log('Received Spotify authorization code, exchanging for tokens...');
    const authHeader = `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`;

    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: SPOTIFY_REDIRECT_URI_FULL,
        }),
        {
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      saveSpotifyTokens(response.data);
      spotifyApi.defaults.headers.common.Authorization = `Bearer ${response.data.access_token}`;

      res.send(
        '<h1>Success!</h1><p>Spotify authentication complete. You can close this window.</p><script>setTimeout(() => window.close(), 2000);</script>',
      );
      console.log('Spotify authentication successful! Please restart the server.');
      return res;
    } catch (err) {
      console.error(
        'Error exchanging code for Spotify tokens:',
        err.response ? err.response.data : err.message,
      );
      return res
        .status(500)
        .send('<h1>Error</h1><p>Could not get Spotify tokens. Check the console for details.</p>');
    }
  };

  async function main() {
    const sonosTokens = loadSonosTokens();
    const spotifyTokens = loadSpotifyTokens();

    if (!sonosTokens || !spotifyTokens) {
      const authApp = express();
      authApp.get('/sonos_callback', handleSonosCallback);
      authApp.get('/spotify_callback', handleSpotifyCallback);

      authApp.listen(AUTH_PORT, () => {
        console.log(`Authentication server listening on http://localhost:${AUTH_PORT}`);
        if (!sonosTokens) {
          // prettier-ignore
          // eslint-disable-next-line max-len
          const sonosAuthUrl = `https://api.sonos.com/login/v3/oauth?client_id=${SONOS_CLIENT_ID}&response_type=code&state=sonos-auth&scope=playback-control-all&redirect_uri=${encodeURIComponent(SONOS_REDIRECT_URI_FULL)}`;
          console.log('--- FIRST-TIME SONOS SETUP ---');
          console.log('Please visit this URL to authorize with Sonos:');
          console.log(sonosAuthUrl);
          open(sonosAuthUrl);
        }
        if (!spotifyTokens) {
          // prettier-ignore
          // eslint-disable-next-line max-len
          const spotifyAuthUrl = `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI_FULL)}&scope=user-modify-playback-state`;
          console.log('--- FIRST-TIME SPOTIFY SETUP ---');
          console.log('Please visit this URL to authorize with Spotify:');
          console.log(spotifyAuthUrl);
          if (sonosTokens) open(spotifyAuthUrl);
        }
      });
    } else {
      console.log('Sonos and Spotify tokens found. Starting dynamic webhook server.');

      const sonosExpiresIn = (sonosTokens.expires_in || 3600) * 1000;
      setInterval(refreshSonosToken, sonosExpiresIn * 0.9);

      const spotifyExpiresIn = (spotifyTokens.expires_in || 3600) * 1000;
      setInterval(refreshSpotifyToken, spotifyExpiresIn * 0.9);

      app.post('/play/:favoriteName', (req, res) => {
        const { favoriteName } = req.params;
        console.log(`Received webhook trigger for favorite: ${favoriteName}`);
        const cleanedName = favoriteName.replace(/%20/g, ' ').replace(/_/g, ' ');
        playFavoriteAfterDelay(cleanedName);
        // prettier-ignore
        // eslint-disable-next-line max-len
        res.status(202).send(`Webhook for '${cleanedName}' accepted. Processing playback request.`);
      });

      app.post('/line-in', (req, res) => {
        console.log('Received webhook trigger for line-in.');
        switchToLineIn();
        res.status(202).send('Webhook for line-in accepted. Processing switch request.');
      });

      app.post('/volume', async (req, res) => {
        const { volume } = req.body;
        if (volume === undefined || typeof volume !== 'number' || volume < 0 || volume > 100) {
          return res.status(400).send('Invalid "volume" in request body. It must be a number between 0 and 100.');
        }
        console.log(`Received volume change request: ${volume}`);
        await setVolume(volume);
        res.status(202).send(`Volume change request for '${volume}' accepted.`);
      });

      app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
        console.log(`Server listening on http://0.0.0.0:${WEBHOOK_PORT} for dynamic webhooks.`);
        console.log(`Example Usage: POST http://<YOUR_IP>:${WEBHOOK_PORT}/play/Your_Favorite_Name`);
        console.log(`Example Usage: POST http://<YOUR_IP>:${WEBHOOK_PORT}/line-in`);
        console.log(`Example Usage: POST http://<YOUR_IP>:${WEBHOOK_PORT}/volume`);
      });
    }
  }

  return {
    saveSonosTokens,
    saveSpotifyTokens,
    loadSonosTokens,
    loadSpotifyTokens,
    refreshSonosToken,
    refreshSpotifyToken,
    pauseSpotify,
    playFavoriteAfterDelay,
    switchToLineIn,
    handleSonosCallback,
    handleSpotifyCallback,
    main,
    getSonosGroup,
    setVolume,
  };
};