# Home bridge: Motion Blinds

Motion Blinds gateways only accept commands on your home network, so this small program runs on
an always-on computer at home (Mac, Raspberry Pi, mini PC…) and connects them to the dashboard.

## Setup

1. **Motion key:** in the Motion Blinds app, open *Settings → About* and tap the screen 5 times.
   A 16-character key appears (e.g. `12ab345c-d67e-8f`). Copy it.
2. **Bridge token:** in the dashboard, open *Integrations → Motion Blinds → Generate bridge token*.
   It is shown once.
3. Copy `config.example.json` to `config.json` and fill in `token` and `key`.
   `gatewayIp` is optional (the bridge finds the gateway itself); set it if discovery fails,
   e.g. `"192.168.1.50"`. Give the gateway a fixed IP in your router if you do.
4. Run it (Node.js 18+ needed, no other installs):

   ```bash
   npm run motion
   ```

Blinds appear on the dashboard within a minute, named "Motion blind XXXX"; rename them with *Edit*.

## Keep it running

On a Mac, the simplest is to leave a Terminal open. To start it automatically on a Raspberry Pi or
Linux box, use a systemd service with `ExecStart=/usr/bin/node /path/to/bridge/motion-bridge.mjs`
and `Restart=always`.

`config.json` holds your token and Motion key: it is git-ignored, don't share it.
