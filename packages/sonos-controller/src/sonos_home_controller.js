const upnp = require('./upnp');

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

  /**
   * Rank search results by relevance (exact match) and popularity.
   * Scoring: exact artist match (+50), exact track match (+50), popularity (0-100)
   */
  function rankSearchResults(tracks, query, artist, track) {
    const normalizedQuery = (query || '').toLowerCase().trim();
    const normalizedArtist = (artist || '').toLowerCase().trim();
    const normalizedTrack = (track || '').toLowerCase().trim();

    return tracks
      .map((t) => {
        let score = t.popularity || 0; // Spotify popularity score (0-100)

        const trackName = t.name.toLowerCase();
        const artistNames = t.artists.map((a) => a.name.toLowerCase());
        const primaryArtist = artistNames[0] || '';

        // Exact track name match bonus
        if (normalizedTrack && trackName === normalizedTrack) {
          score += 100;
        } else if (normalizedTrack && trackName.includes(normalizedTrack)) {
          score += 50;
        }

        // Exact artist match bonus
        if (normalizedArtist && artistNames.includes(normalizedArtist)) {
          score += 100;
        } else if (normalizedArtist && artistNames.some((a) => a.includes(normalizedArtist))) {
          score += 50;
        }

        // Free-form query matching (both artist and track name)
        if (normalizedQuery) {
          const fullTrackString = `${primaryArtist} ${trackName}`.toLowerCase();
          if (fullTrackString.includes(normalizedQuery)) {
            score += 30;
          }
          // Check if query contains track name
          if (normalizedQuery.includes(trackName)) {
            score += 40;
          }

          // Word-by-word matching: boost tracks with many matching query words
          const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 2); // Skip short words
          const trackWords = trackName.split(/\s+/);
          const fullWords = `${primaryArtist} ${trackName}`.split(/\s+/);
          
          let matchingWords = 0;
          for (const qWord of queryWords) {
            if (trackWords.some(tWord => tWord.includes(qWord) || qWord.includes(tWord))) {
              matchingWords++;
            } else if (fullWords.some(fWord => fWord.includes(qWord) || qWord.includes(fWord))) {
              matchingWords += 0.5; // Half credit for artist-only match
            }
          }
          
          if (matchingWords > 0) {
            score += matchingWords * 25; // Strong bonus per matching word
          }

          // Fuzzy matching: handle spacing variations (e.g., "newborn" vs "new born")
          const normalizedQueryNoSpaces = normalizedQuery.replace(/\s+/g, '');
          const trackNameNoSpaces = trackName.replace(/\s+/g, '');
          const fullStringNoSpaces = `${primaryArtist}${trackName}`.replace(/\s+/g, '');

          // Check if track name without spaces matches query
          if (trackNameNoSpaces === normalizedQueryNoSpaces) {
            score += 80; // Very high bonus for exact match ignoring spaces
          } else if (trackNameNoSpaces.includes(normalizedQueryNoSpaces)) {
            score += 50; // Good bonus for partial match ignoring spaces
          }

          // Check full string (artist + track) without spaces
          if (fullStringNoSpaces.includes(normalizedQueryNoSpaces)) {
            score += 40; // Bonus for spaceless match in full string
          }
        }

        return { ...t, relevanceScore: score };
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Search Spotify for an album and return its tracks.
   * @param {string} query - Album name (and optionally artist)
   * @param {string} artist - Optional artist name for disambiguation
   */
  async function searchSpotifyAlbum(query, artist = '') {
    const searchQuery = artist ? `${query} ${artist}` : query;
    console.log(`Searching Spotify for album: "${searchQuery}"`);

    try {
      const response = await spotifyApi.get('/search', {
        params: {
          q: searchQuery,
          type: 'album',
          limit: 5,
          market: 'GB',
        },
      });

      const albums = response.data.albums.items;
      if (!albums || albums.length === 0) {
        console.log('No albums found for query.');
        return null;
      }

      // Pick best match: prefer exact artist match
      let bestAlbum = albums[0];
      if (artist) {
        const artistLower = artist.toLowerCase();
        const exact = albums.find((a) =>
          a.artists.some((ar) => ar.name.toLowerCase().includes(artistLower)),
        );
        if (exact) bestAlbum = exact;
      }

      console.log(`Album matched: "${bestAlbum.name}" by ${bestAlbum.artists[0].name} [${bestAlbum.id}]`);

      // Fetch album tracks
      const tracksResponse = await spotifyApi.get(`/albums/${bestAlbum.id}/tracks`, {
        params: { limit: 50, market: 'GB' },
      });

      return {
        album: {
          id: bestAlbum.id,
          name: bestAlbum.name,
          artist: bestAlbum.artists[0].name,
          imageUrl: bestAlbum.images?.[0]?.url || '',
          totalTracks: bestAlbum.total_tracks,
        },
        tracks: tracksResponse.data.items,
      };
    } catch (err) {
      if (err.response && err.response.status === 401) {
        console.log('Spotify token expired, refreshing...');
        const refreshed = await refreshSpotifyToken();
        if (refreshed) return searchSpotifyAlbum(query, artist);
      }
      console.error('Album search error:', err.response ? err.response.data : err.message);
      throw err;
    }
  }

  /**
   * Search Spotify for tracks matching a query.
   * Returns ranked results preferring exact matches and popular tracks.
   */
  async function searchSpotify(query, options = {}) {
    const { artist, track, limit = 10 } = options;

    // Build search query - supports both free-form and structured searches
    let searchQuery = query || '';
    if (artist && track) {
      searchQuery = `artist:${artist} track:${track}`;
    } else if (artist) {
      searchQuery = `artist:${artist}`;
    } else if (track) {
      searchQuery = `track:${track}`;
    }

    if (!searchQuery.trim()) {
      console.error('Search error: No query provided.');
      return { tracks: [], bestMatch: null };
    }

    console.log(`Searching Spotify for: "${searchQuery}"`);

    try {
      const response = await spotifyApi.get('/search', {
        params: {
          q: searchQuery,
          type: 'track',
          limit,
          market: 'GB', // Use GB market for UK-based results
        },
      });

      const tracks = response.data.tracks.items;

      if (!tracks || tracks.length === 0) {
        console.log('No tracks found for query.');
        return { tracks: [], bestMatch: null };
      }

      // Rank tracks by relevance and popularity
      const rankedTracks = rankSearchResults(tracks, query, artist, track);

      console.log(
        `Found ${tracks.length} tracks. Best match: "${rankedTracks[0].name}" by ${rankedTracks[0].artists[0].name}`,
      );

      return {
        tracks: rankedTracks,
        bestMatch: rankedTracks[0],
      };
    } catch (err) {
      // If 401, try refreshing token and retry once
      if (err.response && err.response.status === 401) {
        console.log('Spotify token expired, refreshing...');
        const refreshed = await refreshSpotifyToken();
        if (refreshed) {
          return searchSpotify(query, options);
        }
      }
      const errorData = err.response ? err.response.data : err.message;
      console.error('Spotify search error:', JSON.stringify(errorData, null, 2));
      throw err;
    }
  }

  /**
   * Play a Spotify track on Sonos using UPnP/SOAP (direct speaker control).
   *
   * This bypasses the Sonos Cloud API which doesn't support arbitrary track playback.
   * Uses the same approach as node-sonos-http-api.
   *
   * @param {string} trackUri - Spotify URI (e.g., spotify:track:XXXXX)
   * @param {object} trackInfo - Track metadata for display
   */
  async function playSpotifyTrackOnSonos(trackUri, trackInfo = {}) {
    console.log(`Attempting to play Spotify track on Sonos via UPnP: ${trackUri}`);

    // Pause Spotify app playback to avoid conflicts
    await pauseSpotify();

    try {
      // Use UPnP to play the track directly on the speaker
      const result = await upnp.playSpotifyTrack(
        trackUri,
        {
          title: trackInfo.name || trackInfo.trackName || 'Unknown Track',
          artist: trackInfo.artist || 'Unknown Artist',
          album: trackInfo.album || 'Unknown Album',
          albumArtUri: trackInfo.imageUrl || trackInfo.albumArtUri || '',
        },
        30,
      ); // Set volume to 30

      if (result.success) {
        console.log(`Successfully started playback of "${trackInfo.name || trackUri}" via UPnP.`);
        return { success: true };
      }

      console.error('UPnP playback failed:', result.error);
      return { success: false, error: result.error };
    } catch (err) {
      console.error('Error playing Spotify track via UPnP:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Search and play: Combined function that searches Spotify and plays the best match.
   * Pass options.radio = true to auto-queue similar tracks via Spotify Radio after playing.
   */
  async function searchAndPlay(query, options = {}) {
    const { artist, track, radio = true } = options;

    console.log(
      `Search and play request: query="${query}", artist="${artist || ''}", track="${track || ''}", radio=${radio}`,
    );

    try {
      const searchResult = await searchSpotify(query, { artist, track });

      if (!searchResult.bestMatch) {
        return {
          success: false,
          error: 'No matching tracks found',
          query: { q: query, artist, track },
        };
      }

      const bestTrack = searchResult.bestMatch;
      const trackUri = bestTrack.uri; // e.g., spotify:track:XXXXX
      const trackName = `${bestTrack.name} by ${bestTrack.artists[0].name}`;

      console.log(
        `Best match: "${trackName}" (popularity: ${bestTrack.popularity}, relevance: ${bestTrack.relevanceScore})`,
      );

      // Pass full track info for UPnP metadata
      const trackInfo = {
        name: bestTrack.name,
        artist: bestTrack.artists[0].name,
        album: bestTrack.album?.name,
        imageUrl: bestTrack.album?.images?.[0]?.url,
      };

      // Use radio mode by default: plays track then auto-queues similar songs
      const playResult = radio
        ? await upnp.playSpotifyTrackWithRadio(trackUri, {
            title: trackInfo.name,
            artist: trackInfo.artist,
            album: trackInfo.album,
            albumArtUri: trackInfo.imageUrl,
          })
        : await playSpotifyTrackOnSonos(trackUri, trackInfo);

      return {
        success: playResult.success,
        track: {
          name: bestTrack.name,
          artist: bestTrack.artists[0].name,
          album: bestTrack.album?.name,
          uri: trackUri,
          popularity: bestTrack.popularity,
          relevanceScore: bestTrack.relevanceScore,
          imageUrl: bestTrack.album?.images?.[0]?.url,
        },
        alternatives: searchResult.tracks.slice(1, 5).map((t) => ({
          name: t.name,
          artist: t.artists[0].name,
          uri: t.uri,
        })),
        error: playResult.error,
      };
    } catch (err) {
      console.error('Search and play error:', err.message);
      return {
        success: false,
        error: err.message,
        query: { q: query, artist, track },
      };
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
          return res
            .status(400)
            .send('Invalid "volume" in request body. It must be a number between 0 and 100.');
        }
        console.log(`Received volume change request: ${volume}`);
        await setVolume(volume);
        return res.status(202).send(`Volume change request for '${volume}' accepted.`);
      });

      // Spotify search and play endpoint
      // Usage: POST /search?q=artist+song
      //    or: POST /search?artist=Muse&track=Starlight
      //    or: POST /search with JSON body { "q": "...", "artist": "...", "track": "..." }
      app.post('/search', async (req, res) => {
        // Accept query params OR JSON body
        const q = req.query.q || req.body?.q || '';
        const artist = req.query.artist || req.body?.artist || '';
        const track = req.query.track || req.body?.track || '';
        // radio=false to disable auto-queue; defaults to true
        const radioParam = req.query.radio ?? req.body?.radio;
        const radio = radioParam === 'false' || radioParam === false ? false : true;

        // Need at least one of: q, artist, or track
        if (!q && !artist && !track) {
          return res.status(400).json({
            success: false,
            error: 'Missing search params. Provide ?q=query or ?artist=X&track=Y or JSON body.',
            usage: {
              queryString: 'POST /search?q=artist+song',
              structured: 'POST /search?artist=Muse&track=Starlight',
              jsonBody: 'POST /search with body { "q": "muse starlight" }',
            },
          });
        }

        const logMsg = `Received search request: q="${q}", artist="${artist}", track="${track}", radio=${radio}`;
        console.log(logMsg);

        try {
          const result = await searchAndPlay(q, { artist, track, radio });
          if (result.success) {
            return res.status(200).json({
              success: true,
              message: `Now playing: ${result.track.name} by ${result.track.artist}`,
              track: result.track,
              alternatives: result.alternatives,
            });
          }
          return res.status(result.error === 'No matching tracks found' ? 404 : 500).json({
            success: false,
            error: result.error,
            query: result.query,
          });
        } catch (err) {
          console.error('Search endpoint error:', err);
          return res.status(500).json({
            success: false,
            error: err.message || 'Internal server error',
          });
        }
      });

      // Album search and play endpoint
      // Usage: POST /album?q=black+holes+and+revelations&artist=muse
      //    or: POST /album?q=black+holes+and+revelations+muse
      app.post('/album', async (req, res) => {
        const q = req.query.q || req.body?.q || '';
        const artist = req.query.artist || req.body?.artist || '';

        if (!q && !artist) {
          return res.status(400).json({
            success: false,
            error: 'Missing search params. Provide ?q=album+name or ?q=album+name&artist=Artist',
          });
        }

        console.log(`Album play request: q="${q}", artist="${artist}"`);

        try {
          const result = await searchSpotifyAlbum(q, artist);

          if (!result) {
            return res.status(404).json({ success: false, error: 'Album not found on Spotify' });
          }

          const { album, tracks } = result;
          const playResult = await upnp.playAlbum(tracks, album);

          if (playResult.success) {
            return res.status(200).json({
              success: true,
              message: `Now playing album: ${album.name} by ${album.artist} (${tracks.length} tracks)`,
              album,
              trackCount: tracks.length,
            });
          }

          return res.status(500).json({ success: false, error: playResult.error });
        } catch (err) {
          console.error('Album endpoint error:', err);
          return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
        }
      });

      // GET version of search for easy testing in browser
      app.get('/search', async (req, res) => {
        const { q, artist, track } = req.query;

        if (!q && !artist && !track) {
          return res.status(400).json({
            success: false,
            error: 'Missing search parameters',
            usage: 'GET /search?q=artist+song or GET /search?artist=X&track=Y',
          });
        }

        const qStr = q || '';
        const artistStr = artist || '';
        const trackStr = track || '';
        console.log(`Received GET search: q="${qStr}", artist="${artistStr}", track="${trackStr}"`);

        try {
          const result = await searchAndPlay(qStr, { artist, track });
          if (result.success) {
            return res.status(200).json({
              success: true,
              message: `Now playing: ${result.track.name} by ${result.track.artist}`,
              track: result.track,
              alternatives: result.alternatives,
            });
          }
          return res.status(result.error === 'No matching tracks found' ? 404 : 500).json({
            success: false,
            error: result.error,
            query: result.query,
          });
        } catch (err) {
          console.error('Search endpoint error:', err);
          return res.status(500).json({
            success: false,
            error: err.message || 'Internal server error',
          });
        }
      });

      // UPnP connectivity test endpoint
      app.get('/upnp/test', async (req, res) => {
        console.log('Testing UPnP connectivity to Sonos speaker...');
        try {
          const result = await upnp.testConnection();
          if (result.success) {
            return res.status(200).json({
              success: true,
              message: `UPnP connection to ${upnp.SONOS_SPEAKER_IP}:${upnp.SONOS_SPEAKER_PORT} successful`,
              speakerIp: upnp.SONOS_SPEAKER_IP,
            });
          }
          return res.status(500).json({
            success: false,
            error: result.error,
            speakerIp: upnp.SONOS_SPEAKER_IP,
            hint: 'Check SONOS_SPEAKER_IP environment variable',
          });
        } catch (err) {
          return res.status(500).json({
            success: false,
            error: err.message,
            speakerIp: upnp.SONOS_SPEAKER_IP,
          });
        }
      });

      // Direct UPnP play endpoint (for testing/debugging)
      app.post('/upnp/play', async (req, res) => {
        const {
          uri, title, artist, album,
        } = req.body;

        if (!uri || !uri.startsWith('spotify:track:')) {
          return res.status(400).json({
            success: false,
            error: 'Missing or invalid "uri" in request body. Must be spotify:track:XXXXX format.',
          });
        }

        console.log(`Direct UPnP play request: ${uri}`);

        try {
          const result = await upnp.playSpotifyTrack(uri, { title, artist, album }, 30);
          if (result.success) {
            return res.status(200).json({
              success: true,
              message: `Playing ${title || uri} via UPnP`,
            });
          }
          return res.status(500).json({
            success: false,
            error: result.error,
          });
        } catch (err) {
          return res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });

      app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
        console.log(`Server listening on http://0.0.0.0:${WEBHOOK_PORT} for dynamic webhooks.`);
        console.log(`Example Usage: POST http://<YOUR_IP>:${WEBHOOK_PORT}/play/Your_Favorite_Name`);
        console.log(`Example Usage: POST http://<YOUR_IP>:${WEBHOOK_PORT}/line-in`);
        console.log(`Example Usage: POST http://<YOUR_IP>:${WEBHOOK_PORT}/volume`);
        console.log(`Example Usage: POST http://<YOUR_IP>:${WEBHOOK_PORT}/search?q=muse+starlight`);
        console.log(
          `Example Usage: GET  http://<YOUR_IP>:${WEBHOOK_PORT}/search?artist=Muse&track=Starlight`,
        );
        console.log(`Example Usage: GET  http://<YOUR_IP>:${WEBHOOK_PORT}/upnp/test`);
        console.log(`Sonos UPnP endpoint: ${upnp.SONOS_SPEAKER_IP}:${upnp.SONOS_SPEAKER_PORT}`);
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
    // Spotify search functions
    searchSpotify,
    searchSpotifyAlbum,
    rankSearchResults,
    playSpotifyTrackOnSonos,
    searchAndPlay,
    // UPnP module (for direct speaker control)
    upnp,
  };
};
