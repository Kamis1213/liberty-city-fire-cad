LIBERTY CITY FIRE CAD v2.2
========================

This version is built for 24/7 hosting with PostgreSQL.

INCLUDED
--------
- Login system
- Admin / Command / Dispatch / Firefighter roles
- Dispatch dashboard
- Incident creation
- Incident status updates
- Incident history
- Unit / apparatus management
- Apparatus staffing
- Firefighter member portal
- MDT page
- LOA request form
- Command/Admin LOA approval and denial
- User management
- Optional radio API integration
- PostgreSQL session storage
- Dockerfile
- Render deployment file

QUICK LOCAL SETUP
-----------------
1. Install Node.js 20+.
2. Have a PostgreSQL database available.
3. Copy .env.example to .env.
4. Put your PostgreSQL DATABASE_URL in .env.
5. Change SESSION_SECRET and ADMIN_PASSWORD.
6. Open Command Prompt in this folder.
7. Run:
       npm install
       npm start
8. Open:
       http://localhost:3000

24/7 RENDER SETUP
-----------------
1. Put this project in a GitHub repository.
2. In Render, create a Blueprint from the repository.
3. Render will detect render.yaml and create:
   - the web service
   - the PostgreSQL database
4. Enter ADMIN_PASSWORD when Render asks for the unsynced secret.
5. Deploy.
6. Open the public URL Render gives you.

RAILWAY
-------
This project also works on Railway:
1. Create a PostgreSQL service.
2. Deploy this project.
3. Add DATABASE_URL, SESSION_SECRET, ADMIN_USERNAME,
   ADMIN_PASSWORD, and ADMIN_NAME as variables.
4. Railway supplies PORT automatically.

DEFAULT ADMIN
-------------
The default username is whatever ADMIN_USERNAME is set to.
The default password is whatever ADMIN_PASSWORD is set to.
Change both before production use.

IMPORTANT
---------
Do not put your real password or Discord token into GitHub.
Use host environment variables/secrets instead.

V2.1 UPGRADE
------------
- Priority 1 / 2 / 3 incidents
- Automatic DISPATCHED status when units are assigned
- Dispatch, En Route, On Scene and Closed timestamps
- Priority badges on Dispatch and History screens
- Safe automatic database migration for existing v2 database


V2.2 DISPATCH ALERTS + RADIO
----------------------------
- Browser-based station dispatch tones (no audio files required)
- "Enable Dispatch Audio" button for browser autoplay permission
- Priority-specific alert tones
- Pop-up incident alert with acknowledge button
- Optional desktop browser notification
- Firefighter accounts only receive alerts for the unit they are staffed on
- Dispatch / Command / Admin receive active dispatch alerts
- 4-second live alert polling
- Radio delivery status shown on Dispatch screen
- Radio payload now includes incident priority
- Safe database migration for existing v2/v2.1 databases

IMPORTANT ABOUT RADIO
---------------------
RADIO_API must be a PUBLICLY REACHABLE HTTPS URL when the CAD is hosted online.
A Render-hosted CAD cannot call http://127.0.0.1:3100 on your home computer.

Example:
RADIO_API=https://your-online-radio-server.example.com/dispatch

The existing local radio server can be upgraded/hosted separately, then its public
/dispatch URL can be placed in Render as the RADIO_API environment variable.

V2.2.1 AUDIO HOTFIX
-------------------
- Fixes the dispatch audio button showing ON after a page reload when the browser
  had actually destroyed the AudioContext.
- Audio now starts OFF after each page navigation, as required by browser security.
- Clicking Enable Dispatch Audio plays a two-tone confirmation chirp.
- Dispatcher hears the selected priority tone immediately when submitting a call.
- Other logged-in CAD clients receive the tone while their page remains open and
  Dispatch Audio is enabled.


V2.3 VOICE DISPATCH
-------------------
- Fire-station-style dual-frequency dispatch tone patterns
- Different patterns for Priority 1, Priority 2, and Priority 3
- Spoken browser dispatch after the alert tone
- Speech includes priority, assigned apparatus, call type, address, incident number,
  and notes
- Acknowledge button stops spoken dispatch
- No external voice service or API key required
- Uses the browser's built-in Web Speech API

ONLINE RADIO CONNECTION
-----------------------
A separate deployable Liberty City Radio Relay v5 package is included separately.
After it is deployed online, set the CAD's Render environment variable:

RADIO_API=https://YOUR-RADIO-SERVICE.onrender.com/dispatch

Then redeploy the CAD.

V2.3.1 INCIDENT ROUTE HOTFIX
----------------------------
- Restores/duplicates incident creation on POST /incidents and POST /incidents/new.
- Dashboard dispatch form now posts to /incidents/new.
- Existing CAD database and RADIO_API integration are unchanged.


V2.4 UNIT BUILDER
-----------------
- Dispatchers, Command, and Admin can open Units from the CAD navigation.
- Create custom apparatus directly inside the CAD.
- Supported types include Engine, Ladder, Truck, Rescue, Squad, Medic, Ambulance,
  Battalion, Command, HazMat, Marine, Utility, and Other.
- Rename units and change apparatus type.
- Manually set Available, Out of Service, Busy, Training, or Station.
- Command/Admin can delete units when they are not assigned to an incident.
- New units automatically appear on the Dispatch screen.
- Existing database, incidents, users, radio integration, and PTT system are unchanged.


V2.5 STATIONS
-------------
- Create and edit fire stations inside the CAD.
- Add station name, address, and notes.
- Assign each apparatus to a station from Unit Management.
- Dispatch screen groups selectable apparatus by station.
- Unit Status panel is also grouped by station.
- Units can remain Unassigned if needed.
- Deleting a station does not delete its apparatus; those units become Unassigned.
- Existing incidents, users, database records, CAD-to-radio dispatch, and radio PTT remain intact.


V2.6 PERSONNEL & ROSTERS
------------------------
- New Personnel page for department roster management.
- Create members with name, rank, callsign, badge number, and home station.
- Includes the Liberty City FD rank structure.
- Assign personnel to apparatus and riding positions.
- Personnel assigned to apparatus appear in the existing Unit Management crew display.
- Mark personnel Active/Inactive.
- Dispatch, Command, and Admin can manage roster/staffing.
- Command/Admin can delete roster members that are not linked to a normal CAD login.
- Existing stations, units, incidents, database, radio dispatch, and PTT remain intact.
