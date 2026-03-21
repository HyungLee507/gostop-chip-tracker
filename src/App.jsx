import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'gostop-chip-tracker-v1';
const DEFAULT_PLAYERS = ['플레이어 1', '플레이어 2', '플레이어 3'];
const DEFAULT_CHIPS = 100;

function createInitialState() {
  return {
    players: DEFAULT_PLAYERS.map((name, index) => ({ id: String(index + 1), name })),
    initialChips: DEFAULT_CHIPS,
    transfers: [],
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

function loadInitialState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return createInitialState();

    const parsed = JSON.parse(saved);
    if (!parsed || !Array.isArray(parsed.players) || !Array.isArray(parsed.transfers)) {
      return createInitialState();
    }

    return {
      players: parsed.players.length >= 3 ? parsed.players : createInitialState().players,
      initialChips: Number(parsed.initialChips) > 0 ? Number(parsed.initialChips) : DEFAULT_CHIPS,
      transfers: parsed.transfers,
    };
  } catch {
    return createInitialState();
  }
}

export default function App() {
  const [state, setState] = useState(loadInitialState);
  const [newPlayer, setNewPlayer] = useState('');
  const [transferForm, setTransferForm] = useState({
    from: '1',
    to: '2',
    amount: '',
    note: '',
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage failures and keep the UI usable
    }
  }, [state]);

  const balances = useMemo(() => {
    const map = Object.fromEntries(state.players.map((player) => [player.id, state.initialChips]));

    for (const transfer of state.transfers) {
      map[transfer.from] -= transfer.amount;
      map[transfer.to] += transfer.amount;
    }

    return map;
  }, [state]);

  const totalChips = state.players.length * state.initialChips;

  const ranking = useMemo(() => {
    return [...state.players].sort((a, b) => balances[b.id] - balances[a.id]);
  }, [state.players, balances]);

  function updatePlayerName(id, name) {
    setState((prev) => ({
      ...prev,
      players: prev.players.map((player) =>
        player.id === id ? { ...player, name } : player
      ),
    }));
  }

  function addPlayer() {
    const trimmed = newPlayer.trim();
    if (!trimmed || state.players.length >= 4) return;

    setState((prev) => ({
      ...prev,
      players: [...prev.players, { id: crypto.randomUUID(), name: trimmed }],
    }));
    setNewPlayer('');
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

    setTransferForm((prev) => ({
      ...prev,
      from: state.players.find((player) => player.id !== id)?.id ?? '',
      to: state.players.find((player) => player.id !== id)?.id ?? '',
    }));
  }

  function addTransfer(event) {
    event.preventDefault();
    const amount = Number(transferForm.amount);

    if (!transferForm.from || !transferForm.to || transferForm.from === transferForm.to) return;
    if (!Number.isFinite(amount) || amount <= 0) return;

    setState((prev) => ({
      ...prev,
      transfers: [
        {
          id: crypto.randomUUID(),
          from: transferForm.from,
          to: transferForm.to,
          amount,
          note: transferForm.note.trim(),
          createdAt: Date.now(),
        },
        ...prev.transfers,
      ],
    }));

    setTransferForm((prev) => ({ ...prev, amount: '', note: '' }));
  }

  function deleteTransfer(id) {
    setState((prev) => ({
      ...prev,
      transfers: prev.transfers.filter((transfer) => transfer.id !== id),
    }));
  }

  function resetGame() {
    setState(createInitialState());
    setTransferForm({ from: '1', to: '2', amount: '', note: '' });
  }

  return (
    <div className="app">
      <header className="header card">
        <div>
          <p className="eyebrow">고스톱 칩 트래커</p>
          <h1>칩 이동만 기록하는 간단한 정산판</h1>
        </div>
        <button className="ghost" onClick={resetGame}>초기화</button>
      </header>

      <section className="card grid-two">
        <div>
          <h2>게임 설정</h2>
          <label className="field">
            <span>시작 칩</span>
            <input
              type="number"
              min="1"
              value={state.initialChips}
              onChange={(e) =>
                setState((prev) => ({ ...prev, initialChips: Number(e.target.value) || 0 }))
              }
            />
          </label>
          <p className="caption">전체 칩 합계: {totalChips}</p>
        </div>

        <div>
          <h2>플레이어</h2>
          <div className="player-list">
            {state.players.map((player) => (
              <div key={player.id} className="player-row">
                <input
                  value={player.name}
                  onChange={(e) => updatePlayerName(player.id, e.target.value)}
                />
                <strong>{balances[player.id]}</strong>
                <button
                  className="ghost small"
                  onClick={() => removePlayer(player.id)}
                  disabled={state.players.length <= 3}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          <div className="inline-form">
            <input
              placeholder="플레이어 추가"
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              disabled={state.players.length >= 4}
            />
            <button onClick={addPlayer} disabled={state.players.length >= 4}>추가</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>칩 이동 입력</h2>
        <form className="transfer-form" onSubmit={addTransfer}>
          <label className="field">
            <span>보내는 사람</span>
            <select
              value={transferForm.from}
              onChange={(e) => setTransferForm((prev) => ({ ...prev, from: e.target.value }))}
            >
              {state.players.map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>받는 사람</span>
            <select
              value={transferForm.to}
              onChange={(e) => setTransferForm((prev) => ({ ...prev, to: e.target.value }))}
            >
              {state.players.map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>칩 수</span>
            <input
              type="number"
              min="1"
              value={transferForm.amount}
              onChange={(e) => setTransferForm((prev) => ({ ...prev, amount: e.target.value }))}
              placeholder="예: 3"
            />
          </label>

          <label className="field grow">
            <span>메모</span>
            <input
              value={transferForm.note}
              onChange={(e) => setTransferForm((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="선택 입력"
            />
          </label>

          <button type="submit">기록</button>
        </form>
      </section>

      <section className="grid-two">
        <div className="card">
          <h2>현재 순위</h2>
          <div className="ranking-list">
            {ranking.map((player, index) => (
              <div key={player.id} className="ranking-row">
                <span>{index + 1}</span>
                <span>{player.name}</span>
                <strong>{balances[player.id]}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>최근 이동 내역</h2>
          <div className="history-list">
            {state.transfers.length === 0 && <p className="caption">아직 기록이 없습니다.</p>}
            {state.transfers.map((transfer) => {
              const from = state.players.find((player) => player.id === transfer.from)?.name ?? '알 수 없음';
              const to = state.players.find((player) => player.id === transfer.to)?.name ?? '알 수 없음';

              return (
                <div key={transfer.id} className="history-row">
                  <div>
                    <strong>{transfer.amount}</strong>
                    <span>{from} → {to}</span>
                    {transfer.note && <p>{transfer.note}</p>}
                  </div>
                  <div className="history-actions">
                    <small>{formatTime(transfer.createdAt)}</small>
                    <button className="ghost small" onClick={() => deleteTransfer(transfer.id)}>삭제</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
