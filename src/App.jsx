import React, { useEffect, useMemo, useState } from 'react';

function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const STORAGE_KEY = 'gostop-chip-tracker-v1';
const DEFAULT_PLAYERS = ['플레이어 1', '플레이어 2', '플레이어 3', '플레이어 4'];
const DEFAULT_CHIPS = 0;
const FIRST_TTADAK_EVENT = { key: 'first-ttadak', label: '첫따닥', amount: 5 };

function createInitialState() {
  return {
    players: DEFAULT_PLAYERS.map((name, index) => ({ id: String(index + 1), name: '' })),
    initialChips: DEFAULT_CHIPS,
    chipValue: 0,
    transfers: [],
    bbeokStages: {},
    winCounts: {},
    receiveCounts: {},
    winDeleteCounts: {},
    tripleWinDeleteCounts: {},
    isStarted: false,
  };
}

function clampBbeokStage(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  if (parsed > 2) return 2;
  return parsed;
}

function getBbeokEvent(stage) {
  const safeStage = clampBbeokStage(stage);

  if (safeStage === 0) {
    return { key: 'first-bbeok', label: '첫뻑', amount: 5, nextStage: 1, stage: safeStage };
  }

  if (safeStage === 1) {
    return { key: 'streak-bbeok', label: '연뻑', amount: 10, nextStage: 2, stage: safeStage };
  }

  return { key: 'triple-bbeok', label: '삼연뻑', amount: 20, nextStage: 2, stage: safeStage };
}

function formatTime(value) {
  return new Date(value).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) {
    return createInitialState().players;
  }

  const normalized = players
    .map((player, index) => {
      const name = typeof player?.name === 'string' ? player.name.trim() : '';
      const id = typeof player?.id === 'string' && player.id ? player.id : `player-${index + 1}`;

      return {
        id,
        name: name || `플레이어 ${index + 1}`,
      };
    })
    .filter((player, index, list) => {
      return list.findIndex((candidate) => candidate.id === player.id) === index;
    })
    .slice(0, 4);

  if (normalized.length < 2) {
    return createInitialState().players;
  }

  return normalized;
}

function normalizeTransfers(transfers, playerIds) {
  if (!Array.isArray(transfers)) {
    return [];
  }

  return transfers
    .map((transfer) => {
      const amount = Number(transfer?.amount);
      const from = typeof transfer?.from === 'string' ? transfer.from : transfer?.fromPlayerId;
      const to = typeof transfer?.to === 'string' ? transfer.to : transfer?.toPlayerId;

      if (
        !playerIds.has(from) ||
        !playerIds.has(to) ||
        from === to ||
        !Number.isInteger(amount) ||
        amount <= 0
      ) {
        return null;
      }

      return {
        id: typeof transfer?.id === 'string' && transfer.id ? transfer.id : generateId(),
        from,
        to,
        amount,
        reason: typeof transfer?.reason === 'string' ? transfer.reason : '',
        createdAt: Number(transfer?.createdAt) || Date.now(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeBbeokStages(bbeokStages, players) {
  if (!bbeokStages || typeof bbeokStages !== 'object') {
    return {};
  }

  const result = {};
  for (const player of players) {
    const stage = clampBbeokStage(bbeokStages[player.id]);
    if (stage > 0) {
      result[player.id] = stage;
    }
  }

  return result;
}

function normalizeCountMap(countMap, players) {
  if (!countMap || typeof countMap !== 'object') {
    return {};
  }

  const result = {};
  for (const player of players) {
    const value = Number(countMap[player.id]);
    if (Number.isInteger(value) && value > 0) {
      result[player.id] = value;
    }
  }

  return result;
}


function loadInitialState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return createInitialState();

    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.players) || !Array.isArray(parsed.transfers)) {
      return createInitialState();
    }

    const players = normalizePlayers(parsed.players);
    const playerIds = new Set(players.map((player) => player.id));
    const transfers = normalizeTransfers(parsed.transfers, playerIds);
    const { winCounts, receiveCounts } = recalculateWinsFromTransfers(players, transfers);

    return {
      players,
      initialChips: Number(parsed.initialChips) >= 0 ? Math.floor(Number(parsed.initialChips)) : DEFAULT_CHIPS,
      chipValue: Number(parsed.chipValue) >= 0 ? Number(parsed.chipValue) : 0,
      transfers,
      bbeokStages: normalizeBbeokStages(parsed.bbeokStages, players),
      winCounts,
      receiveCounts,
      winDeleteCounts: normalizeCountMap(parsed.winDeleteCounts, players),
      tripleWinDeleteCounts: normalizeCountMap(parsed.tripleWinDeleteCounts, players),
      isStarted: Boolean(parsed.isStarted),
    };
  } catch {
    return createInitialState();
  }
}

function calculateSettlements(players, balances, initialChips) {
  const nets = players.map((p) => ({
    id: p.id,
    name: p.name,
    amount: balances[p.id] - initialChips,
  }));

  const debtors = [];
  const creditors = [];
  for (const n of nets) {
    if (n.amount < 0) debtors.push({ ...n, amount: -n.amount });
    else if (n.amount > 0) creditors.push({ ...n });
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amount, creditors[ci].amount);
    if (pay > 0) {
      settlements.push({
        from: debtors[di].name,
        to: creditors[ci].name,
        amount: pay,
      });
    }
    debtors[di].amount -= pay;
    creditors[ci].amount -= pay;
    if (debtors[di].amount === 0) di++;
    if (creditors[ci].amount === 0) ci++;
  }

  return settlements;
}

