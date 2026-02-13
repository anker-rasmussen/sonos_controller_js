# Dynamic Sonos Player Via api/webhooks....

### What?? TLDR:

### RESTful api style, send a POST request http://ip-address-of-server:5001/play/{playlist_name}

### See below for steps to setup. If you do not have a domain, use [ngrok](https://ngrok.com/)

This Node.js application runs on a Raspberry Pi (or any persistent server) and provides a simple, local API to play any of your "My Sonos" favorites on a designated speaker.

It works by running a small web server that listens for dynamic webhooks. You can trigger these webhooks from any service that can make an HTTP request, such as Apple's Shortcuts app, Home Assistant, or a cron job. This allows you to create various automations, like playing a specific playlist upon arriving home, starting a morning playlist at a set time, or triggering soundscapes on demand.

This version uses the official Sonos Control API, which is more reliable than third-party methods.

## Features

- **Spotify Integration**: Automatically pauses any currently playing Spotify track before playing a Sonos favorite. This is necessary because the Sonos speaker will not play if Spotify is currently playing from it.
- **🆕 Spotify Search**: Search for any track on Spotify and play it on Sonos via the `/search` endpoint. Perfect for voice assistants and automation.
- **Dynamic Playback**: Play any of your "My Sonos" favorites by including its name in the request URL (e.g., `/play/Upbeat_Morning`).
- **Direct Sonos Control**: Uses the official Sonos API for robust and reliable playback.
- **Automation Ready**: Designed to be triggered by any webhook-capable service for endless automation possibilities.
- **Configurable Delay**: A built-in global delay can be set to prevent music from starting instantly.
- **Speaker Targeting**: You can specify the exact Sonos speaker or group name (e.g., "Living Room").
- **Persistent & Robust**: Designed to run continuously as a systemd service, with automatic token refreshing.
- **Secure**: Keeps your secret credentials out of the code using a `.env` file.

## Requirements

- A Raspberry Pi or other always-on computer running a Linux distribution with systemd.
- Node.js (v16 or higher).
- A Sonos system.
- A Spotify Premium account.

## Setup Instructions

### 1. Sonos Developer Account & Control Integration

First, you need to register an application with Sonos to get API credentials.

