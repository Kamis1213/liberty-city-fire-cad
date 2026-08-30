require("dotenv").config();

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcrypt");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  console.error("Copy .env.example to .env and add your PostgreSQL connection string.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined
});

if (isProduction) {
  app.set("trust proxy", 1);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new pgSession({
      pool,
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "change-me-now",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 12,
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction
    }
  })
);

const roleRank = {
  FIREFIGHTER: 1,
  DISPATCH: 2,
  COMMAND: 3,
  ADMIN: 4
};

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    const have = roleRank[req.session.user.role] || 0;
    const need = roleRank[minRole] || 999;
    if (have < need) return res.status(403).send("Access denied.");
    next();
  };
}

function clean(value) {
  return String(value || "").trim();
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      rank TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'FIREFIGHTER',
      unit_id INTEGER,
      position TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stations (
      id SERIAL PRIMARY KEY,
      station_name TEXT UNIQUE NOT NULL,
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS units (
      id SERIAL PRIMARY KEY,
      unit_name TEXT UNIQUE NOT NULL,
      unit_type TEXT DEFAULT 'ENGINE',
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      assigned_incident INTEGER,
      station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      incident_number TEXT UNIQUE NOT NULL,
      call_type TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      dispatcher TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'PRIORITY 2',
      dispatched_at TIMESTAMPTZ,
      enroute_at TIMESTAMPTZ,
      onscene_at TIMESTAMPTZ,
      radio_status TEXT NOT NULL DEFAULT 'NOT CONFIGURED',
      radio_error TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS incident_units (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      UNIQUE(incident_id, unit_id)
    );

    CREATE TABLE IF NOT EXISTS unit_crew (
      id SERIAL PRIMARY KEY,
      unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position TEXT NOT NULL,
      UNIQUE(unit_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS loa_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by INTEGER REFERENCES users(id),
      review_note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );
  `);

  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'PRIORITY 2'`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS enroute_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS onscene_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS radio_status TEXT NOT NULL DEFAULT 'NOT CONFIGURED'`);
  await pool.query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS radio_error TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE units ADD COLUMN IF NOT EXISTS station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL`);

  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const adminName = process.env.ADMIN_NAME || "Fire Commissioner";

  const existing = await pool.query(
    "SELECT id FROM users WHERE username = $1",
    [adminUsername]
  );

  if (!existing.rowCount) {
    const hash = await bcrypt.hash(adminPassword, 12);
    await pool.query(
      `INSERT INTO users (username, password, name, rank, role)
       VALUES ($1, $2, $3, $4, 'ADMIN')`,
      [adminUsername, hash, adminName, "Fire Commissioner"]
    );
    console.log(`Created admin account: ${adminUsername}`);
  }

  const defaultUnits = [
    ["Engine 1", "ENGINE"],
    ["Engine 2", "ENGINE"],
    ["Ladder 1", "LADDER"],
    ["Rescue 1", "RESCUE"],
    ["Battalion 1", "COMMAND"]
  ];

  for (const [name, type] of defaultUnits) {
    await pool.query(
      `INSERT INTO units (unit_name, unit_type)
       VALUES ($1, $2)
       ON CONFLICT (unit_name) DO NOTHING`,
      [name, type]
    );
  }
}

async function nextIncidentNumber() {
  const year = new Date().getFullYear();
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM incidents
     WHERE EXTRACT(YEAR FROM created_at) = $1`,
    [year]
  );
  const num = String((result.rows[0]?.count || 0) + 1).padStart(4, "0");
  return `LCFD-${year}-${num}`;
}

async function sendToRadio(incident, unitNames) {
  const url = clean(process.env.RADIO_API);

  if (!url) {
    await pool.query(
      "UPDATE incidents SET radio_status = 'NOT CONFIGURED', radio_error = '' WHERE id = $1",
      [incident.id]
    );
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incidentNumber: incident.incident_number,
        priority: incident.priority,
        callType: incident.call_type,
        address: incident.address,
        units: unitNames,
        notes: incident.notes
      })
    });

    if (!response.ok) {
      throw new Error(`Radio server returned HTTP ${response.status}`);
    }

    await pool.query(
      "UPDATE incidents SET radio_status = 'SENT', radio_error = '' WHERE id = $1",
      [incident.id]
    );
  } catch (err) {
    console.error("Radio integration error:", err.message);
    await pool.query(
      "UPDATE incidents SET radio_status = 'FAILED', radio_error = $1 WHERE id = $2",
      [String(err.message || err).slice(0, 500), incident.id]
    );
  }
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  next();
});

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  if (req.session.user.role === "FIREFIGHTER") return res.redirect("/member");
  res.redirect("/dashboard");
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const username = clean(req.body.username);
  const password = String(req.body.password || "");

  const result = await pool.query(
    "SELECT * FROM users WHERE username = $1 AND active = TRUE",
    [username]
  );

  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).render("login", {
      error: "Invalid username or password."
    });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    name: user.name,
    rank: user.rank,
    role: user.role
  };

  if (user.role === "FIREFIGHTER") return res.redirect("/member");
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", requireRole("DISPATCH"), async (req, res) => {
  const [incidents, units] = await Promise.all([
    pool.query(`
      SELECT i.*,
        COALESCE(STRING_AGG(u.unit_name, ', ' ORDER BY u.unit_name), '') AS units
      FROM incidents i
      LEFT JOIN incident_units iu ON iu.incident_id = i.id
      LEFT JOIN units u ON u.id = iu.unit_id
      WHERE i.status <> 'CLOSED'
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `),
    pool.query(`
      SELECT u.*, s.station_name
      FROM units u
      LEFT JOIN stations s ON s.id = u.station_id
      ORDER BY COALESCE(s.station_name, 'ZZZ'), u.unit_name
    `)
  ]);

  res.render("dashboard", {
    incidents: incidents.rows,
    units: units.rows
  });
});

async function createIncident(req, res) {
  const callType = clean(req.body.call_type);
  const address = clean(req.body.address);
  const notes = clean(req.body.notes);
  const priority = ["PRIORITY 1","PRIORITY 2","PRIORITY 3"].includes(clean(req.body.priority).toUpperCase())
    ? clean(req.body.priority).toUpperCase()
    : "PRIORITY 2";
  let unitIds = req.body.unit_ids || [];
  if (!Array.isArray(unitIds)) unitIds = [unitIds];

  if (!callType || !address) return res.redirect("/dashboard");

  const number = await nextIncidentNumber();
  const incidentResult = await pool.query(
    `INSERT INTO incidents
      (incident_number, call_type, address, notes, dispatcher, priority)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [number, callType, address, notes, req.session.user.name, priority]
  );
  const incident = incidentResult.rows[0];

  const assignedNames = [];
  for (const rawId of unitIds) {
    const unitId = Number(rawId);
    if (!unitId) continue;

    const unitResult = await pool.query(
      "SELECT * FROM units WHERE id = $1",
      [unitId]
    );
    if (!unitResult.rowCount) continue;

    await pool.query(
      `INSERT INTO incident_units (incident_id, unit_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [incident.id, unitId]
    );
    await pool.query(
      `UPDATE units
       SET status = 'DISPATCHED', assigned_incident = $1
       WHERE id = $2`,
      [incident.id, unitId]
    );
    assignedNames.push(unitResult.rows[0].unit_name);
  }

  if (assignedNames.length) {
    await pool.query(
      `UPDATE incidents SET status = 'DISPATCHED', dispatched_at = NOW() WHERE id = $1`,
      [incident.id]
    );
    incident.status = "DISPATCHED";
  }
  await sendToRadio(incident, assignedNames.join(", "));
  res.redirect("/dashboard");
}

// Accept both paths so older/newer dashboard forms continue to work.
app.post("/incidents", requireRole("DISPATCH"), createIncident);
app.post("/incidents/new", requireRole("DISPATCH"), createIncident);

app.post("/incidents/:id/status", requireRole("DISPATCH"), async (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status).toUpperCase();
  const allowed = ["PENDING", "DISPATCHED", "EN ROUTE", "ON SCENE", "CLOSED"];
  if (!allowed.includes(status)) return res.redirect("/dashboard");

  await pool.query(
    `UPDATE incidents
     SET status = $1,
         dispatched_at = CASE WHEN $1 = 'DISPATCHED' AND dispatched_at IS NULL THEN NOW() ELSE dispatched_at END,
         enroute_at = CASE WHEN $1 = 'EN ROUTE' AND enroute_at IS NULL THEN NOW() ELSE enroute_at END,
         onscene_at = CASE WHEN $1 = 'ON SCENE' AND onscene_at IS NULL THEN NOW() ELSE onscene_at END,
         closed_at = CASE WHEN $1 = 'CLOSED' THEN NOW() ELSE closed_at END
     WHERE id = $2`,
    [status, id]
  );

  if (status === "CLOSED") {
    await pool.query(
      `UPDATE units
       SET status = 'AVAILABLE', assigned_incident = NULL
       WHERE id IN (SELECT unit_id FROM incident_units WHERE incident_id = $1)`,
      [id]
    );
  } else {
    await pool.query(
      `UPDATE units SET status = $1
       WHERE id IN (SELECT unit_id FROM incident_units WHERE incident_id = $2)`,
      [status, id]
    );
  }

  res.redirect(req.get("referer") || "/dashboard");
});


app.get("/api/alerts", requireLogin, async (req, res) => {
  let query;
  let params = [];

  if (req.session.user.role === "FIREFIGHTER") {
    params = [req.session.user.id];
    query = `
      SELECT DISTINCT i.id, i.incident_number, i.priority, i.call_type, i.address,
        i.notes, i.status, i.created_at, i.dispatched_at,
        COALESCE(STRING_AGG(DISTINCT u.unit_name, ', '), '') AS units
      FROM incidents i
      JOIN incident_units iu ON iu.incident_id = i.id
      JOIN units u ON u.id = iu.unit_id
      JOIN unit_crew uc ON uc.unit_id = u.id
      WHERE i.status <> 'CLOSED' AND uc.user_id = $1
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT 10
    `;
  } else {
    query = `
      SELECT i.id, i.incident_number, i.priority, i.call_type, i.address,
        i.notes, i.status, i.created_at, i.dispatched_at,
        COALESCE(STRING_AGG(DISTINCT u.unit_name, ', '), '') AS units
      FROM incidents i
      LEFT JOIN incident_units iu ON iu.incident_id = i.id
      LEFT JOIN units u ON u.id = iu.unit_id
      WHERE i.status <> 'CLOSED'
      GROUP BY i.id
      ORDER BY i.created_at DESC
      LIMIT 10
    `;
  }

  const result = await pool.query(query, params);
  res.json({
    serverTime: new Date().toISOString(),
    incidents: result.rows
  });
});

app.get("/api/radio/status", requireRole("DISPATCH"), async (req, res) => {
  res.json({
    configured: Boolean(clean(process.env.RADIO_API)),
    endpoint: clean(process.env.RADIO_API) ? "Configured" : "Not configured"
  });
});

app.get("/history", requireLogin, async (req, res) => {
  const result = await pool.query(`
    SELECT i.*,
      COALESCE(STRING_AGG(u.unit_name, ', ' ORDER BY u.unit_name), '') AS units
    FROM incidents i
    LEFT JOIN incident_units iu ON iu.incident_id = i.id
    LEFT JOIN units u ON u.id = iu.unit_id
    GROUP BY i.id
    ORDER BY i.created_at DESC
    LIMIT 250
  `);
  res.render("history", { incidents: result.rows });
});

app.get("/mdt", requireLogin, async (req, res) => {
  const units = await pool.query(`
    SELECT u.*,
      i.incident_number,
      i.call_type,
      i.address,
      i.notes,
      i.status AS incident_status
    FROM units u
    LEFT JOIN incidents i ON i.id = u.assigned_incident
    ORDER BY u.unit_name
  `);
  res.render("mdt", { units: units.rows });
});

app.get("/member", requireLogin, async (req, res) => {
  const userResult = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [req.session.user.id]
  );
  const unitsResult = await pool.query("SELECT * FROM units ORDER BY unit_name");
  const crewResult = await pool.query(
    `SELECT uc.*, u.unit_name
     FROM unit_crew uc
     JOIN units u ON u.id = uc.unit_id
     WHERE uc.user_id = $1`,
    [req.session.user.id]
  );
  const loaResult = await pool.query(
    `SELECT * FROM loa_requests
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [req.session.user.id]
  );

  res.render("member", {
    member: userResult.rows[0],
    units: unitsResult.rows,
    crew: crewResult.rows[0] || null,
    loaRequests: loaResult.rows
  });
});

app.post("/member/staff", requireLogin, async (req, res) => {
  const unitId = Number(req.body.unit_id);
  const position = clean(req.body.position);
  if (!unitId || !position) return res.redirect("/member");

  await pool.query("DELETE FROM unit_crew WHERE user_id = $1", [
    req.session.user.id
  ]);
  await pool.query(
    `INSERT INTO unit_crew (unit_id, user_id, position)
     VALUES ($1, $2, $3)`,
    [unitId, req.session.user.id, position]
  );
  await pool.query(
    `UPDATE users SET unit_id = $1, position = $2 WHERE id = $3`,
    [unitId, position, req.session.user.id]
  );

  res.redirect("/member");
});

app.post("/member/unstaff", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM unit_crew WHERE user_id = $1", [
    req.session.user.id
  ]);
  await pool.query(
    `UPDATE users SET unit_id = NULL, position = '' WHERE id = $1`,
    [req.session.user.id]
  );
  res.redirect("/member");
});

