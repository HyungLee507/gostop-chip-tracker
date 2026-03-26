import React, { useEffect, useMemo, useState } from 'react';

function generateId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const STORAGE_KEY = 'gostop-chip-tracker-v1';
const DEFAULT_PLAYERS = ['플레이어 1', '플레이어 2', '플레이어 3', '플레이어 4'];
const DEFAULT_CHIPS = 0;

function createInitialState() {
  return {
    players: DEFAULT_PLAYERS.map((name, index) => ({ id: String(index + 1), name: '' })),
    initialChips: DEFAULT_CHIPS,
    chipValue: 0,
    transfers: [],
    isStarted: false,
  };
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

  if (normalized.length < 3) {
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
        createdAt: Number(transfer?.createdAt) || Date.now(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
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

    return {
      players,
      initialChips: Number(parsed.initialChips) >= 0 ? Math.floor(Number(parsed.initialChips)) : DEFAULT_CHIPS,
      chipValue: Number(parsed.chipValue) >= 0 ? Number(parsed.chipValue) : 0,
      transfers: normalizeTransfers(parsed.transfers, playerIds),
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

export default function App() {
  const [state, setState] = useState(loadInitialState);
  const [initialChipsInput, setInitialChipsInput] = useState(() => String(loadInitialState().initialChips));
  const [selection, setSelection] = useState({ from: null, to: null });
  const [amountInput, setAmountInput] = useState('');
  const [showSettlement, setShowSettlement] = useState(false);

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
    if (state.players.length <= 3) return;

    setState((prev) => ({
      ...prev,
      players: prev.players.filter((player) => player.id !== id),
      transfers: prev.transfers.filter(
        (transfer) => transfer.from !== id && transfer.to !== id
      ),
    }));

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

    setState((prev) => ({
      ...prev,
      transfers: [
        {
          id: generateId(),
          from: selection.from,
          to: selection.to,
          amount,
          createdAt: Date.now(),
        },
        ...prev.transfers,
      ],
    }));

    setSelection({ from: null, to: null });
    setAmountInput('');
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
    setState((prev) => ({
      ...prev,
      transfers: prev.transfers.filter((transfer) => transfer.id !== id),
    }));
  }

  function resetGame() {
    const nextState = createInitialState();
    setState(nextState);
    setInitialChipsInput(String(nextState.initialChips));
    setSelection({ from: null, to: null });
    setAmountInput('');
    setShowSettlement(false);
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
                    disabled={state.players.length <= 3}
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
                      ? '보내는 사람을 선택하세요'
                      : '받는 사람을 선택하세요'}
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
          </div>
          <aside className="game-sidebar card">
            <h2>이동 내역</h2>
            <div className="history-list">
              {state.transfers.length === 0 && <p className="caption">아직 기록이 없습니다.</p>}
              {state.transfers.map((transfer) => {
                const from = state.players.find((player) => player.id === transfer.from)?.name ?? '알 수 없음';
                const to = state.players.find((player) => player.id === transfer.to)?.name ?? '알 수 없음';

                return (
                  <div key={transfer.id} className="history-row">
                    <span className="history-row-main">
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
        </>
      )}
    </div>
  );
}
