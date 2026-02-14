/**
 * UPnP/SOAP module for direct Sonos control.
 *
 * This bypasses the Sonos Cloud API and speaks directly to the speaker
 * using UPnP/SOAP protocol. Required for playing arbitrary Spotify tracks
 * that aren't in Sonos favorites.
 *
 * Reference: node-sonos-http-api uses the same approach.
 */

const http = require('http');

// Default Sonos speaker IP - can be overridden via environment
const SONOS_SPEAKER_IP = process.env.SONOS_SPEAKER_IP || '192.168.1.211';
const SONOS_SPEAKER_PORT = 1400;

/**
 * Send a SOAP request to the Sonos speaker.
 */
function soapRequest(endpoint, action, serviceType, body) {
  return new Promise((resolve, reject) => {
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

    const options = {
      hostname: SONOS_SPEAKER_IP,
      port: SONOS_SPEAKER_PORT,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soapEnvelope),
        SOAPAction: `"${serviceType}#${action}"`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, data });
        } else {
          reject(new Error(`SOAP request failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`SOAP request error: ${err.message}`));
    });

    req.write(soapEnvelope);
    req.end();
  });
}

/**
 * Escape XML special characters.
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert a Spotify track URI to Sonos-compatible format.
 * Input: spotify:track:4uLU6hMCjMI75M1A2tKUQC
 * Output: x-sonos-spotify:spotify%3atrack%3a4uLU6hMCjMI75M1A2tKUQC?sid=9&flags=8224&sn=7
 */
function spotifyToSonosUri(spotifyUri) {
  // Extract the track ID
  const match = spotifyUri.match(/spotify:track:([a-zA-Z0-9]+)/);
  if (!match) {
    throw new Error(`Invalid Spotify URI format: ${spotifyUri}`);
  }

  const trackId = match[1];
  // Encode the Spotify URI for Sonos
  const encodedUri = encodeURIComponent(`spotify:track:${trackId}`);

  // sid=12 is Spotify's service ID on this Sonos speaker
  // flags=8224 and sn=7 are standard for Spotify tracks
  return `x-sonos-spotify:${encodedUri}?sid=12&flags=8224&sn=7`;
}

/**
 * Build DIDL-Lite metadata for a Spotify track.
 * This tells Sonos how to display the track info.
 */
function buildSpotifyMetadata(trackInfo = {}) {
  const {
    title = 'Unknown Track',
    artist = 'Unknown Artist',
    album = 'Unknown Album',
    albumArtUri = '',
    trackId = '',
  } = trackInfo;

  // Build the resource URI
  const resourceUri = trackId
    ? `x-sonos-spotify:spotify%3atrack%3a${trackId}?sid=12&flags=8224&sn=7`
    : '';

  const didl = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
  <item id="00032020spotify%3atrack%3a${trackId}" parentID="" restricted="true">
    <dc:title>${escapeXml(title)}</dc:title>
    <upnp:class>object.item.audioItem.musicTrack</upnp:class>
    <dc:creator>${escapeXml(artist)}</dc:creator>
    <upnp:album>${escapeXml(album)}</upnp:album>
    ${albumArtUri ? `<upnp:albumArtURI>${escapeXml(albumArtUri)}</upnp:albumArtURI>` : ''}
    <res protocolInfo="sonos.com-spotify:*:audio/x-spotify:*">${escapeXml(resourceUri)}</res>
  </item>
</DIDL-Lite>`;

  return didl;
}

/**
 * Set the current track URI and start playing.
 * This is the main function to play a Spotify track via UPnP.
 */
async function setAVTransportURI(spotifyUri, trackInfo = {}) {
  const sonosUri = spotifyToSonosUri(spotifyUri);
  const metadata = buildSpotifyMetadata({
    ...trackInfo,
    trackId: spotifyUri.split(':')[2],
  });

  console.log(`[UPnP] Setting AVTransportURI to: ${sonosUri}`);

  const body = `
    <InstanceID>0</InstanceID>
    <CurrentURI>${escapeXml(sonosUri)}</CurrentURI>
    <CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>
  `;

  return soapRequest(
    '/MediaRenderer/AVTransport/Control',
    'SetAVTransportURI',
    'urn:schemas-upnp-org:service:AVTransport:1',
    body,
  );
}

/**
 * Start playback.
 */
async function play() {
  console.log('[UPnP] Sending Play command');

  const body = `
    <InstanceID>0</InstanceID>
    <Speed>1</Speed>
  `;

  return soapRequest(
    '/MediaRenderer/AVTransport/Control',
    'Play',
    'urn:schemas-upnp-org:service:AVTransport:1',
    body,
  );
}

/**
 * Stop playback.
 */
async function stop() {
  console.log('[UPnP] Sending Stop command');

  const body = '<InstanceID>0</InstanceID>';

  return soapRequest(
    '/MediaRenderer/AVTransport/Control',
    'Stop',
    'urn:schemas-upnp-org:service:AVTransport:1',
    body,
  );
}

/**
 * Pause playback.
 */
async function pause() {
  console.log('[UPnP] Sending Pause command');

  const body = '<InstanceID>0</InstanceID>';

  return soapRequest(
    '/MediaRenderer/AVTransport/Control',
    'Pause',
    'urn:schemas-upnp-org:service:AVTransport:1',
    body,
  );
}

/**
 * Set volume (0-100).
 */
async function setVolume(volume) {
  console.log(`[UPnP] Setting volume to ${volume}`);

  const body = `
    <InstanceID>0</InstanceID>
    <Channel>Master</Channel>
    <DesiredVolume>${volume}</DesiredVolume>
  `;

  return soapRequest(
    '/MediaRenderer/RenderingControl/Control',
    'SetVolume',
    'urn:schemas-upnp-org:service:RenderingControl:1',
    body,
  );
}

/**
 * Get current transport info (play state, etc.).
 */
async function getTransportInfo() {
  console.log('[UPnP] Getting transport info');

  const body = '<InstanceID>0</InstanceID>';

  return soapRequest(
    '/MediaRenderer/AVTransport/Control',
    'GetTransportInfo',
    'urn:schemas-upnp-org:service:AVTransport:1',
    body,
  );
}

/**
 * Play a Spotify track on Sonos via UPnP.
 * High-level function that combines setAVTransportURI + play.
 *
 * @param {string} spotifyUri - Spotify URI (e.g., spotify:track:4uLU6hMCjMI75M1A2tKUQC)
 * @param {object} trackInfo - Track metadata (title, artist, album, albumArtUri)
 * @param {number} volume - Optional volume level (0-100)
 */
async function playSpotifyTrack(spotifyUri, trackInfo = {}, volume = null) {
  try {
    // Set volume if specified
    if (volume !== null) {
      await setVolume(volume);
    }

    // Load the track
    await setAVTransportURI(spotifyUri, trackInfo);

    // Start playback
    await play();

    console.log(`[UPnP] Successfully started playing: ${trackInfo.title || spotifyUri}`);

    return { success: true };
  } catch (err) {
    console.error(`[UPnP] Error playing track: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Test UPnP connectivity to the Sonos speaker.
 */

/**
 * Convert a Spotify track URI to Sonos-compatible RADIO format.
 * Input: spotify:track:4uLU6hMCjMI75M1A2tKUQC
 * Output: x-sonos-spotify:spotify%3atrackradio%3a4uLU6hMCjMI75M1A2tKUQC?sid=12&flags=8224&sn=7
 */
function spotifyToSonosRadioUri(spotifyUri) {
  // Extract the track ID
  const match = spotifyUri.match(/spotify:track:([a-zA-Z0-9]+)/);
  if (!match) {
    throw new Error(`Invalid Spotify URI format: ${spotifyUri}`);
  }

  const trackId = match[1];
  // Encode for radio mode - use trackradio instead of track
  const encodedUri = encodeURIComponent(`spotify:trackradio:${trackId}`);

  return `x-sonos-spotify:${encodedUri}?sid=12&flags=8224&sn=7`;
}

/**
 * Play a Spotify track on Sonos via UPnP, then switch to radio mode.
 * This plays the track first, then switches to "track radio" for continuous playback.
 *
 * @param {string} spotifyUri - Spotify URI (e.g., spotify:track:4uLU6hMCjMI75M1A2tKUQC)
 * @param {object} trackInfo - Track metadata (title, artist, album, albumArtUri)
 * @param {number} volume - Optional volume level (0-100)
 */
async function playSpotifyTrackWithRadio(spotifyUri, trackInfo = {}, volume = null) {
  try {
    // Set volume if specified
    if (volume !== null) {
      await setVolume(volume);
    }

    // Load and play the requested track first
    await setAVTransportURI(spotifyUri, trackInfo);
    await play();

    console.log(`[UPnP] Successfully started playing: ${trackInfo.title || spotifyUri}`);

    // Switch to radio mode for continuous playback
    console.log('[UPnP] Switching to Spotify Radio mode for continuous playback...');
    
    // Wait 2 seconds for the track to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Convert to radio URI
    const radioUri = spotifyToSonosRadioUri(spotifyUri);
    const trackId = spotifyUri.split(':')[2];
    
    // Build radio metadata
    const radioMetadata = buildSpotifyMetadata({
      ...trackInfo,
      trackId: trackId,
      title: `${trackInfo.title} Radio`,
    });
    
    // Set the radio URI
    const body = `
      <InstanceID>0</InstanceID>
      <CurrentURI>${escapeXml(radioUri)}</CurrentURI>
      <CurrentURIMetaData>${escapeXml(radioMetadata)}</CurrentURIMetaData>
    `;
    
    await soapRequest(
      '/MediaRenderer/AVTransport/Control',
      'SetAVTransportURI',
      'urn:schemas-upnp-org:service:AVTransport:1',
      body,
    );
    
    // Play the radio
    await play();
    
    console.log('[UPnP] Now playing Spotify Radio - similar tracks will auto-queue');

    return { success: true };
  } catch (err) {
    console.error(`[UPnP] Error playing track with radio: ${err.message}`);
    return { success: false, error: err.message };
  }
}
async function testConnection() {
  try {
    console.log(`[UPnP] Testing connection to Sonos at ${SONOS_SPEAKER_IP}:${SONOS_SPEAKER_PORT}`);
    const result = await getTransportInfo();
    console.log('[UPnP] Connection successful!');
    return { success: true, data: result };
  } catch (err) {
    console.error(`[UPnP] Connection failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  // Low-level functions
  soapRequest,
  setAVTransportURI,
  play,
  stop,
  pause,
  setVolume,
  getTransportInfo,

  // High-level functions
  playSpotifyTrack,
  playSpotifyTrackWithRadio,
  testConnection,

  // Utilities
  spotifyToSonosUri,
  spotifyToSonosRadioUri,
  buildSpotifyMetadata,
  escapeXml,

  // Config
  SONOS_SPEAKER_IP,
  SONOS_SPEAKER_PORT,
};