app.post("/loa", requireLogin, async (req, res) => {
  const startDate = clean(req.body.start_date);
  const endDate = clean(req.body.end_date);
  const reason = clean(req.body.reason);

  if (!startDate || !endDate || !reason) return res.redirect("/member");

  await pool.query(
    `INSERT INTO loa_requests (user_id, start_date, end_date, reason)
     VALUES ($1, $2, $3, $4)`,
    [req.session.user.id, startDate, endDate, reason]
  );
  res.redirect("/member");
});

app.get("/admin/loa", requireRole("COMMAND"), async (req, res) => {
  const result = await pool.query(`
    SELECT l.*, u.name, u.username, u.rank
    FROM loa_requests l
    JOIN users u ON u.id = l.user_id
    ORDER BY
      CASE WHEN l.status = 'PENDING' THEN 0 ELSE 1 END,
      l.created_at DESC
  `);
  res.render("admin-loa", { requests: result.rows });
});

app.post("/admin/loa/:id", requireRole("COMMAND"), async (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status).toUpperCase();
  const note = clean(req.body.review_note);
  if (!["APPROVED", "DENIED"].includes(status)) return res.redirect("/admin/loa");

  await pool.query(
    `UPDATE loa_requests
     SET status = $1,
         reviewed_by = $2,
         review_note = $3,
         reviewed_at = NOW()
     WHERE id = $4`,
    [status, req.session.user.id, note, id]
  );
  res.redirect("/admin/loa");
});

