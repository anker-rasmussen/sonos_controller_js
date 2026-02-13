/**
 * Tests for the UPnP module.
 */

const upnp = require('../src/upnp');

describe('UPnP Module', () => {
  describe('spotifyToSonosUri', () => {
    it('should convert a Spotify track URI to Sonos format', () => {
      const spotifyUri = 'spotify:track:4uLU6hMCjMI75M1A2tKUQC';
      const sonosUri = upnp.spotifyToSonosUri(spotifyUri);

      expect(sonosUri).toBe(
        'x-sonos-spotify:spotify%3Atrack%3A4uLU6hMCjMI75M1A2tKUQC?sid=9&flags=8224&sn=7',
      );
    });

    it('should throw an error for invalid Spotify URIs', () => {
      expect(() => upnp.spotifyToSonosUri('invalid-uri')).toThrow('Invalid Spotify URI format');
      expect(() => upnp.spotifyToSonosUri('spotify:album:123')).toThrow('Invalid Spotify URI format');
    });
  });

  describe('escapeXml', () => {
    it('should escape XML special characters', () => {
      expect(upnp.escapeXml('Hello & World')).toBe('Hello &amp; World');
      expect(upnp.escapeXml('<tag>')).toBe('&lt;tag&gt;');
      expect(upnp.escapeXml('"quotes"')).toBe('&quot;quotes&quot;');
      expect(upnp.escapeXml("'apostrophe'")).toBe('&apos;apostrophe&apos;');
    });

    it('should handle strings without special characters', () => {
      expect(upnp.escapeXml('Hello World')).toBe('Hello World');
    });
  });

  describe('buildSpotifyMetadata', () => {
    it('should build DIDL-Lite metadata for a Spotify track', () => {
      const metadata = upnp.buildSpotifyMetadata({
        title: 'Test Track',
        artist: 'Test Artist',
        album: 'Test Album',
        trackId: '4uLU6hMCjMI75M1A2tKUQC',
      });

      expect(metadata).toContain('Test Track');
      expect(metadata).toContain('Test Artist');
      expect(metadata).toContain('Test Album');
      expect(metadata).toContain('DIDL-Lite');
      expect(metadata).toContain('4uLU6hMCjMI75M1A2tKUQC');
    });

    it('should use defaults for missing track info', () => {
      const metadata = upnp.buildSpotifyMetadata({});

      expect(metadata).toContain('Unknown Track');
      expect(metadata).toContain('Unknown Artist');
      expect(metadata).toContain('Unknown Album');
    });
  });

  describe('module exports', () => {
    it('should export all required functions', () => {
      expect(typeof upnp.soapRequest).toBe('function');
      expect(typeof upnp.setAVTransportURI).toBe('function');
      expect(typeof upnp.play).toBe('function');
      expect(typeof upnp.stop).toBe('function');
      expect(typeof upnp.pause).toBe('function');
      expect(typeof upnp.setVolume).toBe('function');
      expect(typeof upnp.getTransportInfo).toBe('function');
      expect(typeof upnp.playSpotifyTrack).toBe('function');
      expect(typeof upnp.testConnection).toBe('function');
    });

    it('should export configuration constants', () => {
      expect(upnp.SONOS_SPEAKER_IP).toBeDefined();
      expect(upnp.SONOS_SPEAKER_PORT).toBe(1400);
    });
  });
});