1.  Go to the [Sonos Developer Portal](https://developer.sonos.com/) and create an account.
2.  Once logged in, go to "Control Integrations" and click "Create a new control integration".
3.  Fill out the required fields. For "User-facing name," you can enter something like "Home Automation Controller."
4.  Under "Control & Authentication," configure the following:
    - **Redirect URIs**: Add `http://localhost:8888/sonos_callback`. This must be exact.
    - **Event Callback URL**: You can leave this blank.
5.  Click "Save."
6.  You will now see your **Key (Client ID)** and **Secret (Client Secret)** on the integration's page. You will need these for your `.env` file.

### 2. Spotify Developer Account & App Creation

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click "Create an App".
3. Give your app a name and description.
4. Under "Redirect URIs", add `http://localhost:8888/spotify_callback`.
5. You will now see your **Client ID** and **Client Secret**. You will need these for your `.env` file.

### 3. Project Setup on Raspberry Pi

1.  Clone or download the project files into a directory on your Pi.
    ```bash
    # Example:
    mkdir -p /home/pi/sonos_controller
    cd /home/pi/sonos_controller
    # (Then add the project files to this directory)
    ```
2.  Create your environment file from the example.
    ```bash
    cp .env.example .env
    ```
3.  Edit the `.env` file and fill in your details. You must provide your `SONOS_CLIENT_ID`, `SONOS_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `TARGET_DEVICE_NAME`.
    ```bash
    nano .env
    ```
4.  Install dependencies.
    ```bash
    npm install express dotenv open axios
    ```
5.  **First-Time Authentication**: Run the script once to authorize it with your Sonos and Spotify households.

    ```bash
    node sonos_home_controller.js
    ```

    - A URL will be printed in the console. A browser window should open automatically.
    - If not, copy the URL and paste it into a browser.
    - Log in to your Sonos and Spotify accounts and grant the permissions.
    - You'll be redirected to a "Success!" page. The script will save `.sonos_tokens.json` and `.spotify_tokens.json` files and exit. Your app is now authenticated.

### 4. Automation Setup (Apple Shortcuts Example)

Using your phone's Wi-Fi connection is a reliable trigger for a "home arrival" automation. You can create multiple automations for different scenarios.

1.  On your Pi, find its local IP address with `hostname -I`.
2.  On your iPhone, open the **Shortcuts** app -> **Automation** tab.
3.  Create a **New Personal Automation**. For a home arrival trigger, select "Wi-Fi" and choose your home network.
4.  Add the action **"Get Contents of URL"**.
5.  Set the URL to `http://<YOUR_PI_LOCAL_IP>:<PORT>/play/<YOUR_FAVORITE_NAME>`.
    - Replace `<YOUR_PI_LOCAL_IP>` with your Pi's IP address (e.g., `192.168.1.50`).
    - Replace `<PORT>` with the port from your `.env` file (e.g., `5001`).
    - Replace `<YOUR_FAVORITE_NAME>` with the exact name of the favorite you want to play (e.g., `Classical%20in%20the%20Background`). Spaces should be URL-encoded as `%20`, but the Shortcuts app often handles this automatically.
6.  Expand the options and set the **Method** to **POST**.
7.  Turn **OFF** "Ask Before Running."

**Example Automations:**

- **Home Arrival:** Triggered by Wi-Fi, URL: `http://192.168.1.50:5001/play/Classical%20in%20the%20Background`
- **Morning Playlist:** Triggered by "Time of Day" (e.g., 8 AM), URL: `http://192.168.1.50:5001/play/Upbeat%20Morning`

## API Reference

### `POST /play/:favoriteName`

Play a "My Sonos" favorite by name.

```bash
curl -X POST http://192.168.1.50:5001/play/daylist
```

### `POST /search` - Spotify Search & Play

Search Spotify for a track and play the best match on Sonos. Supports multiple query formats for flexibility.

#### Query Parameters

| Parameter | Description                                     | Example             |
| --------- | ----------------------------------------------- | ------------------- |
| `q`       | Free-form search query (artist + song combined) | `?q=muse+starlight` |
| `artist`  | Artist name filter                              | `?artist=Muse`      |
| `track`   | Track name filter                               | `?track=Starlight`  |

You can combine parameters: `?artist=Muse&track=Starlight`

#### JSON Body (Alternative)

```json
{
  "q": "muse starlight",
  "artist": "Muse",
  "track": "Starlight"
}
```

#### Examples

```bash
# Simple free-form search
curl -X POST "http://192.168.1.50:5001/search?q=muse+starlight"

# Structured search with artist and track
curl -X POST "http://192.168.1.50:5001/search?artist=Muse&track=Starlight"

# JSON body
curl -X POST http://192.168.1.50:5001/search \
  -H "Content-Type: application/json" \
  -d '{"q": "bohemian rhapsody"}'

# GET request (for browser testing)
curl "http://192.168.1.50:5001/search?q=queen+bohemian+rhapsody"
```

#### Response

**Success (200)**:

```json
{
  "success": true,
  "message": "Now playing: Starlight by Muse",
  "track": {
    "name": "Starlight",
    "artist": "Muse",
    "album": "Black Holes and Revelations",
    "uri": "spotify:track:3skn2lauGk7Dx6bVIt5DVj",
    "popularity": 82,
    "relevanceScore": 232,
    "imageUrl": "https://i.scdn.co/image/..."
  },
  "alternatives": [
    { "name": "Starlight - Live", "artist": "Muse", "uri": "spotify:track:..." },
    { "name": "Starlight (Acoustic)", "artist": "Muse", "uri": "spotify:track:..." }
  ]
}
```

**Not Found (404)**:

```json
{
  "success": false,
  "error": "No matching tracks found",
  "query": { "q": "nonexistent song xyz" }
}
```

#### Ranking Algorithm

Results are ranked by a combined score:

- **Popularity** (0-100): Spotify's track popularity score
- **Exact track match** (+100): Track name exactly matches query
- **Partial track match** (+50): Track name contains query
- **Exact artist match** (+100): Artist name exactly matches query
- **Partial artist match** (+50): Artist name contains query

### `POST /line-in`

Switch to Line-In input.

```bash
curl -X POST http://192.168.1.50:5001/line-in
```

### `POST /volume`

Set the volume (0-100).

```bash
curl -X POST http://192.168.1.50:5001/volume \
  -H "Content-Type: application/json" \
  -d '{"volume": 30}'
```

### `GET /upnp/test`

Test UPnP connectivity to the Sonos speaker. Useful for debugging.

```bash
curl http://192.168.1.50:5001/upnp/test
```

Response:
```json
{
  "success": true,
  "message": "UPnP connection to 192.168.1.211:1400 successful",
  "speakerIp": "192.168.1.211"
}
```

### `POST /upnp/play`

Directly play a Spotify track via UPnP (for testing/debugging).

```bash
curl -X POST http://192.168.1.50:5001/upnp/play \
  -H "Content-Type: application/json" \
  -d '{"uri": "spotify:track:3skn2lauGk7Dx6bVIt5DVj", "title": "Starlight", "artist": "Muse"}'
```

## Architecture: Dual API Approach

This controller uses two different APIs to interact with Sonos:

### Sonos Cloud API (Official)
- Used for: `/play/:favorite` endpoint, volume control, household discovery
- Requires: OAuth tokens (client ID/secret, user authorization)
- Limitation: Cannot queue arbitrary Spotify tracks (only favorites)

### UPnP/SOAP (Direct Speaker)
- Used for: `/search` endpoint (arbitrary track playback)
- Requires: Local network access to Sonos speaker IP
- Approach: Same as [node-sonos-http-api](https://github.com/jishi/node-sonos-http-api)

The `/search` endpoint searches Spotify via their API, then uses UPnP to load the track directly on the Sonos speaker. This bypasses the Cloud API limitation that prevents arbitrary track playback.

### Configuration

Set the `SONOS_SPEAKER_IP` environment variable to your Sonos speaker's local IP:

```bash
# .env
SONOS_SPEAKER_IP=192.168.1.211
```

Find your speaker's IP in the Sonos app: **Settings → System → About My System**

## Voice Pipeline Integration

The `/search` endpoint is designed for voice assistant integration. Example flow:

1. Voice input: "Play Starlight by Muse"
2. Transcription → "starlight by muse"
3. HTTP request: `POST /search?q=starlight+by+muse`
4. Server searches Spotify, ranks results, plays best match on Sonos

**Integration with flightcom voice pipeline:**

```bash
# Voice transcription produces: "play bohemian rhapsody"
# Pipeline extracts query and POSTs to:
curl -X POST "http://centcom:5001/search?q=bohemian+rhapsody"
```

### 5. Deployment with Systemd

To ensure the Sonos Home Controller runs continuously and automatically restarts if it crashes or after a reboot, you can configure it as a systemd service on your Raspberry Pi (or any Linux system using systemd).

1.  **Create the systemd Service File**:
    Open a new service file in `/etc/systemd/system/`. We'll name it `sonos-controller.service`.

    ```bash
    sudo nano /etc/systemd/system/sonos-controller.service
    ```

2.  **Add Service Configuration**:
    Paste the following content into the file. **Ensure that `User`, `Group`, `WorkingDirectory`, and `ExecStart` reflect your actual setup.** The `WorkingDirectory` should be the root of your project, where your `.env` file is located. If you followed the example setup, this would be `/home/pi/sonos_controller`.

    ```ini
    [Unit]
    Description=Sonos Home Controller Service
    After=network.target

    [Service]
    User=pi
    Group=pi
    # Set this to the root directory of your project (where .env is)
    WorkingDirectory=/home/pi/sonos_controller
    # The command to start the script
    ExecStart=/usr/bin/node sonos_home_controller.js
    Restart=always
    StandardOutput=syslog
    StandardError=syslog
    SyslogIdentifier=sonos-controller

    [Install]
    WantedBy=multi-user.target
    ```

    Save and exit the file (`Ctrl + X`, then `Y`, then `Enter`).

3.  **Reload Systemd and Enable the Service**:
    After creating or modifying the service file, inform systemd about the new configuration and enable the service to start automatically on boot.

    ```bash
    sudo systemctl daemon-reload
    sudo systemctl enable sonos-controller.service
    ```

4.  **Start the Service**:
    Start the Sonos controller service immediately.

    ```bash
    sudo systemctl start sonos-controller.service
    ```

5.  **Verify Service Status and Logs**:
    Check if the service is running and view its logs for any issues or confirmation messages.

    ```bash
    systemctl status sonos-controller.service
    # To view real-time logs:
    journalctl -u sonos-controller.service -f
    ```

    You should see `Active: active (running)` and messages indicating the server is listening, confirming that the `.env` file was loaded correctly.