app.get("/admin/users", requireRole("ADMIN"), async (req, res) => {
  const result = await pool.query(
    "SELECT id, username, name, rank, role, active, created_at FROM users ORDER BY name"
  );
  res.render("admin-users", { users: result.rows, error: null });
});

app.post("/admin/users", requireRole("ADMIN"), async (req, res) => {
  const username = clean(req.body.username);
  const name = clean(req.body.name);
  const rank = clean(req.body.rank);
  const role = clean(req.body.role).toUpperCase();
  const password = String(req.body.password || "");

  if (!username || !name || !password || !roleRank[role]) {
    const result = await pool.query(
      "SELECT id, username, name, rank, role, active, created_at FROM users ORDER BY name"
    );
    return res.status(400).render("admin-users", {
      users: result.rows,
      error: "All required fields must be completed."
    });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (username, password, name, rank, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [username, hash, name, rank, role]
    );
  } catch (err) {
    const result = await pool.query(
      "SELECT id, username, name, rank, role, active, created_at FROM users ORDER BY name"
    );
    return res.status(400).render("admin-users", {
      users: result.rows,
      error: err.code === "23505" ? "That username already exists." : err.message
    });
  }

  res.redirect("/admin/users");
});

app.post("/admin/users/:id/toggle", requireRole("ADMIN"), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.redirect("/admin/users");

  await pool.query(
    `UPDATE users SET active = NOT active WHERE id = $1`,
    [id]
  );
  res.redirect("/admin/users");
});

