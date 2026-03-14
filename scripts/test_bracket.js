const DEFAULT_START = '07:00';
const GAME_DURATION_MIN = 40;
const GAMES_BY_GRADE = 3;
const TOTAL_GAMES = 5;
const CHECKOUT_DEFAULT_OFFSET_MIN = 240;

const state = {
  users: [],
  events: {},
  scores: {},
  baseScores: {},
  matchScores: {}
};

function pairKey(id1, id2) {
  return [id1, id2].sort().join('::');
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function getCheckOutDefault(checkInTime) {
  return minutesToTime(timeToMinutes(checkInTime || DEFAULT_START) + CHECKOUT_DEFAULT_OFFSET_MIN);
}

function getGameStartTime(dateKey, gameIndex) {
  const ev = state.events[dateKey];
  const start = ev && ev.startTime ? ev.startTime : DEFAULT_START;
  const startMin = timeToMinutes(start);
  const gameStartMin = startMin + (gameIndex - 1) * GAME_DURATION_MIN;
  return minutesToTime(gameStartMin);
}

function isAvailableForGame(dateKey, participant, gameIndex) {
  const ev = state.events[dateKey];
  const base = ev && ev.startTime ? ev.startTime : DEFAULT_START;
  const gameStart = getGameStartTime(dateKey, gameIndex);
  const gameEndMin = timeToMinutes(gameStart) + GAME_DURATION_MIN;
  const gameEnd = minutesToTime(gameEndMin);
  const checkIn = participant.checkIn || base;
  const checkOut = participant.checkOut || participant.checkIn || base;
  return timeToMinutes(checkIn) <= timeToMinutes(gameStart) && timeToMinutes(checkOut) >= timeToMinutes(gameEnd);
}

function getParticipantsForGame(dateKey, gameIndex) {
  const ev = state.events[dateKey];
  if (!ev || !ev.participants) return [];
  return ev.participants.filter(function (p) {
    return p.attend && isAvailableForGame(dateKey, p, gameIndex);
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function splitIntoTeams(four, sameDayTeammates, preferredOrder) {
  const pairs = [
    [[four[0], four[1]], [four[2], four[3]]],
    [[four[0], four[2]], [four[1], four[3]]],
    [[four[0], four[3]], [four[1], four[2]]]
  ];
  var order = preferredOrder || [0, 1, 2];
  var bestIdx = order[0];
  var bestBad = 3;
  for (var o = 0; o < order.length; o++) {
    var i = order[o];
    const [t1, t2] = pairs[i];
    const bad1 = pairKey(t1[0], t1[1]) in sameDayTeammates;
    const bad2 = pairKey(t2[0], t2[1]) in sameDayTeammates;
    var badCount = (bad1 ? 1 : 0) + (bad2 ? 1 : 0);
    if (badCount === 0) return { team1: t1, team2: t2 };
    if (badCount < bestBad) {
      bestBad = badCount;
      bestIdx = i;
    }
  }
  var best = pairs[bestIdx];
  return { team1: best[0], team2: best[1] };
}

function buildBracketForGame(dateKey, gameIndex, sameDayTeammates) {
  var participants = getParticipantsForGame(dateKey, gameIndex);
  var userById = {};
  state.users.forEach(function (u) {
    userById[u.id] = u;
  });

  if (participants.length < 4) {
    return { matches: [], waiting: participants.map(function (p) { return p.userId; }) };
  }

  var n = participants.length;
  var waitingCount = n % 4;
  var maxTries = 120;
  var best = null;
  var bestBad = 999;
  var preferredOrder = (gameIndex > GAMES_BY_GRADE) ? [2, 0, 1] : undefined;

  function buildOnce() {
    var indices = participants.map(function (_, i) { return i; });
    indices = shuffle(indices);
    var restIndices = indices.slice(0, waitingCount);
    var poolIndices = indices.slice(waitingCount);
    var waiting = restIndices.map(function (i) { return participants[i].userId; });
    var poolParticipants = poolIndices.map(function (i) { return participants[i]; });

    var ordered = poolParticipants.map(function (p) {
      var u = userById[p.userId];
      var grade = (u && u.grade) ? u.grade : 'C';
      var score = (state.scores && state.scores[p.userId] !== undefined) ? state.scores[p.userId] : (state.baseScores && state.baseScores[p.userId]) || 0;
      return { userId: p.userId, grade: grade, score: score };
    });

    if (gameIndex <= GAMES_BY_GRADE) {
      var bucketA = [];
      var bucketB = [];
      var bucketC = [];
      var bucketOther = [];
      ordered.forEach(function (p) {
        if (p.grade === 'A') bucketA.push(p);
        else if (p.grade === 'B') bucketB.push(p);
        else if (p.grade === 'C') bucketC.push(p);
        else bucketOther.push(p);
      });
      ordered = []
        .concat(shuffle(bucketA), shuffle(bucketB), shuffle(bucketC), shuffle(bucketOther));
    } else {
      ordered.forEach(function (p) { p._rnd = Math.random(); });
      ordered.sort(function (a, b) {
        var s = (b.score || 0) - (a.score || 0);
        if (s !== 0) return s;
        return a._rnd - b._rnd;
      });
    }

    var available = ordered.map(function (p) { return p.userId; });
    var matches = [];
    var i = 0;
    var localSameDay = Object.assign({}, sameDayTeammates);
    var badPairs = 0;

    while (i + 4 <= available.length) {
      var four = available.slice(i, i + 4);
      i += 4;
      var orderForFour = preferredOrder;
      if (gameIndex <= GAMES_BY_GRADE) {
        var gradeCount = {};
        four.forEach(function (id) {
          var g = (userById[id] && userById[id].grade) ? userById[id].grade : 'C';
          gradeCount[g] = (gradeCount[g] || 0) + 1;
        });
        var counts = Object.keys(gradeCount).map(function (g) { return gradeCount[g]; }).sort(function (a, b) { return b - a; });
        if (counts.length === 2 && counts[0] === 2 && counts[1] === 2) {
          orderForFour = [1, 2, 0];
        }
      }
      var spl = splitIntoTeams(four, localSameDay, orderForFour);
      var team1 = spl.team1;
      var team2 = spl.team2;
      matches.push({ team1: team1, team2: team2, winner: null });

      var k1 = pairKey(team1[0], team1[1]);
      var k2 = pairKey(team2[0], team2[1]);
      if (sameDayTeammates[k1]) badPairs++;
      if (sameDayTeammates[k2]) badPairs++;
      localSameDay[k1] = true;
      localSameDay[k2] = true;
    }

    return { matches: matches, waiting: waiting, badPairs: badPairs };
  }

  for (var t = 0; t < maxTries; t++) {
    var attempt = buildOnce();
    if (!best || attempt.badPairs < bestBad) {
      best = attempt;
      bestBad = attempt.badPairs;
    }
    if (bestBad === 0) break;
  }

  if (!best) {
    return { matches: [], waiting: participants.map(function (p) { return p.userId; }) };
  }

  (best.matches || []).forEach(function (m) {
    if (!m || !m.team1 || !m.team2) return;
    var k1 = pairKey(m.team1[0], m.team1[1]);
    var k2 = pairKey(m.team2[0], m.team2[1]);
    sameDayTeammates[k1] = true;
    sameDayTeammates[k2] = true;
  });

  return { matches: best.matches, waiting: best.waiting };
}

function ensureEvent(dateKey) {
  if (!state.events[dateKey]) {
    var defStart = DEFAULT_START;
    state.events[dateKey] = {
      startTime: defStart,
      participants: state.users.map(function (u) {
        return {
          userId: u.id,
          attend: true,
          checkIn: defStart,
          checkOut: getCheckOutDefault(defStart)
        };
      }),
      matches: []
    };
  }
  return state.events[dateKey];
}

function buildFullBracket(dateKey) {
  ensureEvent(dateKey);
  const ev = state.events[dateKey];
  if (!ev) return [];

  const sameDayTeammates = {};
  (ev.bracketSnapshot || []).forEach(function (game) {
    (game.matches || []).forEach(function (match) {
      if (match.team1 && match.team2) {
        match.team1.forEach(function (a, i) {
          match.team1.forEach(function (b, j) {
            if (i < j) sameDayTeammates[pairKey(a, b)] = true;
          });
        });
        match.team2.forEach(function (a, i) {
          match.team2.forEach(function (b, j) {
            if (i < j) sameDayTeammates[pairKey(a, b)] = true;
          });
        });
      }
    });
  });

  const result = [];
  for (let g = 1; g <= TOTAL_GAMES; g++) {
    const br = buildBracketForGame(dateKey, g, sameDayTeammates);
    result.push({
      gameIndex: g,
      startTime: getGameStartTime(dateKey, g),
      matches: br.matches,
      waiting: br.waiting
    });
  }
  ev.bracketSnapshot = JSON.parse(JSON.stringify(result));
  return result;
}

function buildUsers(count) {
  const grades = ['A', 'B', 'C'];
  const users = [];
  for (let i = 0; i < count; i++) {
    const id = 'u' + (1000 + i);
    const grade = grades[i % grades.length];
    const baseScore = Math.floor(Math.random() * 80) + 20;
    users.push({ id, name: 'User' + (i + 1), grade });
    state.baseScores[id] = baseScore;
    state.matchScores[id] = 0;
    state.scores[id] = baseScore;
  }
  state.users = users;
}

function countDuplicateTeammates(brackets) {
  const seen = new Set();
  const duplicates = new Set();
  brackets.forEach(function (b) {
    (b.matches || []).forEach(function (m) {
      const t1 = m.team1 || [];
      const t2 = m.team2 || [];
      if (t1.length === 2) {
        const k = pairKey(t1[0], t1[1]);
        if (seen.has(k)) duplicates.add(k);
        seen.add(k);
      }
      if (t2.length === 2) {
        const k = pairKey(t2[0], t2[1]);
        if (seen.has(k)) duplicates.add(k);
        seen.add(k);
      }
    });
  });
  return { duplicateCount: duplicates.size, duplicates: Array.from(duplicates) };
}

function runTrials(userCount, trials) {
  const dateKey = '2026-03-13';
  let anyDup = 0;
  let totalDupPairs = 0;
  let maxDupPairs = 0;

  buildUsers(userCount);

  for (let t = 0; t < trials; t++) {
    state.events = {};
    const brackets = buildFullBracket(dateKey);
    const res = countDuplicateTeammates(brackets);
    if (res.duplicateCount > 0) {
      anyDup++;
      totalDupPairs += res.duplicateCount;
      if (res.duplicateCount > maxDupPairs) maxDupPairs = res.duplicateCount;
    }
  }

  return { anyDup, totalDupPairs, maxDupPairs, trials };
}

const trials = 300;
const userCount = 23;
const result = runTrials(userCount, trials);

console.log('Trials:', result.trials);
console.log('Users:', userCount);
console.log('Trials with duplicate teammate pairs:', result.anyDup);
console.log('Total duplicate teammate pairs (across trials):', result.totalDupPairs);
console.log('Max duplicate pairs in a single trial:', result.maxDupPairs);
