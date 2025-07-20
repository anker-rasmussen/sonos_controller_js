# Dynamic Sonos Player Via api/webhooks....
### What?? TLDR:
### RESTful api style, send a POST request http://ip-address-of-server:5001/play/{playlist_name}
### See below for steps to setup. If you do not have a domain, use [ngrok](https://ngrok.com/)

This Node.js application runs on a Raspberry Pi (or any persistent server) and provides a simple, local API to play any of your "My Sonos" favorites on a designated speaker.

It works by running a small web server that listens for dynamic webhooks. You can trigger these webhooks from any service that can make an HTTP request, such as Apple's Shortcuts app, Home Assistant, or a cron job. This allows you to create various automations, like playing a specific playlist upon arriving home, starting a morning playlist at a set time, or triggering soundscapes on demand.

This version uses the official Sonos Control API, which is more reliable than third-party methods.

## Features

* **Dynamic Playback**: Play any of your "My Sonos" favorites by including its name in the request URL (e.g., `/play/Upbeat_Morning`).
* **Direct Sonos Control**: Uses the official Sonos API for robust and reliable playback.
* **Automation Ready**: Designed to be triggered by any webhook-capable service for endless automation possibilities.
* **Configurable Delay**: A built-in global delay can be set to prevent music from starting instantly.
* **Speaker Targeting**: You can specify the exact Sonos speaker or group name (e.g., "Living Room").
* **Persistent & Robust**: Designed to run continuously as a systemd service, with automatic token refreshing.
* **Secure**: Keeps your secret credentials out of the code using a `.env` file.

## Requirements

* A Raspberry Pi or other always-on computer running a Linux distribution with systemd.
* Node.js (v16 or higher).
* A Sonos system.
* A Spotify Premium account (or other premium music service) to save and play playlists/stations as favorites.

## Setup Instructions

### 1. Sonos Developer Account & Control Integration

First, you need to register an application with Sonos to get API credentials.

1.  Go to the [Sonos Developer Portal](https://developer.sonos.com/) and create an account.
2.  Once logged in, go to "Control Integrations" and click "Create a new control integration".
3.  Fill out the required fields. For "User-facing name," you can enter something like "Home Automation Controller."
4.  Under "Control & Authentication," configure the following:
    * **Redirect URIs**: Add `http://localhost:8888/callback`. This must be exact.
    * **Event Callback URL**: You can leave this blank.
5.  Click "Save."
6.  You will now see your **Key (Client ID)** and **Secret (Client Secret)** on the integration's page. You will need these for your `.env` file.

### 2. Project Setup on Raspberry Pi

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
3.  Edit the `.env` file and fill in your details. You must provide your `SONOS_CLIENT_ID`, `SONOS_CLIENT_SECRET`, and `TARGET_DEVICE_NAME`.
    ```bash
    nano .env
    ```
4.  Install dependencies.
    ```bash
    npm install express dotenv open axios
    ```
5.  **First-Time Authentication**: Run the script once to authorize it with your Sonos household.
    ```bash
    node sonos_home_controller.js
    ```
    * A URL will be printed in the console. A browser window should open automatically.
    * If not, copy the URL and paste it into a browser.
    * Log in to your Sonos account and grant the permissions.
    * You'll be redirected to a "Success!" page. The script will save a `.sonos_tokens.json` file and exit. Your app is now authenticated.

### 3. Automation Setup (Apple Shortcuts Example)

Using your phone's Wi-Fi connection is a reliable trigger for a "home arrival" automation. You can create multiple automations for different scenarios.

1.  On your Pi, find its local IP address with `hostname -I`.
2.  On your iPhone, open the **Shortcuts** app -> **Automation** tab.
3.  Create a **New Personal Automation**. For a home arrival trigger, select "Wi-Fi" and choose your home network.
4.  Add the action **"Get Contents of URL"**.
5.  Set the URL to `http://<YOUR_PI_LOCAL_IP>:<PORT>/play/<YOUR_FAVORITE_NAME>`.
    * Replace `<YOUR_PI_LOCAL_IP>` with your Pi's IP address (e.g., `192.168.1.50`).
    * Replace `<PORT>` with the port from your `.env` file (e.g., `5001`).
    * Replace `<YOUR_FAVORITE_NAME>` with the exact name of the favorite you want to play (e.g., `Classical%20in%20the%20Background`). Spaces should be URL-encoded as `%20`, but the Shortcuts app often handles this automatically.
6.  Expand the options and set the **Method** to **POST**.
7.  Turn **OFF** "Ask Before Running."

**Example Automations:**
* **Home Arrival:** Triggered by Wi-Fi, URL: `http://192.168.1.50:5001/play/Classical%20in%20the%20Background`
* **Morning Playlist:** Triggered by "Time of Day" (e.g., 8 AM), URL: `http://192.168.1.50:5001/play/Upbeat%20Morning`

### 4. Deployment with Systemd

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