app.get("/admin/stations", requireRole("DISPATCH"), async (req, res) => {
  const stations = await pool.query(`
    SELECT s.*,
      COUNT(u.id)::int AS unit_count
    FROM stations s
    LEFT JOIN units u ON u.station_id = s.id
    GROUP BY s.id
    ORDER BY s.station_name
  `);
  res.render("admin-stations", { stations: stations.rows });
});

app.post("/admin/stations", requireRole("DISPATCH"), async (req, res) => {
  const name = clean(req.body.station_name);
  const address = clean(req.body.address);
  const notes = clean(req.body.notes);
  if (name) {
    await pool.query(
      `INSERT INTO stations (station_name, address, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (station_name) DO NOTHING`,
      [name, address, notes]
    );
  }
  res.redirect("/admin/stations");
});

app.post("/admin/stations/:id/edit", requireRole("DISPATCH"), async (req, res) => {
  const id = Number(req.params.id);
  const name = clean(req.body.station_name);
  const address = clean(req.body.address);
  const notes = clean(req.body.notes);
  if (id && name) {
    await pool.query(
      `UPDATE stations
       SET station_name = $1, address = $2, notes = $3
       WHERE id = $4`,
      [name, address, notes, id]
    ).catch(err => {
      if (err.code !== "23505") throw err;
    });
  }
  res.redirect("/admin/stations");
});

