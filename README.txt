LIBERTY CITY FIRE CAD v3.1 — SESSION / OFFICER CAD UPGRADE

NEW:
- Login now asks Username, Password, and Callsign.
- Post-login CAD Mode selector: Dispatch or Officer.
- Actual account role still controls which mode is authorized.
- Dispatch mode opens the existing dispatch console with history/reports.
- Officer mode requires staffing before entering the Officer CAD.
- Officer staffing: station, apparatus, position.
- New dark/blue Officer CAD modeled after the supplied reference:
  active calls, current callsign/unit/status, unit status controls,
  live apparatus/personnel board, records link, switch-mode control.
- Officer can go off duty from the console.
- Existing v3.0 dispatch, MDT, reports, radio, database, admin, and staffing features retained.

DEPLOY:
Upload all files in this folder to the SAME GitHub CAD repository and commit.
Render should redeploy automatically.


v3.1.1 HOTFIX
-------------
Officer CAD status buttons now return the user to the Officer CAD after
EN ROUTE / ON SCENE / TRANSPORTING / AT HOSPITAL / AVAILABLE / OOS.
They no longer redirect officers to the full Apparatus MDT page.


v3.1.2 NAVIGATION CLEANUP
-------------------------
Officer mode now shows only:
- Officer CAD
- My Call
- Reports
- Switch Mode
- Logout

Dispatch/admin navigation remains available only outside Officer mode and
continues to respect the user's account role.


v3.1.3 HOTFIX
-------------
Fixes "CAD server error" introduced by v3.1.2 navigation cleanup.
The Express session is now exposed to EJS templates, and the Officer-mode
header check is defensive if session data is absent.
