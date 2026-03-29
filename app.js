(function () {
  'use strict';

  const DEFAULT_START = '07:15';
  const GAME_DURATION_MIN = 40;
  const GAMES_BY_GRADE = 3;
  const TOTAL_GAMES = 4;

  function getApiBase() {
    var base = (typeof window !== 'undefined' && window.TENNIS_API_BASE) ? window.TENNIS_API_BASE : '';
    return (base + '').trim();
  }
  function getStateApiUrl() {
    var base = getApiBase();
    if (!base) return '/api/state';
    return base.replace(/\/+$/, '') + '/api/state';
  }
  function useServer() {
    var p = typeof window !== 'undefined' ? window.location.protocol : '';
    return p === 'http:' || p === 'https:';
  }

  function getStartTimeOptions() {
    var opts = [];
    for (var h = 5; h <= 12; h++) {
      opts.push((h < 10 ? '0' : '') + h + ':00');
    }
    return opts;
  }

  let state = {
    users: [],
    events: {},
    scores: {},
    baseScores: {},
    matchScores: {},
    headToHead: {},
    matchWins: {},
    currentMonth: null,
    selectedDate: null,
    vsUserId: null,
    memberPassword: '1234',
    selectedMemberId: null,
    dataSource: 'local',
    revision: 0,
    syncConflict: false,
    syncInFlight: false,
    syncPending: false
  };

  var localSnapshot = null;

  function applyStateData(data) {
    if (!data) return;
    if (data.users) state.users = data.users;
    if (data.events) state.events = data.events;
    if (data.baseScores) state.baseScores = data.baseScores;
    if (data.matchScores) state.matchScores = data.matchScores;
    if (data.headToHead) {
      try {
        state.headToHead = data.headToHead;
      } catch (e) {
        state.headToHead = {};
      }
    }
    if (data.matchWins) {
      try {
        state.matchWins = data.matchWins;
      } catch (e) {
        state.matchWins = {};
      }
    }
    if (!state.baseScores) state.baseScores = {};
    if (!state.matchScores) state.matchScores = {};
    if (!state.headToHead) state.headToHead = {};
    if (!state.matchWins) state.matchWins = {};
    updateTotalScores();
  }

  function normalizeSnapshot(s) {
    var snap = s || {};
    return {
      users: snap.users || [],
      events: snap.events || {},
      scores: snap.scores || {},
      baseScores: snap.baseScores || {},
      matchScores: snap.matchScores || {},
      headToHead: snap.headToHead || {},
      matchWins: snap.matchWins || {}
    };
  }

  function summarizeSnapshot(snap) {
    var s = normalizeSnapshot(snap);
    var eventKeys = Object.keys(s.events || {});
    var latestDate = eventKeys.length ? eventKeys.sort().pop() : '';
    var appliedResults = 0;
    eventKeys.forEach(function (k) {
      var ev = s.events[k] || {};
      if (ev.appliedMatchResults && ev.appliedMatchResults.length) {
        appliedResults += ev.appliedMatchResults.length;
      }
    });
    return {
      users: (s.users || []).length,
      events: eventKeys.length,
      appliedResults: appliedResults,
      latestDate: latestDate
    };
  }

  function fetchServerSnapshot(cb) {
    if (!useServer()) {
      cb(new Error('서버를 사용할 수 없습니다.'));
      return;
    }
    var url = getStateApiUrl();
    fetch(url, { method: 'GET', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        if (payload && payload.data) {
          cb(null, normalizeSnapshot(payload.data));
        } else {
          cb(new Error('서버 데이터를 불러올 수 없습니다.'));
        }
      })
      .catch(function (err) {
        cb(err || new Error('서버 데이터를 불러올 수 없습니다.'));
      });
  }

  function readLocalSnapshotFromStorage() {
    try {
      var snap = {
        users: JSON.parse(localStorage.getItem('tennis_users') || '[]'),
        events: JSON.parse(localStorage.getItem('tennis_events') || '{}'),
        scores: JSON.parse(localStorage.getItem('tennis_scores') || '{}'),
        baseScores: JSON.parse(localStorage.getItem('tennis_baseScores') || '{}'),
        matchScores: JSON.parse(localStorage.getItem('tennis_matchScores') || '{}'),
        headToHead: JSON.parse(localStorage.getItem('tennis_headToHead') || '{}'),
        matchWins: JSON.parse(localStorage.getItem('tennis_matchWins') || '{}')
      };
      return normalizeSnapshot(snap);
    } catch (e) {
      console.error('로컬 스냅샷 읽기 실패:', e);
      return null;
    }
  }

  function isSnapshotEmpty(snap) {
    if (!snap) return true;
    return (!snap.users || snap.users.length === 0) &&
      (!snap.events || Object.keys(snap.events).length === 0);
  }

  function loadStateFromLocal() {
    try {
      var u = localStorage.getItem('tennis_users');
      if (u) state.users = JSON.parse(u);
      var e = localStorage.getItem('tennis_events');
      if (e) state.events = JSON.parse(e);
      var bs = localStorage.getItem('tennis_baseScores');
      if (bs) {
        state.baseScores = JSON.parse(bs);
      }
      var ms = localStorage.getItem('tennis_matchScores');
      if (ms) {
        state.matchScores = JSON.parse(ms);
      }
      if (!state.baseScores) state.baseScores = {};
      if (!state.matchScores) state.matchScores = {};
      var h = localStorage.getItem('tennis_headToHead');
      if (h) {
        try {
          state.headToHead = JSON.parse(h);
        } catch (e) {
          console.error('headToHead 파싱 오류:', e);
          state.headToHead = {};
        }
      } else {
        state.headToHead = {};
      }
      var mw = localStorage.getItem('tennis_matchWins');
      if (mw) {
        try {
          state.matchWins = JSON.parse(mw);
        } catch (e) {
          console.error('matchWins 파싱 오류:', e);
          state.matchWins = {};
        }
      } else {
        state.matchWins = {};
      }
      var rev = localStorage.getItem('tennis_revision');
      if (rev !== null && rev !== undefined) {
        state.revision = parseInt(rev, 10) || 0;
      }
      console.log('loadStateFromLocal - headToHead 로드:', Object.keys(state.headToHead || {}).length, '개');
      updateTotalScores();
    } catch (err) {
      console.error(err);
    }
  }

  function clearAllMatchData() {
    // 모든 경기 데이터 삭제
    state.events = {};
    state.matchScores = {};
    state.headToHead = {};
    state.matchWins = {};
    // baseScores는 유지 (user.txt에서 온 데이터)
    // 모든 사용자의 matchScores를 0으로 초기화
    if (state.users && state.users.length > 0) {
      state.users.forEach(function(u) {
        state.matchScores[u.id] = 0;
      });
    }
    updateTotalScores();
    saveState();
    console.log('모든 경기 데이터가 삭제되었습니다.');
  }
  
  function updateTotalScores() {
    state.scores = {};
    if (state.baseScores) {
      Object.keys(state.baseScores).forEach(function (id) {
        state.scores[id] = (state.baseScores[id] || 0) + (state.matchScores[id] || 0);
      });
    }
    if (state.matchScores) {
      Object.keys(state.matchScores).forEach(function (id) {
        if (state.scores[id] === undefined) {
          state.scores[id] = (state.baseScores[id] || 0) + (state.matchScores[id] || 0);
        }
      });
    }
  }

  function computeTeamScore(team) {
    if (!Array.isArray(team) || team.length === 0) return 0;
    return team.reduce(function (sum, id) {
      var value = 0;
      if (state.scores && typeof state.scores[id] === 'number') {
        value = state.scores[id];
      } else if (state.baseScores && typeof state.baseScores[id] === 'number') {
        value = state.baseScores[id];
      }
      return sum + (value || 0);
    }, 0);
  }

  function determineTeamGroup(team, groupAssignments) {
    if (!Array.isArray(team) || team.length === 0) return 'UNASSIGNED';
    var groups = [];
    team.forEach(function (id) {
      if (groupAssignments && groupAssignments[id]) {
        groups.push(groupAssignments[id]);
      }
    });
    var unique = [];
    groups.forEach(function (g) {
      if (unique.indexOf(g) === -1) unique.push(g);
    });
    if (unique.length === 0) return 'UNASSIGNED';
    if (unique.length === 1) return unique[0];
    return 'MIXED';
  }

  function formatGroupLabel(groupKey) {
    if (!groupKey) return '';
    switch (groupKey.toUpperCase()) {
      case 'A': return 'A그룹';
      case 'B': return 'B그룹';
      case 'MIXED': return '혼합';
      default: return '';
    }
  }

  function rebuildHeadToHeadFromEvents() {
    // 기존 경기 결과를 기반으로 headToHead와 matchWins 재구성
    console.log('rebuildHeadToHeadFromEvents 시작');
    
    // 먼저 기존 headToHead와 matchWins만 초기화 (matchScores는 유지)
    state.headToHead = {};
    state.matchWins = {};
    
    // matchScores도 재계산을 위해 초기화 (기존 값이 잘못되었을 수 있음)
    var oldMatchScores = JSON.parse(JSON.stringify(state.matchScores || {}));
    state.matchScores = {};
    
    // 모든 이벤트의 appliedMatchResults를 순회하여 재구성
    var processedCount = 0;
    Object.keys(state.events).forEach(function(dateKey) {
      var ev = state.events[dateKey];
      if (!ev || !ev.appliedMatchResults || ev.appliedMatchResults.length === 0) return;
      if (!ev.bracketSnapshot) {
        console.log('rebuildHeadToHeadFromEvents - bracketSnapshot 없음:', dateKey);
        return;
      }
      
      var snap = ev.bracketSnapshot;
      console.log('rebuildHeadToHeadFromEvents - 처리 중:', dateKey, '경기 수:', ev.appliedMatchResults.length);
      
      ev.appliedMatchResults.forEach(function(ar) {
        var game = snap.find(function(g) { return g.gameIndex === ar.gameIndex; });
        if (!game || !game.matches || !game.matches[ar.matchIdx]) {
          console.log('rebuildHeadToHeadFromEvents - 경기 찾기 실패:', ar.gameIndex, ar.matchIdx);
          return;
        }
        var m = game.matches[ar.matchIdx];
        if (!m.team1 || !m.team2 || !ar.winner) {
          console.log('rebuildHeadToHeadFromEvents - 경기 데이터 불완전:', m);
          return;
        }
        
        // applyResult를 호출하여 headToHead와 matchWins 재구성
        applyResult({ team1: m.team1, team2: m.team2, winner: ar.winner });
        processedCount++;
      });
    });
    
    updateTotalScores();
    console.log('rebuildHeadToHeadFromEvents 완료, 처리된 경기 수:', processedCount, 'headToHead 항목 수:', Object.keys(state.headToHead).length);
    console.log('rebuildHeadToHeadFromEvents - headToHead 샘플:', JSON.stringify(Object.keys(state.headToHead).slice(0, 5)));
  }

  function loadState(cb) {
    cb = cb || function () {};
    function afterLoad() {
      try {
        console.log('loadState 완료, 사용자 수:', state.users ? state.users.length : 0);
        var hasHeadToHead = state.headToHead && Object.keys(state.headToHead).length > 0;
        var hasMatchWins = state.matchWins && Object.keys(state.matchWins).length > 0;
        var hasAppliedResults = false;
        Object.keys(state.events).forEach(function(dateKey) {
          var ev = state.events[dateKey];
          if (ev && ev.appliedMatchResults && ev.appliedMatchResults.length > 0) {
            hasAppliedResults = true;
          }
        });
        if (hasAppliedResults && (!hasHeadToHead || !hasMatchWins)) {
          console.log('headToHead 또는 matchWins가 비어있어 기존 경기 결과로 재구성합니다.');
          rebuildHeadToHeadFromEvents();
          saveState();
        }
        cb(false);
      } catch (e) {
        console.error('loadState 오류:', e);
        cb(false);
      }
    }
    if (useServer()) {
      var url = getStateApiUrl();
      fetch(url, { method: 'GET', cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (payload) {
          if (payload && payload.data) {
            applyStateData(payload.data);
            state.revision = payload.revision || 0;
            saveState({ skipServer: true });
            state.dataSource = 'server';
            console.log('loadState - 서버(DB)에서 불러옴:', url);
          } else {
            state.dataSource = 'local';
            loadStateFromLocal();
          }
          afterLoad();
        })
        .catch(function () {
          state.dataSource = 'local';
          loadStateFromLocal();
          afterLoad();
        });
    } else {
      state.dataSource = 'local';
      try {
        loadStateFromLocal();
      } catch (e) {
        console.error('loadState 오류:', e);
      }
      afterLoad();
    }
  }

  function refetchFromServer(cb) {
    if (!useServer()) {
      if (cb) cb(false);
      return;
    }
    var url = getStateApiUrl();
    fetch(url, { method: 'GET', cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        if (payload && payload.data) {
          applyStateData(payload.data);
          state.revision = payload.revision || 0;
          saveState({ skipServer: true });
          state.dataSource = 'server';
          if (cb) cb(true);
        } else {
          if (cb) cb(false);
        }
      })
      .catch(function () {
        if (cb) cb(false);
      });
  }

  function saveState(options) {
    updateTotalScores();
    localStorage.setItem('tennis_users', JSON.stringify(state.users));
    localStorage.setItem('tennis_events', JSON.stringify(state.events));
    localStorage.setItem('tennis_scores', JSON.stringify(state.scores));
    localStorage.setItem('tennis_baseScores', JSON.stringify(state.baseScores));
    localStorage.setItem('tennis_matchScores', JSON.stringify(state.matchScores));
    localStorage.setItem('tennis_headToHead', JSON.stringify(state.headToHead));
    localStorage.setItem('tennis_matchWins', JSON.stringify(state.matchWins));
    localStorage.setItem('tennis_revision', String(state.revision || 0));
    if (!options || !options.skipServer) {
      syncStateToServer();
    }
  }

  function buildStatePayload() {
    updateTotalScores();
    return {
      users: state.users,
      events: state.events,
      scores: state.scores,
      baseScores: state.baseScores,
      matchScores: state.matchScores,
      headToHead: state.headToHead,
      matchWins: state.matchWins
    };
  }

  function handleSyncConflict() {
    if (state.syncConflict) return;
    state.syncConflict = true;
    alert('다른 사람이 먼저 저장했습니다. 최신 데이터로 다시 불러옵니다.');
    refetchFromServer(function () {
      state.syncConflict = false;
      location.reload();
    });
  }

  function syncStateToServer() {
    if (!useServer()) return;
    if (state.syncInFlight) {
      state.syncPending = true;
      return;
    }
    state.syncInFlight = true;
    var url = getStateApiUrl();
    var payload = buildStatePayload();
    var baseRevision = state.revision || 0;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: payload, baseRevision: baseRevision })
    })
      .then(function (res) {
        if (res.status === 409) {
          handleSyncConflict();
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && typeof data.revision === 'number') {
          state.revision = data.revision;
          localStorage.setItem('tennis_revision', String(state.revision || 0));
        }
      })
      .catch(function (err) {
        console.error('서버 저장 실패:', err);
      })
      .finally(function () {
        state.syncInFlight = false;
        if (state.syncPending) {
          state.syncPending = false;
          syncStateToServer();
        }
      });
  }

  function uploadSnapshotToServer(snapshot, force) {
    if (!useServer()) return;
    var url = getStateApiUrl();
    var payload = normalizeSnapshot(snapshot);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: payload,
        baseRevision: state.revision || 0,
        force: !!force
      })
    })
      .then(function (res) {
        if (res.status === 409) return { conflict: true };
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.conflict) {
          alert('서버 데이터가 먼저 변경되었습니다. 다시 시도해 주세요.');
          return;
        }
        if (data && typeof data.revision === 'number') {
          state.revision = data.revision;
          localStorage.setItem('tennis_revision', String(state.revision || 0));
        }
        applyStateData(payload);
        saveState({ skipServer: true });
        alert('로컬 데이터를 서버(DB)에 업로드했습니다.');
        location.reload();
      })
      .catch(function (err) {
        console.error('로컬 업로드 실패:', err);
        alert('서버 업로드에 실패했습니다.');
      });
  }

  function downloadStateFile() {
    var payload = buildStatePayload();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'state.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function getDateKey(date) {
    if (!date) return '';
    var d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0') + '-' + (d.getDate().toString().padStart(2, '0'));
  }

  function isPastDate(dateKey) {
    var todayKey = getDateKey(new Date());
    return dateKey < todayKey;
  }

  function pairKey(id1, id2) {
    // ID 내부에 _가 있으므로 다른 구분자 사용
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

  function getCheckInOptions() {
    var opts = [];
    for (var i = 1; i <= TOTAL_GAMES; i++) opts.push(i);
    return opts;
  }

  function getCheckOutOptions(checkIn) {
    var opts = [];
    var ci = parseInt(checkIn) || 1;
    for (var i = ci + 1; i <= TOTAL_GAMES; i++) opts.push(i);
    return opts;
  }

  function getGameStartTime(dateKey, gameIndex) {
    const ev = state.events[dateKey];
    const start = ev && ev.startTime ? ev.startTime : DEFAULT_START;
    const startMin = timeToMinutes(start);
    const gameStartMin = startMin + (gameIndex - 1) * GAME_DURATION_MIN;
    return minutesToTime(gameStartMin);
  }

  function isAvailableForGame(dateKey, participant, gameIndex) {
    var checkIn = parseInt(participant.checkIn) || 1;
    var checkOut = parseInt(participant.checkOut) || TOTAL_GAMES;
    if (checkOut < checkIn) checkOut = TOTAL_GAMES;
    return checkIn <= gameIndex && gameIndex <= checkOut;
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

  // preferredOrder: 시도 순서 [0,1,2]. 기본은 [0,1,2]. 무작위 게임에서는 [2,0,1]로 (1등+꼴찌 vs 2등+2꼴찌) 우선
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

  function buildBracketForGame(dateKey, gameIndex, sameDayTeammates, prevWaiting) {
    var participants = getParticipantsForGame(dateKey, gameIndex);

    if (participants.length < 4) {
      return { matches: [], waiting: participants.map(function (p) { return p.userId; }) };
    }

    var n = participants.length;
    var waitingCount = n % 4;
    var maxTries = 120;
    var best = null;
    var bestBad = 999;
    var groupAssignments = {};
    function annotateMatch(match) {
      match.groupInfo = {
        team1Group: determineTeamGroup(match.team1, groupAssignments),
        team2Group: determineTeamGroup(match.team2, groupAssignments)
      };
      return match;
    }
    function createMatch(team1, team2) {
      return annotateMatch({ team1: team1, team2: team2, winner: null });
    }

    // 점수 포함한 참여자 목록 구성
    var enriched = participants.map(function (p) {
      var score = (state.scores && state.scores[p.userId] !== undefined) ? state.scores[p.userId] : (state.baseScores && state.baseScores[p.userId]) || 0;
      return { userId: p.userId, score: score };
    });

    if (gameIndex <= GAMES_BY_GRADE) {
      // 1~3게임: 점수순으로 절반을 A그룹(상위), 나머지를 B그룹(하위)으로 나눠 대진 구성
      var sorted = enriched.slice().sort(function (a, b) { return b.score - a.score; });
      var mid = Math.ceil(sorted.length / 2);
      var groupA = sorted.slice(0, mid);  // 상위 절반
      var groupB = sorted.slice(mid);     // 하위 절반
      groupA.forEach(function (p) { groupAssignments[p.userId] = 'A'; });
      groupB.forEach(function (p) { groupAssignments[p.userId] = 'B'; });

      function buildOnceAB() {
        // 전체 인원에서 랜덤하게 대기자 차출
        var shuffledAll = shuffle(enriched.slice());
        var waiters = shuffledAll.slice(0, waitingCount).map(function (p) { return p.userId; });
        var waiterSet = {};
        waiters.forEach(function (id) { waiterSet[id] = true; });

        // 대기자를 제외한 A, B 그룹 (순서 섞기)
        var activeA = shuffle(groupA.filter(function (p) { return !waiterSet[p.userId]; }));
        var activeB = shuffle(groupB.filter(function (p) { return !waiterSet[p.userId]; }));

        var aPool = activeA.slice();
        var bPool = activeB.slice();
        var matches = [];
        var badPairs = 0;
        var localSameDay = Object.assign({}, sameDayTeammates);

        // A그룹에서 4명씩 매치 구성
        while (aPool.length >= 4) {
          var four = aPool.splice(0, 4).map(function (p) { return p.userId; });
          var spl = splitIntoTeams(four, localSameDay, undefined);
          matches.push(createMatch(spl.team1, spl.team2));
          var k1 = pairKey(spl.team1[0], spl.team1[1]);
          var k2 = pairKey(spl.team2[0], spl.team2[1]);
          if (sameDayTeammates[k1]) badPairs++;
          if (sameDayTeammates[k2]) badPairs++;
          localSameDay[k1] = true;
          localSameDay[k2] = true;
        }

        // A그룹 잔여(1~3명)가 있으면 B그룹에서 보충해 4명 구성
        if (aPool.length > 0 && aPool.length < 4) {
          var needed = 4 - aPool.length;
          if (bPool.length >= needed) {
            var fromB = bPool.splice(0, needed);
            var four = shuffle(aPool.map(function (p) { return p.userId; }).concat(fromB.map(function (p) { return p.userId; })));
            var spl = splitIntoTeams(four, localSameDay, undefined);
            matches.push(createMatch(spl.team1, spl.team2));
            var k1 = pairKey(spl.team1[0], spl.team1[1]);
            var k2 = pairKey(spl.team2[0], spl.team2[1]);
            if (sameDayTeammates[k1]) badPairs++;
            if (sameDayTeammates[k2]) badPairs++;
            localSameDay[k1] = true;
            localSameDay[k2] = true;
            aPool = [];
          }
        }

        // B그룹 남은 인원으로 매치 구성
        while (bPool.length >= 4) {
          var four = bPool.splice(0, 4).map(function (p) { return p.userId; });
          var spl = splitIntoTeams(four, localSameDay, undefined);
          matches.push(createMatch(spl.team1, spl.team2));
          var k1 = pairKey(spl.team1[0], spl.team1[1]);
          var k2 = pairKey(spl.team2[0], spl.team2[1]);
          if (sameDayTeammates[k1]) badPairs++;
          if (sameDayTeammates[k2]) badPairs++;
          localSameDay[k1] = true;
          localSameDay[k2] = true;
        }

        return { matches: matches, waiting: waiters, badPairs: badPairs };
      }

      for (var t = 0; t < maxTries; t++) {
        var attempt = buildOnceAB();
        if (!best || attempt.badPairs < bestBad) {
          best = attempt;
          bestBad = attempt.badPairs;
        }
        if (bestBad === 0) break;
      }

    } else if (gameIndex === GAMES_BY_GRADE + 1) {
      // 4번째 게임: 점수 내림차순 정렬 후 [1위+꼴찌] vs [2위+2꼴찌], [3위+3꼴찌] vs [4위+4꼴찌] ... 방식
      var sorted4 = enriched.slice().sort(function (a, b) {
        var s = b.score - a.score;
        return s !== 0 ? s : (Math.random() - 0.5);
      });
      var activeCount4 = n - waitingCount;
      // 하위 waitingCount명 대기
      var waiters4 = sorted4.slice(activeCount4).map(function (p) { return p.userId; });
      var active4 = sorted4.slice(0, activeCount4);
      var matches4 = [];
      var left4 = 0, right4 = activeCount4 - 1;
      while (left4 < right4) {
        // [1위+꼴찌] vs [2위+2꼴찌] 순으로 팀 구성
        matches4.push(createMatch(
          [active4[left4].userId, active4[right4].userId],
          [active4[left4 + 1].userId, active4[right4 - 1].userId]
        ));
        left4 += 2;
        right4 -= 2;
      }
      best = { matches: matches4, waiting: waiters4 };

    } else {
      // 5번째 게임: 4번째 대기인원 복귀 + shifted pairing [1위+2꼴찌] vs [2위+3꼴찌] ...
      // 마지막 매치에 제외했던 꼴찌 추가 → 전원 출전 보장
      var game4WaiterSet = {};
      (prevWaiting || []).forEach(function (id) { game4WaiterSet[id] = true; });

      var sorted5 = enriched.slice().sort(function (a, b) {
        var s = b.score - a.score;
        return s !== 0 ? s : (Math.random() - 0.5);
      });

      // 4번째 게임 출전 인원 중 하위 waitingCount명이 5번째 게임 대기
      var game4Active5 = sorted5.filter(function (p) { return !game4WaiterSet[p.userId]; });
      var game5WaiterCount = waitingCount;
      var game5WaitersArr = game4Active5.length >= game5WaiterCount
        ? game4Active5.slice(game4Active5.length - game5WaiterCount).map(function (p) { return p.userId; })
        : game4Active5.map(function (p) { return p.userId; });
      var game5WaiterSet = {};
      game5WaitersArr.forEach(function (id) { game5WaiterSet[id] = true; });

      // 5번째 게임 출전 = 전체 중 game5 대기 제외 (4번째 대기인원은 포함)
      var game5Active = sorted5.filter(function (p) { return !game5WaiterSet[p.userId]; });
      var M5 = game5Active.length;
      var matches5 = [];

      if (M5 >= 4) {
        // right = M5-2: 꼴찌(M5-1)는 마지막 매치에 별도 배정
        var left5 = 0, right5 = M5 - 2;
        while (left5 + 3 <= right5) {
          matches5.push(createMatch(
            [game5Active[left5].userId, game5Active[right5].userId],
            [game5Active[left5 + 1].userId, game5Active[right5 - 1].userId]
          ));
          left5 += 2;
          right5 -= 2;
        }
        // 마지막 매치: 남은 3명 + 꼴찌(game5Active[M5-1])
        matches5.push(createMatch(
          [game5Active[left5].userId, game5Active[right5].userId],
          [game5Active[left5 + 1].userId, game5Active[M5 - 1].userId]
        ));
      }

      best = { matches: matches5, waiting: game5WaitersArr };
    }

    if (!best) {
      return { matches: [], waiting: participants.map(function (p) { return p.userId; }) };
    }

    // 최종 선택된 매치의 팀 페어를 기록 (이후 게임 동일팀 방지)
    (best.matches || []).forEach(function (m) {
      if (!m || !m.team1 || !m.team2) return;
      var k1 = pairKey(m.team1[0], m.team1[1]);
      var k2 = pairKey(m.team2[0], m.team2[1]);
      sameDayTeammates[k1] = true;
      sameDayTeammates[k2] = true;
    });

    return { matches: best.matches, waiting: best.waiting };
  }

  function buildFullBracket(dateKey, forceRebuild) {
    ensureEvent(dateKey);
    const ev = state.events[dateKey];
    if (!ev) return [];
    if (ev.bracketSnapshot && !forceRebuild) {
      const snap = JSON.parse(JSON.stringify(ev.bracketSnapshot));
      (ev.matchResults || []).forEach(function (gr) {
        const game = snap.find(function (b) { return b.gameIndex === gr.gameIndex; });
        if (!game || !game.matches[gr.matchIdx]) return;
        game.matches[gr.matchIdx].winner = gr.winner;
      });
      return snap;
    }
    // 같은 날 같은 팀이었던 페어만 기록 (상대 팀 페어는 제외)
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
    var prevGameWaiting = null;
    for (let g = 1; g <= TOTAL_GAMES; g++) {
      const br = buildBracketForGame(dateKey, g, sameDayTeammates, prevGameWaiting);
      result.push({
        gameIndex: g,
        startTime: getGameStartTime(dateKey, g),
        matches: br.matches,
        waiting: br.waiting
      });
      if (g === GAMES_BY_GRADE + 1) {
        prevGameWaiting = br.waiting; // 4번째 게임 대기자 → 5번째 게임에 전달
      }
    }
    ev.bracketSnapshot = JSON.parse(JSON.stringify(result));
    var parts = (ev.participants || []).map(function (p) {
      return { userId: p.userId, attend: !!p.attend, checkIn: p.checkIn || '', checkOut: p.checkOut || '' };
    });
    ev.bracketParticipationSnapshot = parts;
    return result;
  }

  function participationUnchanged(ev) {
    var snap = ev.bracketParticipationSnapshot;
    if (!snap || !ev.participants) return !ev.bracketSnapshot || ev.bracketSnapshot.length === 0;
    if (snap.length !== ev.participants.length) return false;
    var byId = {};
    ev.participants.forEach(function (p) {
      byId[p.userId] = p;
    });
    for (var i = 0; i < snap.length; i++) {
      var s = snap[i];
      var p = byId[s.userId];
      if (!p) return false;
      if (!!p.attend !== s.attend) return false;
      if ((p.checkIn || '') !== s.checkIn) return false;
      if ((p.checkOut || '') !== s.checkOut) return false;
    }
    return true;
  }

  function ensureEvent(dateKey) {
    if (!state.events[dateKey]) {
      var defStart = DEFAULT_START;
      state.events[dateKey] = {
        startTime: defStart,
        participants: state.users.map(function (u) {
          return {
            userId: u.id,
            attend: false,
            checkIn: defStart,
            checkOut: getCheckOutDefault(defStart)
          };
        }),
        matches: []
      };
    }
    const ev = state.events[dateKey];
    const userIds = state.users.map(function (u) { return u.id; });
    ev.participants = ev.participants || [];
    const existingIds = new Set(ev.participants.map(function (p) { return p.userId; }));
    state.users.forEach(function (u) {
      if (!existingIds.has(u.id)) {
        var st = ev.startTime || DEFAULT_START;
        ev.participants.push({
          userId: u.id,
          attend: false,
          checkIn: st,
          checkOut: getCheckOutDefault(st)
        });
      }
    });
    ev.participants = ev.participants.filter(function (p) {
      return userIds.indexOf(p.userId) !== -1;
    });
    (ev.participants || []).forEach(function (p) {
      var ci = p.checkIn || ev.startTime || DEFAULT_START;
      var co = p.checkOut || ci;
      if (!p.checkOut || timeToMinutes(co) <= timeToMinutes(ci)) {
        p.checkOut = getCheckOutDefault(ci);
      }
    });
    return ev;
  }

  function parseUserTxt(text, cb, updateMode) {
    try {
      const lines = text.split('\n').map(function (line) { return line.trim(); }).filter(function (line) { return line.length > 0 && !line.startsWith('#'); });
      if (!lines.length) {
        cb(new Error('user.txt 파일이 비어있습니다.'));
        return;
      }
      
      var existingUsersByName = {};
      if (updateMode && state.users && state.users.length > 0) {
        state.users.forEach(function (u) {
          existingUsersByName[u.name] = u;
        });
      }
      
      const users = [];
      var headerSkipped = false;
      var userIndex = 0; // 헤더를 제외한 실제 사용자 인덱스
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 탭 또는 쉼표로 구분 (탭 우선)
        var parts;
        if (line.indexOf('\t') >= 0) {
          parts = line.split('\t').map(function (p) { return p.trim(); });
        } else {
          parts = line.split(',').map(function (p) { return p.trim(); });
        }
        if (parts.length < 1 || !parts[0]) continue;
        
        // 헤더 줄인 경우 건너뛰기 (이름, 그레이드, 점수 등)
        var isHeader = false;
        var firstPartLower = parts[0].toLowerCase();
        if (firstPartLower === '이름' || firstPartLower === 'name' || 
            firstPartLower === '그레이드' || firstPartLower === 'grade' || 
            firstPartLower === '점수' || firstPartLower === 'score' ||
            (parts.length >= 2 && (parts[1].toLowerCase() === '그레이드' || parts[1].toLowerCase() === 'grade')) ||
            (parts.length >= 3 && (parts[2].toLowerCase() === '점수' || parts[2].toLowerCase() === 'score'))) {
          isHeader = true;
          headerSkipped = true;
        }
        if (isHeader) continue;
        
        const name = parts[0];
        // 형식: 이름\t그레이드\t점수 (탭 구분) 또는 이름,그레이드,점수 (쉼표 구분)
        var score, grade;
        if (parts.length >= 3) {
          // 이름, 그레이드, 점수 형식 (탭 또는 쉼표)
          grade = String(parts[1]).trim().toUpperCase().replace(/[^ABC]/g, '') || 'C';
          score = parseFloat(parts[2]) || 0;
        } else if (parts.length >= 2) {
          // 이름, 점수 또는 이름, 그레이드 형식
          var secondPart = parts[1];
          // 숫자인지 확인
          if (!isNaN(parseFloat(secondPart)) && isFinite(secondPart)) {
            score = parseFloat(secondPart) || 0;
            grade = 'C'; // 기본값
          } else {
            // 그레이드인 경우
            grade = String(secondPart).trim().toUpperCase().replace(/[^ABC]/g, '') || 'C';
            score = 0; // 기본값
          }
        } else {
          score = 0;
          grade = 'C';
        }
        
        var user;
        if (updateMode && existingUsersByName[name]) {
          // 기존 사용자 업데이트
          user = existingUsersByName[name];
          user.grade = grade === 'A' || grade === 'B' ? grade : 'C';
          // baseScores 강제 업데이트
          state.baseScores[user.id] = score;
          if (state.matchScores[user.id] === undefined) {
            state.matchScores[user.id] = 0;
          }
        } else {
          // 새 사용자 생성
          var baseTime = updateMode ? Date.now() : (Date.now() - 1000000);
          user = {
            id: 'u' + baseTime + '_' + userIndex,
            name: name,
            grade: grade === 'A' || grade === 'B' ? grade : 'C'
          };
          state.baseScores[user.id] = score;
          if (state.matchScores[user.id] === undefined) {
            state.matchScores[user.id] = 0;
          }
        }
        users.push(user);
        userIndex++;
      }
      
      if (!users.length) {
        cb(new Error('사용자 데이터가 없습니다.'));
        return;
      }
      
      // 업데이트 모드: user.txt에 없는 사용자는 제거하고, 모든 사용자의 baseScores를 user.txt에서 강제로 업데이트
      if (updateMode && state.users && state.users.length > 0) {
        var existingIds = {};
        users.forEach(function (u) { existingIds[u.id] = true; });
        var removedUsers = state.users.filter(function (u) { return !existingIds[u.id]; });
        removedUsers.forEach(function (u) {
          delete state.baseScores[u.id];
          delete state.matchScores[u.id];
          delete state.scores[u.id];
          Object.keys(state.headToHead).forEach(function (key) {
            var [id1, id2] = key.split('::');
            if (id1 === u.id || id2 === u.id) {
              delete state.headToHead[key];
            }
          });
        });
      }
      
      state.users = users;
      if (!state.baseScores) state.baseScores = {};
      if (!state.matchScores) state.matchScores = {};
      
      // 모든 사용자의 matchScores가 초기화되어 있는지 확인 (기존 matchScores 유지)
      users.forEach(function(u) {
        if (state.matchScores[u.id] === undefined) {
          state.matchScores[u.id] = 0;
        }
        // baseScores는 이미 위에서 설정되었지만, 혹시 모를 경우를 대비해 확인
        if (state.baseScores[u.id] === undefined || state.baseScores[u.id] === null) {
          console.warn('경고: 사용자', u.name, '의 baseScores가 설정되지 않았습니다.');
        }
      });
      
      // 모든 사용자의 baseScores가 제대로 설정되었는지 확인 및 로그
      console.log('parseUserTxt 완료 - 사용자 수:', users.length);
      console.log('baseScores 전체:', JSON.stringify(state.baseScores));
      console.log('matchScores 전체:', JSON.stringify(state.matchScores));
      users.forEach(function(u) {
        var baseScore = state.baseScores[u.id];
        var matchScore = state.matchScores[u.id] || 0;
        var totalScore = (baseScore || 0) + matchScore;
        console.log('사용자:', u.name, 'ID:', u.id, 'baseScore:', baseScore, 'matchScore:', matchScore, 'totalScore:', totalScore);
        if (baseScore === undefined || baseScore === null) {
          console.error('오류: 사용자', u.name, '의 baseScore가 설정되지 않았습니다!');
        }
      });
      
      updateTotalScores();
      console.log('updateTotalScores 후 scores:', JSON.stringify(state.scores));
      saveState();
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  function loadUserTxtFromFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var text = e.target.result;
        if (text && text.trim()) {
          var updateMode = state.users && state.users.length > 0;
          parseUserTxt(text, cb, updateMode);
        } else {
          cb(new Error('user.txt 파일이 비어있습니다.'));
        }
      } catch (err) {
        cb(new Error('파일을 읽는 중 오류가 발생했습니다: ' + err.message));
      }
    };
    reader.onerror = function() {
      cb(new Error('파일을 읽을 수 없습니다.'));
    };
    reader.readAsText(file, 'UTF-8');
  }

  function loadUserTxtFromServer(cb) {
    // file:// 프로토콜일 때는 서버 요청을 하지 않음 (CORS 에러 방지)
    if (window.location.protocol === 'file:') {
      var fileInputContainer = document.getElementById('file-input-container');
      if (fileInputContainer) {
        fileInputContainer.style.display = 'block';
      }
      cb(new Error('로컬 파일에서는 서버를 사용할 수 없습니다. 아래 버튼을 클릭하여 파일을 직접 선택해주세요.'));
      return;
    }
    
    var timeoutId = setTimeout(function () {
      // 서버가 없으면 파일 입력을 표시
      var fileInputContainer = document.getElementById('file-input-container');
      if (fileInputContainer) {
        fileInputContainer.style.display = 'block';
      }
      cb(new Error('서버에서 파일을 불러올 수 없습니다. 아래 버튼을 클릭하여 파일을 직접 선택해주세요.'));
    }, 2000);
    
    fetch('user.txt')
      .then(function (res) {
        clearTimeout(timeoutId);
        if (!res.ok) {
          throw new Error('user.txt를 찾을 수 없습니다. (HTTP ' + res.status + ')');
        }
        return res.text();
      })
      .then(function (text) {
        clearTimeout(timeoutId);
        if (text && text.trim()) {
          var updateMode = state.users && state.users.length > 0;
          parseUserTxt(text, cb, updateMode);
        } else {
          cb(new Error('user.txt 파일이 비어있습니다.'));
        }
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        // 서버가 없으면 파일 입력을 표시
        var fileInputContainer = document.getElementById('file-input-container');
        if (fileInputContainer) {
          fileInputContainer.style.display = 'block';
        }
        var errorMessage = '서버에서 파일을 불러올 수 없습니다. 아래 버튼을 클릭하여 파일을 직접 선택해주세요.';
        cb(new Error(errorMessage));
      });
  }

  function showBracketToast(message) {
    var existing = document.getElementById('bracket-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'bracket-toast';
    toast.className = 'bracket-toast';
    toast.textContent = message;
    var bracketScreen = document.getElementById('screen-bracket');
    var firstContent = document.getElementById('bracket-games');
    if (bracketScreen) {
      bracketScreen.insertBefore(toast, firstContent || bracketScreen.firstChild);
      setTimeout(function () {
        if (toast.parentNode) toast.remove();
      }, 4500);
    }
  }

  function showScreen(id) {
    function doShow() {
      document.querySelectorAll('.screen').forEach(function (el) {
        el.classList.remove('active');
      });
      const el = document.getElementById(id);
      if (el) el.classList.add('active');

      if (id === 'screen-calendar') renderCalendar();
      if (id === 'screen-day' && state.selectedDate) renderDayView();
      if (id === 'screen-bracket' && state.selectedDate) renderBracket();
      if (id === 'screen-stats') {
        renderStats();
      }
      if (id === 'screen-member') {
        showMemberPassword();
      }

      const nav = document.getElementById('bottom-nav');
      if (nav) {
        nav.style.display = (id === 'screen-calendar' || id === 'screen-stats' || id === 'screen-member') ? 'flex' : 'none';
      }
      document.querySelectorAll('.nav-item').forEach(function (n) {
        var screen = n.getAttribute('data-screen');
        var isActive = false;
        if (id === 'screen-calendar' && screen === 'calendar') isActive = true;
        else if (id === 'screen-stats' && screen === 'stats') isActive = true;
        else if (id === 'screen-member' && screen === 'member') isActive = true;
        n.classList.toggle('active', isActive);
      });
    }

    if (useServer() && id !== 'screen-load') {
      refetchFromServer(function () {
        doShow();
      });
    } else {
      doShow();
    }
  }

  function renderCalendar() {
    const now = new Date();
    if (!state.currentMonth) {
      state.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const y = state.currentMonth.getFullYear();
    const m = state.currentMonth.getMonth();
    document.getElementById('current-month-label').textContent = y + '년 ' + (m + 1) + '월';

    const dateKey = state.selectedDate ? getDateKey(state.selectedDate) : null;
    const monthKey = y + '-' + (m + 1).toString().padStart(2, '0');
    const monthStart = new Date(y, m, 1);
    const monthEnd = new Date(y, m + 1, 0);
    const startDay = monthStart.getDay();
    const daysInMonth = monthEnd.getDate();

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    weekdays.forEach(function (w, i) {
      const cell = document.createElement('div');
      cell.className = 'weekday';
      if (i === 0) cell.classList.add('sunday');
      cell.textContent = w;
      grid.appendChild(cell);
    });

    const prevMonthDays = startDay;
    const prevMonth = new Date(y, m, 0);
    const prevDays = prevMonth.getDate();
    for (let i = 0; i < prevMonthDays; i++) {
      const cell = document.createElement('div');
      cell.className = 'day-cell other-month';
      if (i % 7 === 0) cell.classList.add('sunday');
      cell.textContent = prevDays - prevMonthDays + 1 + i;
      grid.appendChild(cell);
    }

    const todayStr = now.getFullYear() + '-' + (now.getMonth() + 1).toString().padStart(2, '0') + '-' + (now.getDate().toString().padStart(2, '0'));
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      const dayOfWeek = (startDay + d - 1) % 7;
      if (dayOfWeek === 0) cell.classList.add('sunday');
      const dayStr = y + '-' + (m + 1).toString().padStart(2, '0') + '-' + (d.toString().padStart(2, '0'));
      if (dayStr === todayStr) cell.classList.add('today');
      if (state.events[dayStr]) cell.classList.add('has-event');
      const span = document.createElement('span');
      span.className = 'day-num';
      span.textContent = d;
      cell.appendChild(span);
      cell.addEventListener('click', function () {
        state.selectedDate = new Date(y, m, d);
        ensureEvent(dayStr);
        const ev = state.events[dayStr];
        const hasResults = ev && ev.appliedMatchResults && ev.appliedMatchResults.length > 0;
        if (isPastDate(dayStr) || hasResults) {
          document.getElementById('bracket-title').textContent = dayStr + ' 대진표 (보기)';
          showScreen('screen-bracket');
          renderBracket();
          return;
        }
        document.getElementById('day-title').textContent = dayStr + ' 경기';
        fillStartTimeSelect('day-start-time', (ev && ev.startTime) ? ev.startTime : DEFAULT_START);
        showScreen('screen-day');
        renderDayView();
      });
      grid.appendChild(cell);
    }

    const totalCells = prevMonthDays + daysInMonth;
    const remaining = totalCells % 7 ? 7 - (totalCells % 7) : 0;
    for (let i = 0; i < remaining; i++) {
      const cell = document.createElement('div');
      cell.className = 'day-cell other-month';
      if ((totalCells + i) % 7 === 0) cell.classList.add('sunday');
      cell.textContent = i + 1;
      grid.appendChild(cell);
    }

    if (state.currentMonth) {
      const ym = state.currentMonth;
      const firstDayKey = ym.getFullYear() + '-' + (ym.getMonth() + 1).toString().padStart(2, '0') + '-01';
      ensureEvent(firstDayKey);
      fillStartTimeSelect('month-start-time', state.events[firstDayKey].startTime || DEFAULT_START);
    }
  }

  function fillStartTimeSelect(selectId, selectedValue) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    var opts = getStartTimeOptions();
    sel.innerHTML = '';
    opts.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === (selectedValue || DEFAULT_START)) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderDayView() {
    updateTotalScores();
    const dateKey = getDateKey(state.selectedDate);
    const ev = ensureEvent(dateKey);
    var readOnly = isPastDate(dateKey);

    var dayToolbar = document.querySelector('#screen-day .day-toolbar');
    if (dayToolbar) {
      var roNote = dayToolbar.querySelector('.readonly-note');
      if (readOnly) {
        if (!roNote) {
          roNote = document.createElement('p');
          roNote.className = 'hint readonly-note';
          roNote.textContent = '지난 날짜입니다. 수정할 수 없습니다.';
          dayToolbar.insertBefore(roNote, dayToolbar.firstChild);
        }
      } else if (roNote) roNote.remove();
    }

    fillStartTimeSelect('day-start-time', ev.startTime || DEFAULT_START);
    var startSel = document.getElementById('day-start-time');
    if (startSel) {
      startSel.disabled = readOnly;
      if (!readOnly) {
        startSel.onchange = function () {
          var newStart = startSel.value;
          ev.startTime = newStart;
          ev.participants.forEach(function (p) {
            p.checkIn = newStart;
            p.checkOut = getCheckOutDefault(newStart);
          });
          saveState();
          renderDayView();
        };
      }
    }

    var ul = document.getElementById('participant-list');
    ul.innerHTML = '';
    var userById = {};
    state.users.forEach(function (u) { userById[u.id] = u; });

    // 참여자 리스트를 정렬: 점수 순 > 이름 가나다 순
    var participantsList = ev.participants.map(function (p) {
      var u = userById[p.userId];
      if (!u) return null;
      return {
        participant: p,
        user: u,
        score: state.scores[u.id] || 0,
        grade: u.grade,
        name: u.name
      };
    }).filter(function (item) { return item !== null; });
    
    participantsList.sort(function (a, b) {
      return sortUsersByGradeScoreName(a, b);
    });

    participantsList.forEach(function (item) {
      var p = item.participant;
      var u = item.user;
      if (!u) return;
      var li = document.createElement('li');
      var nameGrade = document.createElement('div');
      nameGrade.className = 'name-grade';
      nameGrade.textContent = u.name;
      var gradeSpan = document.createElement('span');
      gradeSpan.className = 'grade-tag';
      var userScore = state.scores[u.id] || 0;
      gradeSpan.textContent = userScore + '점';
      nameGrade.appendChild(gradeSpan);

      var checkGroup = document.createElement('div');
      checkGroup.className = 'check-group';

      if (readOnly) {
        var rci = parseInt(p.checkIn) || 1;
        var rco = parseInt(p.checkOut) || TOTAL_GAMES;
        if (rco < rci) rco = TOTAL_GAMES;
        var rcoText = rci < TOTAL_GAMES ? ' · 체크아웃 ' + rco + '게임' : '';
        checkGroup.innerHTML = '<div class="check-row">' + (p.attend ? '참여' : '미참여') + ' · 체크인 ' + rci + '게임' + rcoText + '</div>';
      } else {
        var attendRow = document.createElement('div');
        attendRow.className = 'check-row';
        var attendCb = document.createElement('input');
        attendCb.type = 'checkbox';
        attendCb.checked = !!p.attend;
        attendCb.addEventListener('change', function () {
          p.attend = attendCb.checked;
          saveState();
        });
        attendRow.appendChild(attendCb);
        attendRow.appendChild(document.createTextNode('참여'));
        checkGroup.appendChild(attendRow);

        var checkInRow = document.createElement('div');
        checkInRow.className = 'check-row';
        checkInRow.appendChild(document.createTextNode('체크인 '));
        var checkInSel = document.createElement('select');
        var currentCheckIn = parseInt(p.checkIn) || 1;
        getCheckInOptions().forEach(function (n) {
          var opt = document.createElement('option');
          opt.value = n;
          opt.textContent = n + '게임';
          if (n === currentCheckIn) opt.selected = true;
          checkInSel.appendChild(opt);
        });
        checkInSel.addEventListener('change', function () {
          p.checkIn = parseInt(checkInSel.value);
          var co = parseInt(p.checkOut) || TOTAL_GAMES;
          if (co <= p.checkIn) p.checkOut = Math.min(p.checkIn + 1, TOTAL_GAMES);
          fillCheckOutOptions();
          saveState();
        });
        checkInRow.appendChild(checkInSel);
        checkGroup.appendChild(checkInRow);

        var checkOutRow = document.createElement('div');
        checkOutRow.className = 'check-row';
        checkOutRow.appendChild(document.createTextNode('체크아웃 '));
        var checkOutSel = document.createElement('select');
        function fillCheckOutOptions() {
          var ci = parseInt(p.checkIn) || 1;
          var co = parseInt(p.checkOut) || TOTAL_GAMES;
          var opts = getCheckOutOptions(ci);
          checkOutRow.style.display = opts.length ? '' : 'none';
          checkOutSel.innerHTML = '';
          opts.forEach(function (n) {
            var opt = document.createElement('option');
            opt.value = n;
            opt.textContent = n + '게임';
            if (n === co) opt.selected = true;
            checkOutSel.appendChild(opt);
          });
          if (opts.length && !checkOutSel.value) {
            checkOutSel.value = opts[opts.length - 1];
            p.checkOut = parseInt(checkOutSel.value);
          }
        }
        fillCheckOutOptions();
        checkOutSel.addEventListener('change', function () {
          p.checkOut = parseInt(checkOutSel.value);
          saveState();
        });
        checkOutRow.appendChild(checkOutSel);
        checkGroup.appendChild(checkOutRow);
      }

      li.appendChild(nameGrade);
      li.appendChild(checkGroup);
      ul.appendChild(li);
    });

    var dayActions = document.querySelector('.day-actions');
    var btnGoBracket = document.getElementById('btn-go-bracket');
    if (dayActions && btnGoBracket) {
      if (readOnly) {
        var hasBracket = ev.bracketSnapshot && ev.bracketSnapshot.length > 0;
        btnGoBracket.textContent = '대진표 보기';
        btnGoBracket.disabled = !hasBracket;
        btnGoBracket.onclick = hasBracket ? function () { showScreen('screen-bracket'); renderBracket(); } : function () {};
      } else {
        btnGoBracket.textContent = '대진표 작성';
        btnGoBracket.disabled = false;
        btnGoBracket.onclick = null;
      }
    }
  }

  function buildDuplicateTeamMap(brackets) {
    var seen = {};
    var dup = {};
    (brackets || []).forEach(function (b) {
      (b.matches || []).forEach(function (match, mi) {
        if (match && match.team1 && match.team1.length === 2) {
          var k1 = pairKey(match.team1[0], match.team1[1]);
          if (seen[k1]) {
            dup[b.gameIndex + ':' + mi + ':1'] = true;
          } else {
            seen[k1] = true;
          }
        }
        if (match && match.team2 && match.team2.length === 2) {
          var k2 = pairKey(match.team2[0], match.team2[1]);
          if (seen[k2]) {
            dup[b.gameIndex + ':' + mi + ':2'] = true;
          } else {
            seen[k2] = true;
          }
        }
      });
    });
    return dup;
  }

  function renderBracket() {
    const dateKey = getDateKey(state.selectedDate);
    const ev = state.events[dateKey] || {};
    var isPast = isPastDate(dateKey);
    var readOnly = isPast || (ev.appliedMatchResults && ev.appliedMatchResults.length > 0);

    document.getElementById('bracket-title').textContent = dateKey + ' 대진표' + (readOnly ? ' (보기)' : '');

    const brackets = buildFullBracket(dateKey);
    var duplicateTeamMap = buildDuplicateTeamMap(brackets);
    var totalMatchesInBrackets = (brackets || []).reduce(function (s, b) { return s + (b.matches ? b.matches.length : 0); }, 0);
    var hasGameData = totalMatchesInBrackets > 0 || (ev.appliedMatchResults && ev.appliedMatchResults.length > 0);

    const container = document.getElementById('bracket-games');
    container.innerHTML = '';
    const userById = {};
    state.users.forEach(function (u) { userById[u.id] = u; });

    if (isPast && !hasGameData) {
      var noGameMsg = document.createElement('div');
      noGameMsg.className = 'bracket-empty-msg';
      noGameMsg.style.padding = '24px';
      noGameMsg.style.textAlign = 'center';
      noGameMsg.style.fontSize = '1rem';
      noGameMsg.textContent = '해당일에는 게임이 없었습니다.';
      container.appendChild(noGameMsg);
      var btnReg = document.getElementById('btn-register-results');
      if (btnReg) btnReg.style.display = 'none';
      return;
    }

    var attendCount = (ev.participants || []).filter(function (p) { return p.attend; }).length;
    var availableGame1 = readOnly ? 0 : getParticipantsForGame(dateKey, 1).length;
    if (!readOnly && attendCount < 4) {
      var notice = document.createElement('div');
      notice.className = 'bracket-notice';
      notice.innerHTML = '참여 체크한 인원이 4명 이상이어야 대진이 생성됩니다. (현재 ' + attendCount + '명) 이전 화면에서 참여 여부를 확인해 주세요.';
      container.appendChild(notice);
    } else if (!readOnly && totalMatchesInBrackets === 0 && attendCount >= 4) {
      var notice2 = document.createElement('div');
      notice2.className = 'bracket-notice';
      notice2.innerHTML = '참여는 ' + attendCount + '명인데, 게임 1회차에 참가 가능한 인원이 ' + availableGame1 + '명입니다. 게임 1은 시작시간(예: 07:00)에 체크인한 사람만 참가 가능하고, 체크아웃은 게임 종료(시작+40분) 이후여야 합니다. 당일 시작시간과 각자 체크인·체크아웃을 확인해 주세요.';
      container.appendChild(notice2);
    }

    brackets.forEach(function (b) {
      const card = document.createElement('div');
      card.className = 'game-card';
      card.innerHTML = '<h3>게임 ' + b.gameIndex + ' (시작 ' + b.startTime + ')</h3>';
      const matchesDiv = document.createElement('div');
      matchesDiv.className = 'teams-row';

      if (b.matches.length === 0) {
        var emptyMsg = document.createElement('div');
        emptyMsg.className = 'bracket-empty-msg';
        emptyMsg.style.gridColumn = '1 / -1';
        emptyMsg.textContent = '이 회차에 참가 가능한 인원이 4명 미만입니다. 체크인·체크아웃 시간을 확인해 주세요.';
        matchesDiv.appendChild(emptyMsg);
      }

      b.matches.forEach(function (match, mi) {
        const team1 = match.team1.map(function (id) { return userById[id] ? userById[id].name : id; }).join(' / ');
        const team2 = match.team2.map(function (id) { return userById[id] ? userById[id].name : id; }).join(' / ');
        const winner = match.winner;
        const team1Score = computeTeamScore(match.team1);
        const team2Score = computeTeamScore(match.team2);
        const team1GroupLabel = formatGroupLabel((match.groupInfo && match.groupInfo.team1Group) || '');
        const team2GroupLabel = formatGroupLabel((match.groupInfo && match.groupInfo.team2Group) || '');
        function applyWinner(w) {
          match.winner = w;
          ev.matchResults = ev.matchResults || [];
          var idx = ev.matchResults.findIndex(function (r) {
            return r.gameIndex === b.gameIndex && r.matchIdx === mi;
          });
          if (match.winner) {
            if (idx >= 0) ev.matchResults[idx] = { gameIndex: b.gameIndex, matchIdx: mi, winner: match.winner };
            else ev.matchResults.push({ gameIndex: b.gameIndex, matchIdx: mi, winner: match.winner });
          } else {
            if (idx >= 0) ev.matchResults.splice(idx, 1);
          }
          saveState();
          renderBracket();
        }
        const box1 = document.createElement('div');
        box1.className = 'team-box' + (winner === 1 ? ' winner' : '');
        box1.innerHTML = '<div class="team-label">팀1</div><div class="member">' + team1.replace(/ \/ /g, '<br>') + '</div>';
        if (!readOnly) {
          box1.style.cursor = 'pointer';
          box1.title = '클릭하면 팀1 승리로 선택됩니다';
          box1.addEventListener('click', function () { applyWinner(1); });
        }
        if (duplicateTeamMap[b.gameIndex + ':' + mi + ':1']) {
          var dupTag1 = document.createElement('span');
          dupTag1.className = 'dup-tag';
          dupTag1.textContent = '중복팀 구성';
          dupTag1.title = '같은 날 동일 팀이 이미 구성되었습니다';
          box1.appendChild(dupTag1);
        }
        box1.dataset.teamScore = team1Score;
        if (team1GroupLabel) box1.dataset.teamGroup = team1GroupLabel;
        const box2 = document.createElement('div');
        box2.className = 'team-box' + (winner === 2 ? ' winner' : '');
        box2.innerHTML = '<div class="team-label">팀2</div><div class="member">' + team2.replace(/ \/ /g, '<br>') + '</div>';
        if (!readOnly) {
          box2.style.cursor = 'pointer';
          box2.title = '클릭하면 팀2 승리로 선택됩니다';
          box2.addEventListener('click', function () { applyWinner(2); });
        }
        if (duplicateTeamMap[b.gameIndex + ':' + mi + ':2']) {
          var dupTag2 = document.createElement('span');
          dupTag2.className = 'dup-tag';
          dupTag2.textContent = '중복팀 구성';
          dupTag2.title = '같은 날 동일 팀이 이미 구성되었습니다';
          box2.appendChild(dupTag2);
        }
        box2.dataset.teamScore = team2Score;
        if (team2GroupLabel) box2.dataset.teamGroup = team2GroupLabel;
        matchesDiv.appendChild(box1);
        matchesDiv.appendChild(box2);

        const resultDiv = document.createElement('div');
        resultDiv.className = 'result-input';
        resultDiv.style.gridColumn = '1 / -1';
        if (readOnly) {
          resultDiv.appendChild(document.createTextNode('승자: ' + (winner === 1 ? '팀1' : winner === 2 ? '팀2' : '-')));
        } else {
          const sel = document.createElement('select');
          sel.innerHTML = '<option value="">승자 선택</option><option value="1">팀1 승</option><option value="2">팀2 승</option>';
          if (match.winner) sel.value = String(match.winner);
          sel.addEventListener('change', function () {
            match.winner = sel.value ? parseInt(sel.value, 10) : null;
            ev.matchResults = ev.matchResults || [];
            var idx = ev.matchResults.findIndex(function (r) {
              return r.gameIndex === b.gameIndex && r.matchIdx === mi;
            });
            if (match.winner) {
              if (idx >= 0) ev.matchResults[idx] = { gameIndex: b.gameIndex, matchIdx: mi, winner: match.winner };
              else ev.matchResults.push({ gameIndex: b.gameIndex, matchIdx: mi, winner: match.winner });
            } else {
              if (idx >= 0) ev.matchResults.splice(idx, 1);
            }
            saveState();
            renderBracket();
          });
          resultDiv.appendChild(document.createElement('label')).textContent = '승자: ';
          resultDiv.appendChild(sel);
        }
        matchesDiv.appendChild(resultDiv);
      });
      if (b.waiting && b.waiting.length) {
        const waitDiv = document.createElement('div');
        waitDiv.style.gridColumn = '1 / -1';
        waitDiv.innerHTML = '대기: ' + b.waiting.map(function (id) { return userById[id] ? userById[id].name : id; }).join(', ');
        matchesDiv.appendChild(waitDiv);
      }
      card.appendChild(matchesDiv);
      container.appendChild(card);
    });

    var totalMatches = brackets.reduce(function (sum, b) { return sum + (b.matches ? b.matches.length : 0); }, 0);
    var filledCount = 0;
    brackets.forEach(function (b) {
      (b.matches || []).forEach(function (match) {
        if (match.winner === 1 || match.winner === 2) filledCount++;
      });
    });
    var btnRegister = document.getElementById('btn-register-results');
    if (btnRegister) {
      if (readOnly) {
        btnRegister.style.display = 'none';
      } else {
        btnRegister.style.display = '';
        btnRegister.disabled = totalMatches === 0;
        var registerHint = document.getElementById('register-results-hint');
        if (registerHint) {
          registerHint.textContent = totalMatches === 0 ? '' : '팀을 클릭하거나 아래에서 승자를 선택한 뒤, 결과 등록을 누르면 확인 후 반영됩니다. (현재 ' + filledCount + '/' + totalMatches + ' 경기 선택됨)';
        }
        btnRegister.onclick = function () {
          if (btnRegister.disabled) return;
          var toApply = (ev.matchResults || []).filter(function (r) { return r.winner === 1 || r.winner === 2; });
          var msg = toApply.length === 0
            ? '선택된 경기가 없습니다. 팀을 클릭해 승리를 선택한 뒤 다시 시도해 주세요.'
            : '해당 내용(' + toApply.length + '경기)으로 결과를 등록할까요? 선택된 경기만 반영됩니다.';
          if (toApply.length === 0) {
            alert(msg);
            return;
          }
          if (!confirm(msg)) return;
          var snap = ev.bracketSnapshot || brackets;
          (ev.appliedMatchResults || []).forEach(function (ar) {
            var game = snap.find(function (g) { return g.gameIndex === ar.gameIndex; });
            if (!game || !game.matches || !game.matches[ar.matchIdx]) return;
            var m = game.matches[ar.matchIdx];
            revertResult({ team1: m.team1, team2: m.team2, winner: ar.winner, scoreDelta: ar.scoreDelta });
          });
          var appliedWithDeltas = [];
          toApply.forEach(function (r) {
            var game = snap.find(function (g) { return g.gameIndex === r.gameIndex; });
            if (!game || !game.matches || !game.matches[r.matchIdx]) return;
            var m = game.matches[r.matchIdx];
            var delta = applyResult({ team1: m.team1, team2: m.team2, winner: r.winner });
            appliedWithDeltas.push({ gameIndex: r.gameIndex, matchIdx: r.matchIdx, winner: r.winner, scoreDelta: delta });
          });
          ev.appliedMatchResults = appliedWithDeltas;
          rebuildMatchScoresFromAppliedResults();
          saveState();
          showScreen('screen-stats');
          document.querySelectorAll('.stats-tabs .tab').forEach(function (t) {
            t.classList.toggle('active', t.getAttribute('data-tab') === 'overall');
          });
          document.querySelectorAll('.stats-panel').forEach(function (p) {
            p.classList.toggle('active', p.id === 'stats-overall');
          });
          renderStats();
          renderBracket();
        };
      }
    }
  }

  function revertResult(match) {
    if (!match.winner || (match.winner !== 1 && match.winner !== 2)) return;
    const winners = match.winner === 1 ? match.team1 : match.team2;
    const losers = match.winner === 1 ? match.team2 : match.team1;

    // 저장된 scoreDelta 사용 (없으면 1로 폴백)
    var delta = match.scoreDelta || 1;

    // 점수 되돌리기
    winners.forEach(function (id) {
      state.matchScores[id] = (state.matchScores[id] || 0) - delta;
    });
    losers.forEach(function (id) {
      state.matchScores[id] = (state.matchScores[id] || 0) + delta;
    });
    updateTotalScores();

    // 경기당 승패 되돌리기
    winners.forEach(function (id) {
      if (state.matchWins[id]) {
        state.matchWins[id].wins = Math.max(0, (state.matchWins[id].wins || 0) - 1);
      }
    });
    losers.forEach(function (id) {
      if (state.matchWins[id]) {
        state.matchWins[id].losses = Math.max(0, (state.matchWins[id].losses || 0) - 1);
      }
    });

    // 개인 대 개인 승패 되돌리기 (상대별 승률용)
    winners.forEach(function (w) {
      losers.forEach(function (l) {
        const key = pairKey(w, l);
        const h = state.headToHead[key];
        if (!h) return;
        const [id1, id2] = key.split('::');
        if (id1 === w) {
          h.wins1 = Math.max(0, (h.wins1 || 0) - 1);
        } else if (id2 === w) {
          h.wins2 = Math.max(0, (h.wins2 || 0) - 1);
        }
        state.headToHead[key] = h;
      });
    });
  }

  function applyResult(match) {
    if (!match.winner || (match.winner !== 1 && match.winner !== 2)) return;
    const winners = match.winner === 1 ? match.team1 : match.team2;
    const losers = match.winner === 1 ? match.team2 : match.team1;

    // 각 팀의 현재 점수 합계 계산
    var winnersScoreSum = winners.reduce(function (sum, id) { return sum + (state.scores[id] || 0); }, 0);
    var losersScoreSum = losers.reduce(function (sum, id) { return sum + (state.scores[id] || 0); }, 0);
    var diff = Math.abs(winnersScoreSum - losersScoreSum);

    // 점수 변동량 결정:
    // - 승리팀 점수합 >= 패배팀 점수합 (예상 승리): 각자 1점
    // - 승리팀 점수합 <  패배팀 점수합 (역전 승리): 차이의 30%, 최소 1점 (소수점 절사)
    var delta;
    if (winnersScoreSum >= losersScoreSum) {
      delta = 1;
    } else {
      delta = Math.floor(diff * 0.3);
      if (delta < 1) delta = 1;
    }

    // 점수 업데이트
    winners.forEach(function (id) {
      state.matchScores[id] = (state.matchScores[id] || 0) + delta;
    });
    losers.forEach(function (id) {
      state.matchScores[id] = (state.matchScores[id] || 0) - delta;
    });
    updateTotalScores();

    // 경기당 승패 기록
    winners.forEach(function (id) {
      if (!state.matchWins[id]) {
        state.matchWins[id] = { wins: 0, losses: 0 };
      }
      state.matchWins[id].wins = (state.matchWins[id].wins || 0) + 1;
    });
    losers.forEach(function (id) {
      if (!state.matchWins[id]) {
        state.matchWins[id] = { wins: 0, losses: 0 };
      }
      state.matchWins[id].losses = (state.matchWins[id].losses || 0) + 1;
    });

    // 개인 대 개인 승패 기록 (상대별 승률용)
    winners.forEach(function (w) {
      losers.forEach(function (l) {
        const key = pairKey(w, l);
        if (!state.headToHead[key]) {
          state.headToHead[key] = { wins1: 0, wins2: 0 };
        }
        const h = state.headToHead[key];
        const [id1, id2] = key.split('::');
        if (id1 === w) {
          h.wins1 = (h.wins1 || 0) + 1;
        } else if (id2 === w) {
          h.wins2 = (h.wins2 || 0) + 1;
        }
        state.headToHead[key] = h;
      });
    });

    return delta;
  }

  function rebuildMatchScoresFromAppliedResults() {
    state.matchScores = state.matchScores || {};
    state.users.forEach(function (u) {
      state.matchScores[u.id] = 0;
    });
    Object.keys(state.events || {}).forEach(function (dateKey) {
      var ev = state.events[dateKey];
      if (!ev || !ev.appliedMatchResults || !ev.bracketSnapshot) return;
      var snapshot = ev.bracketSnapshot;
      ev.appliedMatchResults.forEach(function (ar) {
        var game = snapshot.find(function (g) { return g.gameIndex === ar.gameIndex; });
        if (!game || !game.matches || !game.matches[ar.matchIdx]) return;
        var m = game.matches[ar.matchIdx];
        if (!m.team1 || !m.team2) return;
        var winners = ar.winner === 1 ? m.team1 : m.team2;
        var losers = ar.winner === 1 ? m.team2 : m.team1;
        var delta = ar.scoreDelta || 1;
        winners.forEach(function (id) {
          state.matchScores[id] = (state.matchScores[id] || 0) + delta;
        });
        losers.forEach(function (id) {
          state.matchScores[id] = (state.matchScores[id] || 0) - delta;
        });
      });
    });
    updateTotalScores();
  }

  function getWinsLosses(userId) {
    // 경기당 승패 기록 사용 (경기당 1승/1패만 기록)
    if (state.matchWins && state.matchWins[userId]) {
      return {
        wins: state.matchWins[userId].wins || 0,
        losses: state.matchWins[userId].losses || 0
      };
    }
    return { wins: 0, losses: 0 };
  }

  // 정렬 함수: 점수 순 > 이름 가나다 순
  function sortUsersByGradeScoreName(a, b) {
    // 1. 점수 순 (높은 순)
    var scoreA = a.score || 0;
    var scoreB = b.score || 0;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    // 2. 이름 가나다 순
    return (a.name || '').localeCompare(b.name || '', 'ko');
  }

  function renderStats() {
    const rankList = document.getElementById('rank-list');
    if (!rankList) return;
    rankList.innerHTML = '';
    if (!state.users || state.users.length === 0) {
      rankList.innerHTML = '<li style="padding: 20px; text-align: center; color: var(--text-muted);">사용자 데이터가 없습니다.</li>';
      return;
    }
    updateTotalScores();
    const list = state.users.map(function (u) {
      const wl = getWinsLosses(u.id);
      const total = wl.wins + wl.losses;
      const rateStr = total > 0 ? (wl.wins / total * 100).toFixed(1) + '%' : '-';
      const baseScore = state.baseScores[u.id] || 0;
      const matchScore = state.matchScores[u.id] || 0;
      const totalScore = state.scores[u.id] || 0;
      return {
        id: u.id,
        name: u.name,
        grade: u.grade,
        score: totalScore,
        wins: wl.wins,
        losses: wl.losses,
        rateStr: rateStr
      };
    });
    list.sort(sortUsersByGradeScoreName);
    list.forEach(function (item) {
      const totalGames = item.wins + item.losses;
      const gamesStr = totalGames > 0 ? '총 ' + totalGames + '경기 ' : '';
      const li = document.createElement('li');
      li.innerHTML = '<span class="name">' + item.name + ' <small>(' + item.score + '점)</small></span><span class="score">' + gamesStr + item.wins + '승 ' + item.losses + '패 (승률 ' + item.rateStr + ')</span>';
      li.addEventListener('click', function () {
        state.vsUserId = item.id;
        document.querySelector('#stats-vs .vs-select select').value = item.id;
        document.querySelectorAll('.stats-tabs .tab').forEach(function (t) {
          t.classList.toggle('active', t.getAttribute('data-tab') === 'vs');
        });
        document.querySelectorAll('.stats-panel').forEach(function (p) {
          p.classList.toggle('active', p.id === 'stats-vs');
        });
        renderVsList();
      });
      rankList.appendChild(li);
    });

    const vsSelect = document.getElementById('vs-user-select');
    if (!vsSelect) return;
    
    // 첫 번째 사용자가 선택되지 않았으면 자동으로 선택
    if (!state.vsUserId && state.users && state.users.length > 0) {
      state.vsUserId = state.users[0].id;
    }
    
    vsSelect.innerHTML = '';
    state.users.forEach(function (u) {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      if (u.id === state.vsUserId) opt.selected = true;
      vsSelect.appendChild(opt);
    });
    
    // 이벤트 리스너는 한 번만 등록 (init 함수에서)
    // 여기서는 값만 설정하고 renderVsList 호출
    if (state.vsUserId) {
      renderVsList();
    }
  }

  function showMemberPassword() {
    document.getElementById('member-password').style.display = 'block';
    document.getElementById('member-list').style.display = 'none';
    document.getElementById('member-detail').style.display = 'none';
    document.getElementById('member-form').style.display = 'none';
    state.selectedMemberId = null;
    var passwordInput = document.getElementById('member-password-input');
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.focus();
    }
    var errorMsg = document.getElementById('member-password-error');
    if (errorMsg) errorMsg.style.display = 'none';
  }

  function renderMemberList() {
    updateTotalScores();
    const ul = document.getElementById('member-user-list');
    if (!ul) return;
    ul.innerHTML = '';
    if (!state.users || state.users.length === 0) {
      ul.innerHTML = '<li style="padding: 20px; text-align: center; color: var(--text-muted);">사용자 데이터가 없습니다.</li>';
      return;
    }
    // 사용자 리스트를 정렬: 점수 순 > 이름 가나다 순
    const sortedUsers = state.users.map(function (u) {
      return {
        id: u.id,
        name: u.name,
        grade: u.grade,
        score: state.scores[u.id] || 0
      };
    });
    sortedUsers.sort(sortUsersByGradeScoreName);
    
    sortedUsers.forEach(function (u) {
      const li = document.createElement('li');
      li.style.cursor = 'pointer';
      li.style.padding = '12px 16px';
      li.style.borderBottom = '1px solid var(--border)';
      if (state.selectedMemberId === u.id) {
        li.style.backgroundColor = 'var(--primary-light)';
        li.style.borderLeft = '3px solid var(--primary)';
      }
      li.innerHTML = '<span class="name">' + u.name + ' (' + u.score + '점)</span>';
      li.addEventListener('click', function () {
        // 선택 상태 토글
        if (state.selectedMemberId === u.id) {
          state.selectedMemberId = null;
        } else {
          state.selectedMemberId = u.id;
        }
        renderMemberList();
      });
      li.addEventListener('dblclick', function () {
        // 더블클릭 시 상세 정보 표시
        showMemberDetail(u.id);
      });
      ul.appendChild(li);
    });
  }

  function showMemberForm(mode, userId) {
    // mode: 'add' 또는 'edit'
    var formTitle = document.getElementById('member-form-title');
    var nameInput = document.getElementById('member-form-name');
    var scoreInput = document.getElementById('member-form-score');

    if (mode === 'add') {
      if (formTitle) formTitle.textContent = '회원 추가';
      if (nameInput) nameInput.value = '';
      if (scoreInput) scoreInput.value = '0';
    } else if (mode === 'edit' && userId) {
      var user = state.users.find(function(u) { return u.id === userId; });
      if (user) {
        if (formTitle) formTitle.textContent = '회원 수정';
        if (nameInput) nameInput.value = user.name;
        if (scoreInput) scoreInput.value = state.baseScores[user.id] || 0;
      }
    }
    
    document.getElementById('member-password').style.display = 'none';
    document.getElementById('member-list').style.display = 'none';
    document.getElementById('member-detail').style.display = 'none';
    document.getElementById('member-form').style.display = 'block';
    
    if (nameInput) nameInput.focus();
  }

  function hideMemberForm() {
    document.getElementById('member-password').style.display = 'none';
    document.getElementById('member-list').style.display = 'block';
    document.getElementById('member-detail').style.display = 'none';
    document.getElementById('member-form').style.display = 'none';
    state.selectedMemberId = null;
  }

  function saveMember(mode, userId) {
    var nameInput = document.getElementById('member-form-name');
    var scoreInput = document.getElementById('member-form-score');

    if (!nameInput || !scoreInput) return;

    var name = nameInput.value.trim();
    var score = parseFloat(scoreInput.value) || 0;

    if (!name) {
      alert('이름을 입력해주세요.');
      return;
    }

    if (mode === 'add') {
      // 새 회원 추가
      var newId = 'u' + Date.now();
      var newUser = {
        id: newId,
        name: name
      };
      state.users.push(newUser);
      state.baseScores[newId] = score;
      state.matchScores[newId] = 0;
    } else if (mode === 'edit' && userId) {
      // 기존 회원 수정
      var user = state.users.find(function(u) { return u.id === userId; });
      if (user) {
        user.name = name;
        state.baseScores[userId] = score;
        if (state.matchScores[userId] === undefined) {
          state.matchScores[userId] = 0;
        }
      }
    }
    
    updateTotalScores();
    saveState();
    hideMemberForm();
    renderMemberList();
  }

  function deleteMember(userId) {
    if (!userId) {
      alert('삭제할 회원을 선택해주세요.');
      return;
    }
    
    var user = state.users.find(function(u) { return u.id === userId; });
    if (!user) return;
    
    if (!confirm('정말로 ' + user.name + ' 회원을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      return;
    }
    
    // 사용자 삭제
    state.users = state.users.filter(function(u) { return u.id !== userId; });
    
    // 관련 데이터 삭제
    delete state.baseScores[userId];
    delete state.matchScores[userId];
    delete state.scores[userId];
    delete state.matchWins[userId];
    
    // headToHead 데이터에서도 삭제
    Object.keys(state.headToHead).forEach(function (key) {
      var [id1, id2] = key.split('::');
      if (id1 === userId || id2 === userId) {
        delete state.headToHead[key];
      }
    });
    
    // 이벤트에서도 참여자 제거
    Object.keys(state.events).forEach(function(dateKey) {
      var ev = state.events[dateKey];
      if (ev.participants) {
        ev.participants = ev.participants.filter(function(p) { return p.userId !== userId; });
      }
    });
    
    updateTotalScores();
    saveState();
    state.selectedMemberId = null;
    renderMemberList();
  }

  function showMemberDetail(userId) {
    updateTotalScores();
    const user = state.users.find(function (u) { return u.id === userId; });
    if (!user) return;
    
    const wl = getWinsLosses(userId);
    const total = wl.wins + wl.losses;
    const rateStr = total > 0 ? (wl.wins / total * 100).toFixed(1) + '%' : '-';
    const baseScore = state.baseScores[user.id] || 0;
    const matchScore = state.matchScores[user.id] || 0;
    const totalScore = state.scores[user.id] || 0;
    
    document.getElementById('member-detail-name').textContent = user.name;
    document.getElementById('member-detail-base-score').textContent = baseScore;
    document.getElementById('member-detail-match-score').textContent = matchScore >= 0 ? '+' + matchScore : matchScore;
    document.getElementById('member-detail-total-score').textContent = totalScore;
    document.getElementById('member-detail-wins').textContent = wl.wins;
    document.getElementById('member-detail-losses').textContent = wl.losses;
    document.getElementById('member-detail-rate').textContent = rateStr;
    
    document.getElementById('member-password').style.display = 'none';
    document.getElementById('member-list').style.display = 'none';
    document.getElementById('member-detail').style.display = 'block';
    document.getElementById('member-form').style.display = 'none';
  }

  function renderVsList() {
    const ul = document.getElementById('vs-list');
    ul.innerHTML = '';
    if (!state.vsUserId) return;
    updateTotalScores();
    const userById = {};
    state.users.forEach(function (u) { userById[u.id] = u; });
    const me = userById[state.vsUserId];
    if (!me) return;

    console.log('renderVsList - 기준 사용자:', state.vsUserId, me.name);
    console.log('renderVsList - headToHead 전체 데이터:', JSON.stringify(state.headToHead));

    const others = state.users.filter(function (u) { return u.id !== state.vsUserId; });
    const vsData = others.map(function (u) {
      const key = pairKey(state.vsUserId, u.id);
      const h = state.headToHead[key] || { wins1: 0, wins2: 0 };
      const [id1, id2] = key.split('::');
      // id1이 기준 사용자면 wins1이 기준 사용자의 승, wins2가 상대의 승
      // id2가 기준 사용자면 wins2가 기준 사용자의 승, wins1이 상대의 승
      const myWins = id1 === state.vsUserId ? (h.wins1 || 0) : (h.wins2 || 0);
      const otherWins = id1 === state.vsUserId ? (h.wins2 || 0) : (h.wins1 || 0);
      const total = myWins + otherWins;
      const rate = total > 0 ? ((myWins / total) * 100).toFixed(1) : '-';
      
      console.log('renderVsList - 상대:', u.name, u.id, 'key:', key, 'id1:', id1, 'id2:', id2, 'wins1:', h.wins1, 'wins2:', h.wins2, 'myWins:', myWins, 'otherWins:', otherWins);
      
      return {
        user: u,
        myWins: myWins,
        otherWins: otherWins,
        total: total,
        rate: rate,
        grade: u.grade,
        score: state.scores[u.id] || 0,
        name: u.name
      };
    });
    // 상대별 승률 리스트 정렬: 점수 순 > 이름 가나다 순
    vsData.sort(function (a, b) {
      return sortUsersByGradeScoreName(a, b);
    });

    vsData.forEach(function (v) {
      const li = document.createElement('li');
      const matchStr = v.total > 0 ? '총 ' + v.total + '경기 · ' : '';
      const userScore = state.scores[v.user.id] || 0;
      li.innerHTML = '<span class="name">' + v.user.name + ' (' + userScore + '점)</span><span class="rate">' + matchStr + v.myWins + '승 ' + v.otherWins + '패 (승률 ' + v.rate + '%)</span>';
      ul.appendChild(li);
    });
  }

  function init() {
    var statusEl = document.getElementById('load-status');
    var messageEl = document.getElementById('load-message');

    localSnapshot = readLocalSnapshotFromStorage();

    function runInit(loadedFromServer) {
      console.log('runInit 시작, 사용자 수:', state.users ? state.users.length : 0);
      
      var dataSourceEl = document.getElementById('data-source-msg');
      var refetchBtn = document.getElementById('btn-refetch-server');
      if (dataSourceEl) {
        dataSourceEl.style.display = 'block';
        dataSourceEl.textContent = state.dataSource === 'server'
          ? '데이터: 서버(DB)'
          : '데이터: 이 기기만';
      }
      if (refetchBtn) {
        refetchBtn.style.display = useServer() ? '' : 'none';
      }
      var uploadBtn = document.getElementById('btn-upload-local');
      if (uploadBtn) {
        var showUpload = useServer() && localSnapshot && !isSnapshotEmpty(localSnapshot);
        uploadBtn.style.display = showUpload ? '' : 'none';
      }
      
      if (!state.baseScores) state.baseScores = {};
      if (!state.matchScores) state.matchScores = {};
      updateTotalScores();
      
      if (state.users && state.users.length > 0) {
        // baseScores가 비어있거나 모든 점수가 0인 경우 user.txt에서 다시 읽기 시도
        var hasValidScores = false;
        if (state.baseScores && Object.keys(state.baseScores).length > 0) {
          for (var id in state.baseScores) {
            if (state.baseScores[id] && state.baseScores[id] > 0) {
              hasValidScores = true;
              break;
            }
          }
        }
        
        if (!hasValidScores) {
          console.log('점수 데이터가 없거나 모두 0점입니다. user.txt에서 다시 읽기 시도');
          if (messageEl) messageEl.textContent = 'user.txt에서 점수 정보를 불러오는 중...';
          loadUserTxtFromServer(function (err) {
            if (!err && state.users && state.users.length > 0) {
              updateTotalScores();
              if (messageEl) messageEl.textContent = 'user.txt에서 사용자 정보를 불러왔습니다.';
              if (statusEl) {
                statusEl.textContent = state.users.length + '명 로드됨';
                statusEl.classList.remove('error');
              }
              var fileInputContainer = document.getElementById('file-input-container');
              if (fileInputContainer) {
                fileInputContainer.style.display = 'none';
              }
              setTimeout(function () {
                var loadScreen = document.getElementById('screen-load');
                var calendarScreen = document.getElementById('screen-calendar');
                if (loadScreen) loadScreen.classList.remove('active');
                if (calendarScreen) {
                  calendarScreen.classList.add('active');
                  state.currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                  renderCalendar();
                }
              }, 50);
            } else {
              // user.txt 읽기 실패하면 파일 입력 표시
              console.log('user.txt 읽기 실패, 파일 입력 표시');
              var fileInputContainer = document.getElementById('file-input-container');
              if (fileInputContainer) {
                fileInputContainer.style.display = 'block';
              }
              if (messageEl) messageEl.textContent = '서버에서 파일을 불러올 수 없습니다. 아래 버튼을 클릭하여 파일을 직접 선택해주세요.';
              if (statusEl) {
                statusEl.textContent = (err && err.message) ? err.message : '파일을 선택해주세요.';
                statusEl.classList.add('error');
              }
            }
          });
          return;
        }
        
        console.log('저장된 사용자 데이터 사용');
        if (messageEl) messageEl.textContent = '저장된 사용자 데이터를 불러왔습니다.';
        if (statusEl) {
          statusEl.textContent = state.users.length + '명';
          statusEl.classList.remove('error');
        }
        var updateBtn = document.getElementById('btn-update-users');
        if (updateBtn) {
          updateBtn.style.display = '';
        }
        setTimeout(function () {
          var loadScreen = document.getElementById('screen-load');
          var calendarScreen = document.getElementById('screen-calendar');
          if (loadScreen) loadScreen.classList.remove('active');
          if (calendarScreen) {
            calendarScreen.classList.add('active');
            state.currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            renderCalendar();
          }
        }, 50);
        return;
      }

      console.log('user.txt 읽기 시작');
      if (messageEl) messageEl.textContent = 'user.txt를 불러오는 중...';
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.remove('error');
      }
      
      function onUserLoadDone(err) {
        console.log('onUserLoadDone 호출, 에러:', err, '사용자 수:', state.users ? state.users.length : 0);
        if (!err && state.users && state.users.length > 0) {
          updateTotalScores();
          if (messageEl) messageEl.textContent = 'user.txt를 불러왔습니다.';
          if (statusEl) {
            statusEl.textContent = state.users.length + '명 로드됨';
            statusEl.classList.remove('error');
          }
          setTimeout(function () {
            var loadScreen = document.getElementById('screen-load');
            var calendarScreen = document.getElementById('screen-calendar');
            if (loadScreen) loadScreen.classList.remove('active');
            if (calendarScreen) {
              calendarScreen.classList.add('active');
              state.currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
              renderCalendar();
            }
          }, 50);
          return;
        }
        // 서버에서 실패하면 파일 입력 표시
        var fileInputContainer = document.getElementById('file-input-container');
        if (fileInputContainer) {
          fileInputContainer.style.display = 'block';
        }
        if (messageEl) {
          messageEl.textContent = '서버에서 파일을 불러올 수 없습니다. 아래 버튼을 클릭하여 파일을 직접 선택해주세요.';
        }
        if (statusEl) {
          var errorMsg = '파일을 선택해주세요.';
          if (err && err.message) {
            errorMsg = err.message;
            // "Failed to fetch" 같은 일반적인 오류 메시지를 더 친화적으로 변경
            if (err.message.includes('Failed to fetch') || err.message.includes('fetch') || err.message.includes('서버에서')) {
              errorMsg = '서버가 실행되지 않았습니다. 아래 버튼을 클릭하여 파일을 직접 선택해주세요.';
            }
          }
          statusEl.textContent = errorMsg;
          statusEl.classList.add('error');
        }
      }

      loadUserTxtFromServer(onUserLoadDone);
    }

    console.log('init 시작');
    loadState(function (loadedFromServer) {
      console.log('loadState 콜백 호출됨');
      runInit(loadedFromServer);
    });

    var updateBtn = document.getElementById('btn-update-users');
    if (updateBtn) {
      updateBtn.addEventListener('click', function () {
        if (messageEl) messageEl.textContent = 'user.txt를 불러와 업데이트하는 중...';
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.classList.remove('error');
        }
        // 업데이트 전에 baseScores를 완전히 초기화하여 깨끗한 상태에서 시작
        state.baseScores = {};
        loadUserTxtFromServer(function (err) {
          if (!err && state.users && state.users.length > 0) {
            updateTotalScores();
            // 업데이트 후 화면 새로고침을 위해 renderStats 호출
            if (document.getElementById('screen-stats') && document.getElementById('screen-stats').classList.contains('active')) {
              renderStats();
            }
            if (messageEl) messageEl.textContent = 'user.txt에서 사용자 정보를 업데이트했습니다.';
            if (statusEl) {
              statusEl.textContent = state.users.length + '명 업데이트됨';
              statusEl.classList.remove('error');
            }
            setTimeout(function () {
              if (messageEl) messageEl.textContent = '저장된 사용자 데이터를 불러왔습니다.';
            }, 2000);
          } else {
            if (messageEl) messageEl.textContent = 'user.txt를 불러올 수 없습니다.';
            if (statusEl) {
              statusEl.textContent = (err && err.message) ? err.message : '프로젝트 폴더에 user.txt 파일을 넣어 주세요.';
              statusEl.classList.add('error');
            }
          }
        });
      });
      
      if (state.users && state.users.length > 0) {
        updateBtn.style.display = '';
      }
    }
    
    var refetchServerBtn = document.getElementById('btn-refetch-server');
    if (refetchServerBtn) {
      refetchServerBtn.addEventListener('click', function () {
        if (messageEl) messageEl.textContent = '서버(DB)에서 다시 불러오는 중...';
        refetchFromServer(function (ok) {
          if (messageEl) messageEl.textContent = ok ? '서버(DB)에서 최신 데이터를 불러왔습니다.' : '서버(DB) 데이터를 불러올 수 없습니다.';
          var dsEl = document.getElementById('data-source-msg');
          if (dsEl) {
            dsEl.textContent = state.dataSource === 'server'
              ? '데이터: 서버(DB)'
              : '데이터: 이 기기만';
          }
          if (ok) {
            state.currentMonth = state.currentMonth || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            renderCalendar();
          }
        });
      });
    }
    var uploadLocalBtn = document.getElementById('btn-upload-local');
    if (uploadLocalBtn) {
      uploadLocalBtn.addEventListener('click', function () {
        if (!localSnapshot || isSnapshotEmpty(localSnapshot)) {
          alert('업로드할 로컬 데이터가 없습니다.');
          return;
        }
        if (messageEl) messageEl.textContent = '서버 데이터 비교 중...';
        fetchServerSnapshot(function (err, serverSnap) {
          if (messageEl) messageEl.textContent = '';
          if (err) {
            alert('서버 데이터를 불러올 수 없습니다. 서버 상태를 확인해주세요.');
            return;
          }
          var localSum = summarizeSnapshot(localSnapshot);
          var serverSum = summarizeSnapshot(serverSnap);
          var localLine = '로컬: 사용자 ' + localSum.users + '명, 일정 ' + localSum.events + '개, 결과등록 ' + localSum.appliedResults + '건';
          var serverLine = '서버: 사용자 ' + serverSum.users + '명, 일정 ' + serverSum.events + '개, 결과등록 ' + serverSum.appliedResults + '건';
          if (localSum.latestDate) localLine += ', 최근일 ' + localSum.latestDate;
          if (serverSum.latestDate) serverLine += ', 최근일 ' + serverSum.latestDate;
          var msg = '서버 데이터와 로컬 데이터를 비교합니다.\n\n' +
            localLine + '\n' +
            serverLine + '\n\n' +
            '로컬 데이터를 서버(DB)에 덮어씁니다. 계속할까요?';
          var ok = confirm(msg);
          if (!ok) return;
          uploadSnapshotToServer(localSnapshot, true);
        });
      });
    }
    var downloadStateBtn = document.getElementById('btn-download-state');
    if (downloadStateBtn) {
      downloadStateBtn.addEventListener('click', function () {
        downloadStateFile();
        if (messageEl) messageEl.textContent = 'state.json 파일을 다운로드했습니다. 백업용으로 보관할 수 있습니다.';
      });
    }
    
    // 파일 선택 버튼 이벤트 리스너
    var fileInput = document.getElementById('user-file-input');
    var selectFileBtn = document.getElementById('btn-select-file');
    if (fileInput && selectFileBtn) {
      selectFileBtn.addEventListener('click', function() {
        fileInput.click();
      });
      fileInput.addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        var messageEl = document.getElementById('load-message');
        var statusEl = document.getElementById('load-status');
        if (messageEl) messageEl.textContent = '파일을 읽는 중...';
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.classList.remove('error');
        }
        loadUserTxtFromFile(file, function (err) {
          if (!err && state.users && state.users.length > 0) {
            updateTotalScores();
            if (messageEl) messageEl.textContent = 'user.txt를 불러왔습니다.';
            if (statusEl) {
              statusEl.textContent = state.users.length + '명 로드됨';
              statusEl.classList.remove('error');
            }
            var fileInputContainer = document.getElementById('file-input-container');
            if (fileInputContainer) {
              fileInputContainer.style.display = 'none';
            }
            setTimeout(function () {
              var loadScreen = document.getElementById('screen-load');
              var calendarScreen = document.getElementById('screen-calendar');
              if (loadScreen) loadScreen.classList.remove('active');
              if (calendarScreen) {
                calendarScreen.classList.add('active');
                state.currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                renderCalendar();
              }
            }, 50);
          } else {
            if (messageEl) messageEl.textContent = '파일을 읽을 수 없습니다.';
            if (statusEl) {
              statusEl.textContent = (err && err.message) ? err.message : '파일 형식을 확인해주세요.';
              statusEl.classList.add('error');
            }
          }
        });
      });
    }
    
    // 회원관리 화면의 데이터 삭제 버튼들
    var clearMatchesBtn = document.getElementById('btn-clear-matches');
    if (clearMatchesBtn) {
      clearMatchesBtn.addEventListener('click', function() {
        if (confirm('정말로 모든 경기 데이터(이벤트, 승패 기록 등)를 삭제하시겠습니까? 사용자 정보와 점수는 유지됩니다. 이 작업은 되돌릴 수 없습니다.')) {
          clearAllMatchData();
          alert('모든 경기 데이터가 삭제되었습니다. 페이지를 새로고침합니다.');
          location.reload();
        }
      });
    }
    
    var clearBtn = document.getElementById('btn-clear-storage');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        if (confirm('정말로 저장된 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.\n\n주의: 데이터 삭제 후 user.txt를 다시 읽으려면 서버를 실행해야 합니다. (npm start)')) {
          localStorage.removeItem('tennis_users');
          localStorage.removeItem('tennis_events');
          localStorage.removeItem('tennis_scores');
          localStorage.removeItem('tennis_baseScores');
          localStorage.removeItem('tennis_matchScores');
          localStorage.removeItem('tennis_headToHead');
          alert('데이터가 삭제되었습니다. 페이지를 새로고침합니다.\n\n서버를 실행하지 않은 경우 user.txt를 읽을 수 없을 수 있습니다.');
          location.reload();
        }
      });
    }

    document.getElementById('btn-prev-month').addEventListener('click', function () {
      state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
      renderCalendar();
    });
    document.getElementById('btn-next-month').addEventListener('click', function () {
      state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
      renderCalendar();
    });


    var btnBackCalendar = document.getElementById('btn-back-calendar');
    if (btnBackCalendar) {
      btnBackCalendar.addEventListener('click', function () {
        showScreen('screen-load');
      });
    }
    var btnBackDay = document.getElementById('btn-back-day');
    if (btnBackDay) {
      btnBackDay.addEventListener('click', function () {
        showScreen('screen-calendar');
      });
    }
    var btnBackBracket = document.getElementById('btn-back-bracket');
    if (btnBackBracket) {
      btnBackBracket.addEventListener('click', function () {
      var dateKey = state.selectedDate && getDateKey(state.selectedDate);
      if (!dateKey) {
        showScreen('screen-calendar');
        return;
      }
      const ev = state.events[dateKey];
      const hasResults = ev && ev.appliedMatchResults && ev.appliedMatchResults.length > 0;
      if (hasResults) {
        showScreen('screen-stats');
        document.querySelectorAll('.stats-tabs .tab').forEach(function (t) {
          t.classList.toggle('active', t.getAttribute('data-tab') === 'overall');
        });
        document.querySelectorAll('.stats-panel').forEach(function (p) {
          p.classList.toggle('active', p.id === 'stats-overall');
        });
        renderStats();
      } else if (isPastDate(dateKey)) {
        showScreen('screen-calendar');
      } else {
        showScreen('screen-day');
      }
      });
    }
    var btnBackStats = document.getElementById('btn-back-stats');
    if (btnBackStats) {
      btnBackStats.addEventListener('click', function () {
        showScreen('screen-calendar');
      });
    }
    
    var btnBackMember = document.getElementById('btn-back-member');
    if (btnBackMember) {
      btnBackMember.addEventListener('click', function () {
        showScreen('screen-calendar');
      });
    }
    
    var btnMemberLogin = document.getElementById('btn-member-login');
    if (btnMemberLogin) {
      btnMemberLogin.addEventListener('click', function () {
        var passwordInput = document.getElementById('member-password-input');
        var errorMsg = document.getElementById('member-password-error');
        if (!passwordInput) return;
        var inputPassword = passwordInput.value.trim();
        if (inputPassword === state.memberPassword) {
          document.getElementById('member-password').style.display = 'none';
          document.getElementById('member-list').style.display = 'block';
          document.getElementById('member-detail').style.display = 'none';
          document.getElementById('member-form').style.display = 'none';
          state.selectedMemberId = null;
          renderMemberList();
        } else {
          if (errorMsg) {
            errorMsg.textContent = '암호가 일치하지 않습니다.';
            errorMsg.style.display = 'block';
          }
          passwordInput.value = '';
          passwordInput.focus();
        }
      });
    }
    
    var passwordInput = document.getElementById('member-password-input');
    if (passwordInput) {
      passwordInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
          var btn = document.getElementById('btn-member-login');
          if (btn) btn.click();
        }
      });
    }
    
    var btnMemberBackList = document.getElementById('btn-member-back-list');
    if (btnMemberBackList) {
      btnMemberBackList.addEventListener('click', function () {
        hideMemberForm();
        renderMemberList();
      });
    }
    
    // 회원 추가 버튼
    var btnMemberAdd = document.getElementById('btn-member-add');
    if (btnMemberAdd) {
      btnMemberAdd.addEventListener('click', function () {
        state.selectedMemberId = null;
        showMemberForm('add', null);
      });
    }
    
    // 회원 수정 버튼
    var btnMemberEdit = document.getElementById('btn-member-edit');
    if (btnMemberEdit) {
      btnMemberEdit.addEventListener('click', function () {
        if (!state.selectedMemberId) {
          alert('수정할 회원을 선택해주세요.');
          return;
        }
        showMemberForm('edit', state.selectedMemberId);
      });
    }
    
    // 회원 삭제 버튼
    var btnMemberDelete = document.getElementById('btn-member-delete');
    if (btnMemberDelete) {
      btnMemberDelete.addEventListener('click', function () {
        deleteMember(state.selectedMemberId);
      });
    }
    
    // 회원 저장 버튼
    var btnMemberSave = document.getElementById('btn-member-save');
    if (btnMemberSave) {
      btnMemberSave.addEventListener('click', function () {
        var formTitle = document.getElementById('member-form-title');
        var mode = formTitle && formTitle.textContent === '회원 추가' ? 'add' : 'edit';
        saveMember(mode, state.selectedMemberId);
      });
    }
    
    // 회원 취소 버튼
    var btnMemberCancel = document.getElementById('btn-member-cancel');
    if (btnMemberCancel) {
      btnMemberCancel.addEventListener('click', function () {
        hideMemberForm();
      });
    }

    document.getElementById('btn-go-bracket').addEventListener('click', function () {
      var dateKey = state.selectedDate && getDateKey(state.selectedDate);
      if (!dateKey) return;
      ensureEvent(dateKey);
      var ev = state.events[dateKey];
      if (isPastDate(dateKey)) {
        showScreen('screen-bracket');
        renderBracket();
        return;
      }
      // 대진표 작성 시 관리자 암호 확인 (암호가 맞을 때만 작성 후 해당 페이지로 이동)
      var inputPassword = prompt('대진표 작성을 위해 관리자 암호를 입력하세요.');
      if (inputPassword === null) return; // 취소
      var adminPassword = state.memberPassword || '1234';
      if (inputPassword !== adminPassword) {
        alert('암호가 일치하지 않습니다. 대진표를 작성할 수 없습니다.');
        return;
      }
      var totalMatchesInSnapshot = (ev.bracketSnapshot || []).reduce(function (s, b) {
        return s + (b.matches ? b.matches.length : 0);
      }, 0);
      var mustRebuild = !ev.bracketSnapshot || ev.bracketSnapshot.length === 0 || totalMatchesInSnapshot === 0 || !participationUnchanged(ev);
      if (mustRebuild) {
        var snap = ev.bracketSnapshot || [];
        (ev.appliedMatchResults || []).forEach(function (ar) {
          var game = snap.find(function (g) { return g.gameIndex === ar.gameIndex; });
          if (!game || !game.matches || !game.matches[ar.matchIdx]) return;
          var m = game.matches[ar.matchIdx];
          revertResult({ team1: m.team1, team2: m.team2, winner: ar.winner, scoreDelta: ar.scoreDelta });
        });
        ev.bracketSnapshot = null;
        ev.bracketParticipationSnapshot = null;
        ev.matchResults = [];
        ev.appliedMatchResults = [];
        buildFullBracket(dateKey, true);
        saveState();
      }
      showScreen('screen-bracket');
      renderBracket();
    });

    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const screen = btn.getAttribute('data-screen');
        if (screen === 'calendar') {
          showScreen('screen-calendar');
        }
        if (screen === 'stats') {
          showScreen('screen-stats');
        }
        if (screen === 'member') {
          showScreen('screen-member');
        }
      });
    });

    // 상대별 승률 셀렉트 박스 이벤트 리스너 (한 번만 등록)
    var vsSelect = document.getElementById('vs-user-select');
    if (vsSelect) {
      vsSelect.addEventListener('change', function () {
        state.vsUserId = vsSelect.value;
        renderVsList();
      });
    }
    
    document.querySelectorAll('.stats-tabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        const t = tab.getAttribute('data-tab');
        document.querySelectorAll('.stats-tabs .tab').forEach(function (x) {
          x.classList.toggle('active', x.getAttribute('data-tab') === t);
        });
        document.getElementById('stats-overall').classList.toggle('active', t === 'overall');
        document.getElementById('stats-vs').classList.toggle('active', t === 'vs');
        if (t === 'vs') {
          // 상대별 승률 탭이 활성화될 때 첫 번째 사용자가 선택되지 않았으면 자동 선택
          if (!state.vsUserId && state.users && state.users.length > 0) {
            state.vsUserId = state.users[0].id;
            var vsSelectEl = document.getElementById('vs-user-select');
            if (vsSelectEl) {
              vsSelectEl.value = state.vsUserId;
            }
          }
          renderVsList();
        }
      });
    });
  }

  init();
})();
