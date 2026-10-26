# Field

The Field page shows what's happening around you, read straight from hardware plugged into your NOMAD. Nothing comes from the internet:

- **GPS position**: latitude and longitude, altitude, speed, direction of travel and satellite count, from a USB GPS receiver.
- **Aircraft radar**: planes within 250 km, decoded from the location signals aircraft broadcast (ADS-B). Aircraft declaring an emergency (transponder codes 7500, 7600 and 7700) are shown in red.
- **Waypoints**: your map markers, with distance, bearing and a compass arrow to any of them. **Mark here** saves your current position as a new map marker.
- **Sun and moon**: sunrise, sunset, daylight left and moon phase, worked out on the NOMAD from your position.

Turn on the radar button in the **Maps** toolbar to show your position and nearby aircraft on the offline map too.

Open **Field** from the home screen. Until you set up sources, the page offers **Try demo data**, which simulates a GPS walking around Denver and some aircraft so you can see how it works. A **Demo data** badge shows whenever simulated data is on.

---

## Hardware

| Part | What it's for | Notes |
|---|---|---|
| USB GPS receiver (u-blox 7 or 8, for example a VK-162) | Position and accurate time | Needs a view of the sky for its first fix, which can take a few minutes. |
| RTL-SDR USB radio (for example an RTL-SDR Blog V4) and a 1090 MHz antenna | Aircraft radar | The antenna matters more than the dongle. Mount it high and outdoors if you can. |

Both plug into the computer running NOMAD.

---

## Setting up the GPS

NOMAD's Command Center runs inside Docker, so the simplest setup is to run **gpsd** on the host and let NOMAD connect to it over the network.

1. Install gpsd on the NOMAD host:

   ```
   sudo apt install gpsd gpsd-clients
   ```

2. Edit `/etc/default/gpsd` so it reads your receiver and accepts connections from the container:

   ```
   DEVICES="/dev/ttyACM0"
   GPSD_OPTIONS="-n -G"
   ```

   `-G` makes gpsd listen on all interfaces, not only localhost. Don't expose port 2947 to the internet.

3. Restart gpsd with `sudo systemctl restart gpsd`, then check it with `cgps`. You should see satellites and, after a while, a position.

4. On the Field page, open **Sources**, set **GPS** to **gpsd** and keep the default address `host.docker.internal:2947`. Save.

You can also choose **Serial device** and enter a path like `/dev/ttyACM0`, but the device then also has to be passed through to the admin container.

---

## Setting up aircraft radar

1. Install **readsb** (or dump1090-fa) on the NOMAD host for your RTL-SDR dongle. Both decode aircraft and publish them as an SBS text feed on port 30003. Check it's working with `nc localhost 30003`. You should see lines starting with `MSG,`.
2. On the Field page, open **Sources**, set **Aircraft (ADS-B)** to **readsb / dump1090 feed** and keep the default address `host.docker.internal:30003`. Save.

Aircraft show up as soon as they're heard and disappear a minute after they stop transmitting.

---

## Home position

Under **Sources** you can set a home latitude and longitude. NOMAD uses it for aircraft distances and sun times whenever the GPS has no fix, for example indoors. Once the GPS has a fix, **Use current GPS position** fills it in for you.

---

## Good to know

- **The compass is north-up while you stand still.** A GPS works out direction from movement, so it can't tell which way you're facing until you walk. Once you're moving, the arrow turns relative to your direction of travel.
- **Bearings are true north.** A magnetic compass points to magnetic north, which differs by several degrees in most places.
- **Sun times use this screen's time zone.** They're computed from your position, but displayed in whatever time zone the device viewing the page is set to.
- **Connections retry by themselves.** If gpsd or the radio stops, the status at the top of the page says so, and NOMAD reconnects when it comes back.