app.post("/admin/stations/:id/delete", requireRole("COMMAND"), async (req, res) => {
  const id = Number(req.params.id);
  if (id) {
    await pool.query(`DELETE FROM stations WHERE id = $1`, [id]);
  }
  res.redirect("/admin/stations");
});

app.get("/admin/units", requireRole("DISPATCH"), async (req, res) => {
  const [units, stations] = await Promise.all([
    pool.query(`
      SELECT u.*, s.station_name,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'name', us.name,
              'rank', us.rank,
              'position', uc.position
            )
          ) FILTER (WHERE uc.id IS NOT NULL),
          '[]'
        ) AS crew
      FROM units u
      LEFT JOIN stations s ON s.id = u.station_id
      LEFT JOIN unit_crew uc ON uc.unit_id = u.id
      LEFT JOIN users us ON us.id = uc.user_id
      GROUP BY u.id, s.station_name
      ORDER BY COALESCE(s.station_name, 'ZZZ'), u.unit_name
    `),
    pool.query("SELECT * FROM stations ORDER BY station_name")
  ]);
  res.render("admin-units", { units: units.rows, stations: stations.rows });
});

app.post("/admin/units", requireRole("DISPATCH"), async (req, res) => {
  const name = clean(req.body.unit_name);
  const requestedType = clean(req.body.unit_type).toUpperCase();
  const allowedTypes = ["ENGINE","LADDER","TRUCK","RESCUE","SQUAD","MEDIC","AMBULANCE","BATTALION","COMMAND","HAZMAT","MARINE","UTILITY","OTHER"];
  const type = allowedTypes.includes(requestedType) ? requestedType : "OTHER";
  const stationId = Number(req.body.station_id) || null;

  if (name) {
    await pool.query(
      `INSERT INTO units (unit_name, unit_type, station_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (unit_name) DO NOTHING`,
      [name, type, stationId]
    );
  }
  res.redirect("/admin/units");
});

app.post("/admin/units/:id/edit", requireRole("DISPATCH"), async (req, res) => {
  const id = Number(req.params.id);
  const name = clean(req.body.unit_name);
  const requestedType = clean(req.body.unit_type).toUpperCase();
  const allowedTypes = ["ENGINE","LADDER","TRUCK","RESCUE","SQUAD","MEDIC","AMBULANCE","BATTALION","COMMAND","HAZMAT","MARINE","UTILITY","OTHER"];
  const type = allowedTypes.includes(requestedType) ? requestedType : "OTHER";
  const stationId = Number(req.body.station_id) || null;

  if (id && name) {
    await pool.query(
      `UPDATE units SET unit_name = $1, unit_type = $2, station_id = $3 WHERE id = $4`,
      [name, type, stationId, id]
    ).catch(err => {
      if (err.code !== "23505") throw err;
    });
  }
  res.redirect("/admin/units");
});

app.post("/admin/units/:id/status", requireRole("DISPATCH"), async (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body.status).toUpperCase();
  const allowed = ["AVAILABLE","OUT OF SERVICE","BUSY","TRAINING","STATION"];
  if (id && allowed.includes(status)) {
    await pool.query(
      `UPDATE units SET status = $1,
         assigned_incident = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE assigned_incident END
       WHERE id = $2`,
      [status, id]
    );
  }
  res.redirect("/admin/units");
});

app.post("/admin/units/:id/delete", requireRole("COMMAND"), async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.redirect("/admin/units");

  const activeAssignment = await pool.query(
    `SELECT 1 FROM units WHERE id = $1 AND assigned_incident IS NOT NULL`,
    [id]
  );
  if (activeAssignment.rowCount) return res.redirect("/admin/units");

  await pool.query(`DELETE FROM units WHERE id = $1`, [id]);
  res.redirect("/admin/units");
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send("CAD server error.");
});

initDatabase()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log("");
      console.log("==========================================");
      console.log("       LIBERTY CITY FIRE CAD v2");
      console.log("==========================================");
      console.log(`Port: ${PORT}`);
      console.log("CAD ONLINE");
      console.log("");
    });
  })
  .catch((err) => {
    console.error("Database initialization failed:");
    console.error(err);
    process.exit(1);
  });
