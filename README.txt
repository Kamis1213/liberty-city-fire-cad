LIBERTY CITY FIRE CAD v2
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
