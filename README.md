Sonos Home Arrival Controller

This Node.js application runs on a Raspberry Pi (or any persistent server) to automatically play a specific Spotify playlist on a designated Sonos speaker when you arrive home.

This version uses the official Sonos Control API to directly command your speakers, which is more reliable than using the Spotify API for this purpose.

It works by running a small web server that listens for a webhook. This webhook is triggered by a location-based service on your phone (like Apple's Shortcuts app) when you connect to your home Wi-Fi.
Features

    Direct Sonos Control: Uses the official Sonos API for robust and reliable playback.

    Automatic Playback: Starts music automatically after you arrive home.

    Configurable Delay: A built-in delay prevents music from starting the instant you walk in the door.

    Speaker Targeting: You can specify the exact Sonos speaker or group name (e.g., "Living Room").

    Persistent & Robust: Designed to run continuously using PM2, with automatic token refreshing.

    Secure: Keeps your secret credentials out of the code using a .env file.

Requirements

    A Raspberry Pi or other always-on computer.

    Node.js (v16 or higher).

    A Sonos system.

    A Spotify Premium account (required by Sonos to play Spotify playlists).

Setup Instructions
1. Sonos Developer Account & Control Integration

First, you need to register an application with Sonos to get API credentials.

    Go to the Sonos Developer Portal and create an account.

    Once logged in, go to "Control Integrations" and click "Create a new control integration".

    Fill out the required fields. For "User-facing name," you can enter something like "Home Arrival Controller."

    Under "Control & Authentication," configure the following:

        Redirect URIs: Add http://localhost:8888/callback. This must be exact.

        Event Callback URL: You can leave this blank.

    Click "Save."

    You will now see your Key (Client ID) and Secret (Client Secret) on the integration's page. You will need these for your .env file.

2. Project Setup on Raspberry Pi

    Clone or download the project files into a directory on your Pi.

    # Example:
    mkdir -p /home/pi/sonos_controller
    cd /home/pi/sonos_controller
    # (Then add the project files to this directory)

    Create your environment file from the example.

    cp .env.example .env

    Edit the .env file and fill in your details. You must provide your SONOS_CLIENT_ID and SONOS_CLIENT_SECRET.

    nano .env

    Install dependencies. Note that the dependencies have changed from the previous version.

    npm install express sonos dotenv open axios

    First-Time Authentication: Run the script once to authorize it with your Sonos household.

    node sonos_home_controller.js

        A URL will be printed in the console. A browser window should open automatically.

        If not, copy the URL and paste it into a browser.

        Log in to your Sonos account and grant the permissions.

        You'll be redirected to a "Success!" page. The script will save a .sonos_tokens.json file and exit. Your app is now authenticated.

3. Phone Setup (Apple Shortcuts)

Using your phone's Wi-Fi connection is the most reliable trigger.

    On your Pi, find its local IP address with hostname -I.

    On your iPhone, open the Shortcuts app -> Automation tab.

    Create a New Personal Automation triggered by "Wi-Fi" when you join your home network.

    Add the action "Get Contents of URL".

    Set the URL to http://<YOUR_PI_LOCAL_IP>:<PORT>/webhook/arrive. (e.g., http://192.168.1.50:5001/webhook/arrive).

    Expand the options, set the Method to POST.

    Turn OFF "Ask Before Running."

## 4. Deployment with Systemd

To ensure the Sonos Home Controller runs continuously and automatically restarts if it crashes or after a reboot, you can configure it as a systemd service on your Raspberry Pi (or any Linux system using systemd).

1.  **Create the systemd Service File**:
    Open a new service file in `/etc/systemd/system/`. We'll name it `sonos-controller.service`.

    ```bash
    sudo nano /etc/systemd/system/sonos-controller.service
    ```

2.  **Add Service Configuration**:
    Paste the following content into the file. **Ensure that `User`, `Group`, `WorkingDirectory`, and `ExecStart` reflect your actual setup.** The `WorkingDirectory` should be the root of your `sonos_controller_js` project, where your `.env` file is located. If you followed the example setup, this would be `/home/pi/sonos_controller`.

    ```ini
    [Unit]
    Description=Sonos Home Controller Service
    After=network.target

    [Service]
    User=pi # Or your username, e.g., broadcom
    Group=pi # Or your group, e.g., broadcom
    # Set this to the root directory of your project (where .env is)
    WorkingDirectory=/home/pi/sonos_controller
    # Adjust the path to your main script relative to the WorkingDirectory
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



