var express = require('express');
var path = require('path');
var mariadb = require('mariadb');

var app = express();
var PORT = process.env.PORT || 3000;

var DB_HOST = process.env.DB_HOST || '192.168.20.27';
var DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
var DB_USER = process.env.DB_USER || 'root';
var DB_PASSWORD = process.env.DB_PASSWORD || '740923aa';
var DB_NAME = process.env.DB_NAME || 'tennis_club';

var DEFAULT_STATE = {
  users: [],
  events: {},
  scores: {},
  baseScores: {},
  matchScores: {},
  headToHead: {},
  matchWins: {}
};

var pool = null;

function safeJsonParse(value, fallback) {
  try {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function ensureDatabase() {
  return mariadb
    .createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD })
    .then(function (conn) {
      return conn
        .query('CREATE DATABASE IF NOT EXISTS `' + DB_NAME + '`')
        .then(function () { return conn.end(); });
    });
}

function ensureSchema() {
  pool = mariadb.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    connectionLimit: 5
  });
  return pool.getConnection().then(function (conn) {
    return conn
      .query(
        'CREATE TABLE IF NOT EXISTS tennis_state (' +
          'id INT PRIMARY KEY,' +
          'data JSON NOT NULL,' +
          'revision INT NOT NULL DEFAULT 0,' +
          'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' +
        ')'
      )
      .then(function () {
        return conn.query(
          'INSERT INTO tennis_state (id, data, revision) VALUES (1, ?, 0) ' +
          'ON DUPLICATE KEY UPDATE id=id',
          [JSON.stringify(DEFAULT_STATE)]
        );
      })
      .then(function () { conn.release(); });
  });
}

function initDb() {
  return ensureDatabase().then(ensureSchema);
}

function readState() {
  return pool.getConnection().then(function (conn) {
    return conn
      .query('SELECT data, revision FROM tennis_state WHERE id=1')
      .then(function (rows) {
        conn.release();
        if (!rows || !rows.length) {
          return { data: DEFAULT_STATE, revision: 0 };
        }
        var row = rows[0];
        return {
          data: safeJsonParse(row.data, DEFAULT_STATE),
          revision: row.revision || 0
        };
      })
      .catch(function (err) {
        conn.release();
        throw err;
      });
  });
}

function writeState(data, baseRevision, force) {
  return pool.getConnection().then(function (conn) {
    return conn
      .beginTransaction()
      .then(function () {
        return conn.query('SELECT revision FROM tennis_state WHERE id=1 FOR UPDATE');
      })
      .then(function (rows) {
        var currentRevision = rows && rows[0] ? rows[0].revision : 0;
        if (!force && typeof baseRevision === 'number' && baseRevision !== currentRevision) {
          return conn.rollback().then(function () {
            conn.release();
            return { conflict: true, currentRevision: currentRevision };
          });
        }
        var nextRevision = currentRevision + 1;
        return conn
          .query('UPDATE tennis_state SET data=?, revision=? WHERE id=1', [JSON.stringify(data), nextRevision])
          .then(function () { return conn.commit(); })
          .then(function () {
            conn.release();
            return { revision: nextRevision };
          });
      })
      .catch(function (err) {
        return conn.rollback().then(function () {
          conn.release();
          throw err;
        });
      });
  });
}

app.use(express.json({ limit: '2mb' }));
app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(__dirname));

app.get('/api/health', function (req, res) {
  res.json({ ok: true, db: DB_NAME });
});

app.get('/api/state', function (req, res) {
  readState()
    .then(function (result) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: result.data, revision: result.revision });
    })
    .catch(function (err) {
      res.status(500).json({ error: err.message });
    });
});

app.post('/api/state', function (req, res) {
  try {
    var body = req.body || {};
    var data = body.data || DEFAULT_STATE;
    var baseRevision = Number.isFinite(body.baseRevision) ? body.baseRevision : null;
    var force = !!body.force;
    writeState(data, baseRevision, force)
      .then(function (result) {
        if (result && result.conflict) {
          res.status(409).json({ error: 'conflict', revision: result.currentRevision });
          return;
        }
        res.json({ ok: true, revision: result.revision });
      })
      .catch(function (err) {
        res.status(500).json({ error: err.message });
      });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

initDb()
  .then(function () {
    app.listen(PORT, function () {
      console.log('테니스 클럽 서버: http://localhost:' + PORT);
      console.log('DB: ' + DB_HOST + ':' + DB_PORT + ' / ' + DB_NAME);
    });
  })
  .catch(function (err) {
    console.error('DB 초기화 실패:', err);
    process.exit(1);
  });
