var express = require('express');
var path = require('path');
var fs = require('fs');

var app = express();
var PORT = process.env.PORT || 3000;

var STATE_FILE = path.join(__dirname, 'data', 'state.json');

var DEFAULT_STATE = {
  users: [],
  events: {},
  scores: {},
  baseScores: {},
  matchScores: {},
  headToHead: {},
  matchWins: {}
};

function safeJsonParse(value, fallback) {
  try {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function initDb() {
  return new Promise(function (resolve) {
    var dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ data: DEFAULT_STATE, revision: 0 }, null, 2), 'utf8');
    }
    resolve();
  });
}

function readState() {
  return new Promise(function (resolve) {
    try {
      var content = fs.readFileSync(STATE_FILE, 'utf8');
      var parsed = safeJsonParse(content, {});
      resolve({
        data: parsed.data || DEFAULT_STATE,
        revision: parsed.revision || 0
      });
    } catch (e) {
      resolve({ data: DEFAULT_STATE, revision: 0 });
    }
  });
}

function writeState(data, baseRevision, force) {
  return readState().then(function (current) {
    if (!force && typeof baseRevision === 'number' && baseRevision !== current.revision) {
      return { conflict: true, currentRevision: current.revision };
    }
    var nextRevision = current.revision + 1;
    fs.writeFileSync(STATE_FILE, JSON.stringify({ data: data, revision: nextRevision }, null, 2), 'utf8');
    return { revision: nextRevision };
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
  res.json({ ok: true, storage: 'file' });
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
      console.log('저장소: ' + STATE_FILE);
    });
  })
  .catch(function (err) {
    console.error('초기화 실패:', err);
    process.exit(1);
  });