function recalculateWinsFromTransfers(players, transfers) {
  const threshold = players.length - 1;
  const empty = { winCounts: {}, receiveCounts: {} };
  if (threshold <= 0) return empty;

  const normalReceiveTotals = {};
  const gobakWinTotals = {};
  const tripleBonusEntryTotals = {};

  for (const transfer of transfers) {
    const toPlayerId = transfer.to;
    if (!toPlayerId) continue;

    if (!transfer.reason) {
      normalReceiveTotals[toPlayerId] = (normalReceiveTotals[toPlayerId] ?? 0) + 1;
      continue;
    }

    if (transfer.reason === '고박') {
      gobakWinTotals[toPlayerId] = (gobakWinTotals[toPlayerId] ?? 0) + 1;
      continue;
    }

    if (transfer.reason === '삼연뻑 종료 승리') {
      tripleBonusEntryTotals[toPlayerId] = (tripleBonusEntryTotals[toPlayerId] ?? 0) + 1;
    }
  }

  const winCounts = {};
  const receiveCounts = {};

  for (const player of players) {
    const playerId = player.id;
    const normalTotal = normalReceiveTotals[playerId] ?? 0;
    const progress = normalTotal % threshold;
    const normalWins = Math.floor(normalTotal / threshold);
    const gobakWins = gobakWinTotals[playerId] ?? 0;
    const tripleBonus = tripleBonusEntryTotals[playerId] ?? 0;
    const tripleWins = Math.floor(tripleBonus / threshold);
    const totalWins = normalWins + gobakWins + tripleWins;

    if (progress > 0) {
      receiveCounts[playerId] = progress;
    }

    if (totalWins > 0) {
      winCounts[playerId] = totalWins;
    }
  }

  return { winCounts, receiveCounts };
}

export default function App() {
  const [state, setState] = useState(loadInitialState);
  const [initialChipsInput, setInitialChipsInput] = useState(() => String(loadInitialState().initialChips));
  const [selection, setSelection] = useState({ from: null, to: null });
  const [amountInput, setAmountInput] = useState('');
  const [showSettlement, setShowSettlement] = useState(false);
  const [showWins, setShowWins] = useState(false);
  const [specialConfirm, setSpecialConfirm] = useState(null);
  const [showSpecialPanel, setShowSpecialPanel] = useState(false);
  const [isGobakMode, setIsGobakMode] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage failures and keep the UI usable
    }
  }, [state]);

  useEffect(() => {
    setInitialChipsInput(String(state.initialChips));
  }, [state.initialChips]);

  const balances = useMemo(() => {
    const map = Object.fromEntries(state.players.map((player) => [player.id, state.initialChips]));

    for (const transfer of state.transfers) {
      map[transfer.from] -= transfer.amount;
      map[transfer.to] += transfer.amount;
    }

    return map;
  }, [state]);

  const parsedInitialChipsInput = Math.floor(Number(initialChipsInput));
  const setupInitialChips = Number.isFinite(parsedInitialChipsInput) && parsedInitialChipsInput >= 0
    ? parsedInitialChipsInput
    : state.initialChips;
  const totalChips = state.players.length * (state.isStarted ? state.initialChips : setupInitialChips);

  const ranking = useMemo(() => {
    return [...state.players].sort((a, b) => balances[b.id] - balances[a.id]);
  }, [state.players, balances]);

  const ranks = useMemo(() => {
    return Object.fromEntries(ranking.map((player, index) => [player.id, index + 1]));
  }, [ranking]);

  const settlements = useMemo(() => {
    return calculateSettlements(state.players, balances, state.initialChips);
  }, [state.players, balances, state.initialChips]);

  const historyTransfers = useMemo(() => {
    return [...state.transfers].sort((a, b) => b.createdAt - a.createdAt);
  }, [state.transfers]);

  const winsRanking = useMemo(() => {
    return [...state.players].sort((a, b) => {
      const diff = (state.winCounts[b.id] ?? 0) - (state.winCounts[a.id] ?? 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, 'ko');
    });
  }, [state.players, state.winCounts]);

  function applyWinProgress(prevState, addedTransfers) {
    const threshold = prevState.players.length - 1;
    if (threshold <= 0 || addedTransfers.length === 0) {
      return {
        winCounts: prevState.winCounts,
        receiveCounts: prevState.receiveCounts,
      };
    }

    const nextWins = { ...prevState.winCounts };
    const nextReceives = { ...prevState.receiveCounts };

    for (const transfer of addedTransfers) {
      const toPlayerId = transfer.to;
      const currentReceive = nextReceives[toPlayerId] ?? 0;
      const updatedReceive = currentReceive + 1;
      const gainedWins = Math.floor(updatedReceive / threshold);
      nextReceives[toPlayerId] = updatedReceive % threshold;

      if (gainedWins > 0) {
        nextWins[toPlayerId] = (nextWins[toPlayerId] ?? 0) + gainedWins;
      }
    }

    return {
      winCounts: nextWins,
      receiveCounts: nextReceives,
    };
  }

  function updatePlayerName(id, name) {
    setState((prev) => ({
      ...prev,
      players: prev.players.map((player) =>
        player.id === id ? { ...player, name } : player
      ),
    }));
  }

  function commitInitialChipsInput() {
    const parsed = Math.floor(Number(initialChipsInput));

    if (!Number.isFinite(parsed) || parsed < 0) {
      setInitialChipsInput(String(state.initialChips));
      return state.initialChips;
    }

    setState((prev) => ({
      ...prev,
      initialChips: parsed,
    }));

    return parsed;
  }

  function removePlayer(id) {
    if (state.players.length <= 2) return;

    setState((prev) => {
      const players = prev.players.filter((player) => player.id !== id);
      const transfers = prev.transfers.filter(
        (transfer) => transfer.from !== id && transfer.to !== id
      );
      const { winCounts, receiveCounts } = recalculateWinsFromTransfers(players, transfers);

      return {
        ...prev,
        players,
        transfers,
        bbeokStages: Object.fromEntries(
          Object.entries(prev.bbeokStages).filter(([playerId]) => playerId !== id)
        ),
        winCounts,
        receiveCounts,
        winDeleteCounts: Object.fromEntries(
          Object.entries(prev.winDeleteCounts).filter(([playerId]) => playerId !== id)
        ),
        tripleWinDeleteCounts: Object.fromEntries(
          Object.entries(prev.tripleWinDeleteCounts).filter(([playerId]) => playerId !== id)
        ),
      };
    });

  }

  function handleCardTap(playerId) {
    if (!selection.from) {
      setSelection({ from: playerId, to: null });
      setAmountInput('');
    } else if (selection.from === playerId) {
      setSelection({ from: null, to: null });
      setAmountInput('');
    } else {
      setSelection((prev) => ({ ...prev, to: playerId }));
    }
  }

  function submitTransfer() {
    const amount = Number(amountInput);
    if (!selection.from || !selection.to) return;
    if (!Number.isInteger(amount) || amount <= 0) return;

    setState((prev) => {
      const newTransfer = {
        id: generateId(),
        from: selection.from,
        to: selection.to,
        amount,
        reason: isGobakMode ? '고박' : '',
        createdAt: Date.now(),
      };
      const transfers = [newTransfer, ...prev.transfers];
      const { winCounts, receiveCounts } = recalculateWinsFromTransfers(prev.players, transfers);

      return {
        ...prev,
        transfers,
        // 일반 플레이어 간 점수 이동이 발생하면 뻑 단계는 새로 시작
        bbeokStages: {},
        winCounts,
        receiveCounts,
      };
    });

    setSelection({ from: null, to: null });
    setAmountInput('');
    setIsGobakMode(false);
  }

  function startGame() {
    const nextInitialChips = commitInitialChipsInput();

    setState((prev) => ({
      ...prev,
      players: prev.players.map((player, index) => ({
        ...player,
        name: player.name.trim() || `플레이어 ${index + 1}`,
      })),
      initialChips: nextInitialChips,
      isStarted: true,
    }));
  }

  function returnToSetup() {
    setState((prev) => ({
      ...prev,
      isStarted: false,
    }));
  }

  function deleteTransfer(id) {
    setState((prev) => {
      const target = prev.transfers.find((transfer) => transfer.id === id);
      if (!target) return prev;

      const nextTransfers = prev.transfers.filter((transfer) => transfer.id !== id);
      const { winCounts, receiveCounts } = recalculateWinsFromTransfers(prev.players, nextTransfers);

      return {
        ...prev,
        transfers: nextTransfers,
        winCounts,
        receiveCounts,
        winDeleteCounts: {},
        tripleWinDeleteCounts: {},
      };
    });
  }

  function handleBbeokClick(toPlayerId) {
    const stage = state.bbeokStages[toPlayerId] ?? 0;
    const event = getBbeokEvent(stage);
    setSpecialConfirm({ toPlayerId, event, type: 'bbeok' });
  }

  function handleTtadakClick(toPlayerId) {
    setSpecialConfirm({ toPlayerId, event: FIRST_TTADAK_EVENT, type: 'ttadak' });
  }

  function closeSpecialConfirm() {
    setSpecialConfirm(null);
  }

  function confirmSpecialBonus() {
    if (!specialConfirm) return;

    setState((prev) => {
      const payers = prev.players.filter((player) => player.id !== specialConfirm.toPlayerId);
      if (payers.length === 0) return prev;

      const now = Date.now();
      const specialTransfers = payers.map((payer, index) => ({
        id: generateId(),
        from: payer.id,
        to: specialConfirm.toPlayerId,
        amount: specialConfirm.event.amount,
        reason: specialConfirm.event.label,
        createdAt: now + index,
      }));

      let extraRoundBonusTransfers = [];
      if (specialConfirm.type === 'bbeok' && specialConfirm.event.stage === 2) {
        // 삼연뻑(20점) 처리 시 판 종료 보너스로 인당 5점을 추가 지급
        extraRoundBonusTransfers = payers.map((payer, index) => ({
          id: generateId(),
          from: payer.id,
          to: specialConfirm.toPlayerId,
          amount: 5,
          reason: '삼연뻑 종료 승리',
          createdAt: now + payers.length + index,
        }));
      }

      let nextBbeokStages = prev.bbeokStages;
      if (specialConfirm.type === 'bbeok') {
        if (specialConfirm.event.stage === 2) {
          // 삼연뻑 달성 시 판 종료: 모든 플레이어 뻑 단계를 초기화
          nextBbeokStages = {};
        } else {
          nextBbeokStages = {
            ...prev.bbeokStages,
            [specialConfirm.toPlayerId]: specialConfirm.event.nextStage,
          };
        }
      }

      const addedTransfers = [...extraRoundBonusTransfers, ...specialTransfers];
      const transfers = [...addedTransfers, ...prev.transfers];
      const { winCounts, receiveCounts } = recalculateWinsFromTransfers(prev.players, transfers);

      return {
        ...prev,
        transfers,
        bbeokStages: nextBbeokStages,
        winCounts,
        receiveCounts,
      };
    });

    closeSpecialConfirm();
  }

  function resetGame() {
    const nextState = createInitialState();
    setState(nextState);
    setInitialChipsInput(String(nextState.initialChips));
    setSelection({ from: null, to: null });
    setAmountInput('');
    setShowSettlement(false);
    setShowWins(false);
    setSpecialConfirm(null);
    setShowSpecialPanel(false);
    setIsGobakMode(false);
  }

  function activateGobakMode() {
    setShowSpecialPanel(false);
    setIsGobakMode(true);
    setSelection({ from: null, to: null });
    setAmountInput('');
  }

  return (
    <div className="app">
      {!state.isStarted ? (
        <div className="setup">
          <header className="setup-header card">
            <div>
              <p className="eyebrow">고스톱 칩 트래커</p>
              <h1>게임 설정</h1>
            </div>
            <button className="ghost small" onClick={resetGame}>초기화</button>
          </header>
          <section className="card setup-chips">
            <h2>시작 칩</h2>
            <div className="setup-chips-row">
              <input
                type="number"
                min="0"
                value={initialChipsInput}
                onChange={(e) => setInitialChipsInput(e.target.value)}
                onBlur={commitInitialChipsInput}
              />
              <span className="caption">× {state.players.length}명 = 총 {totalChips}칩</span>
            </div>
          </section>

          <section className="card">
            <h2>플레이어</h2>
            <div className="player-list">
              {state.players.map((player, index) => (
                <div key={player.id} className="player-row">
                  <input
                    value={player.name}
                    placeholder={`플레이어 ${index + 1}`}
                    onChange={(e) => updatePlayerName(player.id, e.target.value)}
                  />
                  <strong>{initialChipsInput || '-'}</strong>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => removePlayer(player.id)}
                    disabled={state.players.length <= 2}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            {state.players.length < 4 && (
              <button
                type="button"
                className="ghost"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => setState((prev) => ({
                  ...prev,
                  players: [...prev.players, { id: generateId(), name: '' }],
                }))}
              >
                + 플레이어 추가
              </button>
            )}
          </section>

          <button type="button" className="start-button" onClick={startGame}>게임 시작</button>
        </div>
      ) : (
        <>
          <div className="game-layout">
          <div className="game-main">
            <section className={`table-view table-view-${state.players.length}`}>
              <div className="table-center">
                {selection.from && selection.to ? (
                  <div className="numpad-display-center">{amountInput || '0'}</div>
                ) : (
                  <p className="transfer-guide">
                    {!selection.from
                      ? isGobakMode ? '보내는 사람을 선택하세요(고박)' : '보내는 사람을 선택하세요'
                      : isGobakMode ? '받는 사람을 선택하세요(고박)' : '받는 사람을 선택하세요'}
                  </p>
                )}
              </div>
              {state.players.map((player, index) => {
                const isFrom = selection.from === player.id;
                const isTo = selection.to === player.id;
                let cardClass = 'scoreboard-card card';
                if (isFrom) cardClass += ' selected-from';
                if (isTo) cardClass += ' selected-to';

                return (
                  <div
                    key={player.id}
                    className={`${cardClass} seat-${index}`}
                    onClick={() => handleCardTap(player.id)}
                  >
                    <span className="scoreboard-rank">{ranks[player.id]}</span>
                    <span className="scoreboard-name">{player.name}</span>
                    <strong className="scoreboard-chips">{balances[player.id]}</strong>
                    <span className="scoreboard-diff">
                      {balances[player.id] - state.initialChips >= 0 ? '+' : ''}
                      {balances[player.id] - state.initialChips}
                    </span>
                    {isFrom && <span className="scoreboard-badge from-badge">보내기</span>}
                    {isTo && <span className="scoreboard-badge to-badge">받기</span>}
                  </div>
                );
              })}
            </section>
          </div>

          <div className="game-sidebar-col">
          <div className="game-actions">
            <button className="ghost small" onClick={returnToSetup}>설정으로</button>
            <button className="ghost small" onClick={resetGame}>초기화</button>
            <button className="small" onClick={() => setShowSettlement(true)}>정산</button>
            <button className="small" onClick={() => setShowWins(true)}>승리 횟수</button>
          </div>
          <aside className="game-sidebar card">
            <h2>이동 내역</h2>
            <div className="history-list">
              {historyTransfers.length === 0 && <p className="caption">아직 기록이 없습니다.</p>}
              {historyTransfers.map((transfer) => {
                const from = state.players.find((player) => player.id === transfer.from)?.name ?? '알 수 없음';
                const to = state.players.find((player) => player.id === transfer.to)?.name ?? '알 수 없음';

                return (
                  <div key={`${transfer.id}-${transfer.createdAt}`} className="history-row">
                    <span className="history-row-main">
                      {transfer.reason && <span className="history-tag">{transfer.reason}</span>}
                      <strong>{transfer.amount}</strong>
                      {from} → {to}
                    </span>
                    <div className="history-actions">
                      <small>{formatTime(transfer.createdAt)}</small>
                      <button className="ghost small" onClick={() => deleteTransfer(transfer.id)}>삭제</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          <button
            type="button"
            className="special-fab"
            onClick={() => setShowSpecialPanel((prev) => !prev)}
            aria-label="특수 점수 열기"
          >
            특수
          </button>

          {showSpecialPanel && (
            <aside className="special-popover card">
              <div className="special-popover-header">
                <h2>특수 점수</h2>
                <button className="ghost small" onClick={() => setShowSpecialPanel(false)}>닫기</button>
              </div>
              <p className="caption">첫뻑은 플레이어별로 첫뻑→연뻑→삼연뻑 순서로 자동 진행됩니다.</p>

              <div className="special-section">
                <div className="special-event-header">
                  <h3>고박</h3>
                  <span className="special-event-amount">승수 +1</span>
                </div>
                <button
                  type="button"
                  className="small"
                  style={{ width: '100%' }}
                  onClick={activateGobakMode}
                >
                  고박 시작
                </button>
              </div>

              <div className="special-section">
                <div className="special-event-header">
                  <h3>첫뻑 진행</h3>
                  <span className="special-event-amount">5 → 10 → 20점</span>
                </div>
                <div className="special-button-grid">
                  {state.players.map((player) => {
                    const stage = state.bbeokStages[player.id] ?? 0;
                    const event = getBbeokEvent(stage);
                    let stageClass = '';
                    if (stage === 1) stageClass = 'stage-blue';
                    if (stage >= 2) stageClass = 'stage-red';

                    return (
                      <button
                        key={`bbeok-${player.id}`}
                        type="button"
                        className={`ghost small special-stage-button ${stageClass}`}
                        onClick={() => handleBbeokClick(player.id)}
                      >
                        {player.name} · {event.label}
                      </button>
                    );
                  })}
                </div>
                <p className="special-hint">파랑: 다음은 연뻑, 빨강: 다음은 삼연뻑</p>
              </div>

              <div className="special-section">
                <div className="special-event-header">
                  <h3>첫따닥</h3>
                  <span className="special-event-amount">인당 5점</span>
                </div>
                <div className="special-button-grid">
                  {state.players.map((player) => (
                    <button
                      key={`first-ttadak-${player.id}`}
                      type="button"
                      className="ghost small"
                      onClick={() => handleTtadakClick(player.id)}
                    >
                      {player.name}
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          )}
          </div>
          </div>

          {selection.from && selection.to && (
            <div className="numpad-overlay">
              <div className="numpad">
                <div className="numpad-header">
                  <span>{state.players.find(p => p.id === selection.from)?.name} → {state.players.find(p => p.id === selection.to)?.name}</span>
                  <button className="ghost small" onClick={() => { setSelection({ from: null, to: null }); setAmountInput(''); }}>취소</button>
                </div>
                <div className="numpad-display">{amountInput || '0'}</div>
                <div className="numpad-grid">
                  {[1,2,3,4,5,6,7,8,9].map((n) => (
                    <button key={n} className="numpad-key" onClick={() => setAmountInput((prev) => prev + String(n))}>{n}</button>
                  ))}
                  <button className="numpad-key" onClick={() => setAmountInput((prev) => prev.slice(0, -1))}>←</button>
                  <button className="numpad-key" onClick={() => setAmountInput((prev) => prev + '0')}>0</button>
                  <button className="numpad-key numpad-submit" onClick={submitTransfer}>기록</button>
                </div>
              </div>
            </div>
          )}

          {showSettlement && (
            <div className="settlement-overlay" onClick={() => setShowSettlement(false)}>
              <div className="settlement-modal card" onClick={(e) => e.stopPropagation()}>
                <div className="settlement-section">
                  <h3>점당 금액</h3>
                  <div className="settlement-chip-value">
                    <div className="chip-value-display">{state.chipValue ? `${state.chipValue.toLocaleString()}원` : '0원'}</div>
                    <div className="chip-value-buttons">
                      <button className="ghost small" onClick={() => setState((prev) => ({ ...prev, chipValue: Math.max(0, prev.chipValue - 500) }))}>-500</button>
                      <button className="ghost small" onClick={() => setState((prev) => ({ ...prev, chipValue: Math.max(0, prev.chipValue - 100) }))}>-100</button>
                      <button className="ghost small" onClick={() => setState((prev) => ({ ...prev, chipValue: prev.chipValue + 100 }))}>+100</button>
                      <button className="ghost small" onClick={() => setState((prev) => ({ ...prev, chipValue: prev.chipValue + 500 }))}>+500</button>
                    </div>
                  </div>
                </div>

                <div className="settlement-section">
                  <h3>최종 순위</h3>
                  <div className="settlement-ranking">
                    {ranking.map((player, index) => {
                      const diff = balances[player.id] - state.initialChips;
                      return (
                        <div key={player.id} className="settlement-rank-row">
                          <span className="settlement-rank-num">{index + 1}</span>
                          <span className="settlement-rank-name">{player.name}</span>
                          <span className={`settlement-diff ${diff > 0 ? 'positive' : diff < 0 ? 'negative' : ''}`}>
                            {diff > 0 ? '+' : ''}{diff}점
                            {state.chipValue > 0 && (
                              <span className="settlement-money">
                                {' '}({(diff * state.chipValue).toLocaleString()}원)
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="settlement-section">
                  <h3>정산 안내</h3>
                  {settlements.length === 0 ? (
                    <p className="caption">정산할 내역이 없습니다.</p>
                  ) : (
                    <div className="settlement-list">
                      {settlements.map((s, i) => (
                        <div key={i} className="settlement-item">
                          <span className="settlement-from">{s.from}</span>
                          <span className="settlement-arrow">→</span>
                          <span className="settlement-to">{s.to}</span>
                          <strong className="settlement-amount">
                            {state.chipValue > 0 ? `${(s.amount * state.chipValue).toLocaleString()}원` : `${s.amount}점`}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="settlement-actions">
                  <button className="ghost" onClick={() => setShowSettlement(false)}>닫기</button>
                  <button onClick={() => { resetGame(); }}>새 게임</button>
                </div>
              </div>
            </div>
          )}

          {showWins && (
            <div className="settlement-overlay" onClick={() => setShowWins(false)}>
              <div className="settlement-modal card" onClick={(e) => e.stopPropagation()}>
                <div className="settlement-section">
                  <h3>승리 횟수</h3>
                  <p className="caption">받는 사람으로 {state.players.length - 1}회 지정되면 1승이 증가합니다.</p>
                  <div className="settlement-ranking">
                    {winsRanking.map((player, index) => (
                      <div key={player.id} className="settlement-rank-row">
                        <span className="settlement-rank-num">{index + 1}</span>
                        <span className="settlement-rank-name">{player.name}</span>
                        <span className="settlement-diff positive">+{state.winCounts[player.id] ?? 0}승</span>
                        <span className="settlement-money">
                          진행 {state.receiveCounts[player.id] ?? 0}/{state.players.length - 1}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="settlement-actions">
                  <button className="ghost" onClick={() => setShowWins(false)}>닫기</button>
                </div>
              </div>
            </div>
          )}

          {specialConfirm && (
            <div className="confirm-overlay" onClick={closeSpecialConfirm}>
              <div className="confirm-modal card" onClick={(e) => e.stopPropagation()}>
                <h3>특수 점수 확인</h3>
                <p>
                  <strong>{specialConfirm.event.label}</strong> 처리 시{' '}
                  <strong>{state.players.find((player) => player.id === specialConfirm.toPlayerId)?.name ?? '선택한 플레이어'}</strong>
                  님이 다른 플레이어 전원에게서{' '}
                  {specialConfirm.type === 'bbeok' && specialConfirm.event.stage === 2
                    ? `${specialConfirm.event.amount + 5}점(20점 + 종료 5점)`
                    : `${specialConfirm.event.amount}점`}씩 받습니다.
                </p>
                <p className="confirm-summary">
                  총 획득 점수:{' '}
                  <strong>
                    {(state.players.length - 1) * (
                      specialConfirm.type === 'bbeok' && specialConfirm.event.stage === 2
                        ? specialConfirm.event.amount + 5
                        : specialConfirm.event.amount
                    )}점
                  </strong>
                </p>
                <div className="confirm-actions">
                  <button className="ghost" onClick={closeSpecialConfirm}>취소</button>
                  <button onClick={confirmSpecialBonus}>적용</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
