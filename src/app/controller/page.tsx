'use client';

import React from 'react';

function jsonFetch(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type ControllerSearchParams = { sid?: string; t?: string };

export default function ControllerPage({
  searchParams,
}: {
  searchParams: ControllerSearchParams;
}) {
  const sid = searchParams?.sid || '';
  const token = searchParams?.t || '';
  const [controllerId, setControllerId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<
    'idle' | 'claiming' | 'ready' | 'error'
  >('idle');
  const [meta, setMeta] = React.useState<{
    title?: string;
    episodeIndex?: number;
    totalEpisodes?: number;
    cover?: string;
  }>({});

  React.useEffect(() => {
    let mounted = true;
    const claim = async () => {
      if (!sid || !token) return;
      setStatus('claiming');
      try {
        const res = await jsonFetch('/api/remote/claim', { sid, token });
        const data = await res.json();
        if (!res.ok || data.code !== 0)
          throw new Error(data.message || 'claim failed');
        if (!mounted) return;
        setControllerId(data.data.controllerId);
        setStatus('ready');
      } catch (e) {
        setStatus('error');
      }
    };
    claim();
    return () => {
      mounted = false;
    };
  }, [sid, token]);

  // Heartbeat
  React.useEffect(() => {
    if (!controllerId || !sid || !token) return;
    const timer = setInterval(() => {
      jsonFetch('/api/remote/claim', {
        sid,
        token,
        controllerId,
        heartbeat: true,
      });
    }, 15000);
    return () => clearInterval(timer);
  }, [controllerId, sid, token]);

  const send = async (message: unknown) => {
    if (!sid || !token || !controllerId) return;
    await jsonFetch('/api/remote/publish', {
      sid,
      token,
      controllerId,
      message,
    });
  };

  // Slider for seeking to percentage
  const [percent, setPercent] = React.useState(0);
  const [duration, setDuration] = React.useState<number | null>(null);
  const [currentTime, setCurrentTime] = React.useState<number | null>(null);
  const [isSeeking, setIsSeeking] = React.useState(false);
  const [seekSeconds, setSeekSeconds] = React.useState<number>(0);
  const onSeekTo = async (p: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(p)));
    setPercent(clamped);
    if (duration && duration > 0) {
      const seconds = Math.round((clamped / 100) * duration);
      await send({ type: 'playback', payload: { action: 'seekTo', value: seconds } });
    }
  };

  // Subscribe SSE directly to receive status and other messages
  React.useEffect(() => {
    if (!sid) return;
    const es = new EventSource(`/api/remote/stream?sid=${encodeURIComponent(sid)}`);
    const onMsg = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        const msg = data?.message || data;
        if (!msg) return;
        if (msg.type === 'status') {
          const d = msg.payload?.duration;
          const ct = msg.payload?.currentTime;
          if (typeof d === 'number') setDuration(d);
          if (typeof ct === 'number' && !isSeeking) {
            setCurrentTime(ct);
            if (typeof d === 'number' && d > 0) {
              setPercent(Math.round((ct / d) * 100));
            }
          }
          const title = msg.payload?.title;
          const episodeIndex = msg.payload?.episodeIndex;
          const totalEpisodes = msg.payload?.totalEpisodes;
          const cover = msg.payload?.cover;
          setMeta({ title, episodeIndex, totalEpisodes, cover });
        }
      } catch {
        // ignore
      }
    };
    es.onmessage = onMsg;
    return () => es.close();
  }, [sid, isSeeking]);

  // Remove window relay listener (we now consume SSE directly)

  // Format seconds to mm:ss or hh:mm:ss
  const formatTime = (sec?: number | null): string => {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '00:00';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
  };

  return (
    <div className='mx-auto max-w-md p-4'>
      <h1 className='mb-2 text-xl font-semibold'>MoonTV 遥控器</h1>
      <p className='mb-4 text-sm opacity-70'>状态：{status}</p>

      {/* Poster and meta */}
      <div className='flex gap-3 items-center mb-4'>
        <div className='w-20 h-28 rounded overflow-hidden bg-gray-200 dark:bg-zinc-800 flex items-center justify-center'>
          {meta.cover ? (
            <img src={meta.cover} alt='poster' className='w-full h-full object-cover' referrerPolicy='no-referrer' />
          ) : (
            <span className='text-xs opacity-60'>无封面</span>
          )}
        </div>
        <div className='flex-1 min-w-0'>
          <div className='text-sm font-medium truncate'>{meta.title || '—'}</div>
          <div className='text-xs opacity-70 mt-1'>
            {meta.episodeIndex ? `第 ${meta.episodeIndex} 集` : ''}
            {meta.totalEpisodes ? ` / 共 ${meta.totalEpisodes} 集` : ''}
          </div>
          {/* Progress bar visual (styled similar to player) */}
          {/* Draggable progress bar */}
          <div
            className='mt-2 h-2 bg-gray-200 dark:bg-zinc-700 rounded-full relative select-none touch-pan-y'
            onMouseDown={(e) => {
              if (!duration) return;
              e.preventDefault();
              const bar = e.currentTarget as HTMLDivElement;
              setIsSeeking(true);
              const rect = bar.getBoundingClientRect();
              const clamp = (n: number) => Math.min(1, Math.max(0, n));
              let latestSecs = 0;
              const pct0 = clamp((e.clientX - rect.left) / rect.width);
              latestSecs = Math.round(pct0 * duration);
              setSeekSeconds(latestSecs);
              setPercent(Math.round(pct0 * 100));
              const onMove = (ev: MouseEvent) => {
                const r = bar.getBoundingClientRect();
                const p = clamp((ev.clientX - r.left) / r.width);
                latestSecs = Math.round(p * duration);
                setSeekSeconds(latestSecs);
                setPercent(Math.round(p * 100));
              };
              const onUp = async () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                setIsSeeking(false);
                await send({ type: 'playback', payload: { action: 'seekTo', value: latestSecs || 0 } });
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp, { once: true });
            }}
            onTouchStart={(e) => {
              if (!duration) return;
              const bar = e.currentTarget as HTMLDivElement;
              setIsSeeking(true);
              const rect = bar.getBoundingClientRect();
              const clamp = (n: number) => Math.min(1, Math.max(0, n));
              const t = e.touches[0];
              const pct = clamp((t.clientX - rect.left) / rect.width);
              setSeekSeconds(Math.round(pct * duration));
              setPercent(Math.round(pct * 100));
            }}
            onTouchMove={(e) => {
              if (!duration) return;
              const bar = e.currentTarget as HTMLDivElement;
              const rect = bar.getBoundingClientRect();
              const clamp = (n: number) => Math.min(1, Math.max(0, n));
              const t = e.touches[0];
              const pct = clamp((t.clientX - rect.left) / rect.width);
              setSeekSeconds(Math.round(pct * duration));
              setPercent(Math.round(pct * 100));
            }}
            onTouchEnd={async () => {
              setIsSeeking(false);
              await send({ type: 'playback', payload: { action: 'seekTo', value: seekSeconds || 0 } });
            }}
          >
            <div
              className='absolute inset-y-0 left-0 bg-primary-500 rounded-full'
              style={{ width: `${percent}%` }}
            />
            <div
              className='absolute -top-1 -ml-2 h-4 w-4 rounded-full bg-white dark:bg-zinc-900 border border-primary-500 shadow'
              style={{ left: `${percent}%` }}
            />
          </div>
          <div className='mt-1 text-[11px] opacity-70'>
            {duration != null && currentTime != null
              ? `${formatTime(isSeeking ? seekSeconds : currentTime)} / ${formatTime(duration)}`
              : '—'}
          </div>
        </div>
      </div>

      <div className='grid grid-cols-3 gap-3'>
        <div />
        <button
          className='h-14 rounded-lg bg-gray-200 dark:bg-zinc-800 text-lg flex items-center justify-center'
          onClick={() => send({ type: 'focus', payload: { key: 'up' } })}
        >
          ▲
        </button>
        <div />
        <button
          className='h-14 rounded-lg bg-gray-200 dark:bg-zinc-800 text-lg flex items-center justify-center'
          onClick={() => send({ type: 'focus', payload: { key: 'left' } })}
        >
          ◀
        </button>
        <button
          className='h-14 rounded-lg bg-gray-200 dark:bg-zinc-800 text-base font-medium flex items-center justify-center'
          onClick={() => send({ type: 'focus', payload: { key: 'enter' } })}
        >
          OK
        </button>
        <button
          className='h-14 rounded-lg bg-gray-200 dark:bg-zinc-800 text-lg flex items-center justify-center'
          onClick={() => send({ type: 'focus', payload: { key: 'right' } })}
        >
          ▶
        </button>
        <div />
        <button
          className='h-14 rounded-lg bg-gray-200 dark:bg-zinc-800 text-lg flex items-center justify-center'
          onClick={() => send({ type: 'focus', payload: { key: 'down' } })}
        >
          ▼
        </button>
        <div />
      </div>

      <div className='mt-3 flex justify-end'>
        <button
          className='h-10 px-4 rounded-lg bg-gray-200 dark:bg-zinc-800'
          onClick={() => send({ type: 'focus', payload: { key: 'back' } })}
        >
          返回
        </button>
      </div>

      <div className='mt-4 grid grid-cols-2 gap-3'>
        <button
          className='h-11 rounded-lg bg-primary-500 text-white font-medium'
          onClick={() =>
            send({ type: 'playback', payload: { action: 'play' } })
          }
        >
          播放
        </button>
        <button
          className='h-11 rounded-lg bg-primary-500 text-white font-medium'
          onClick={() =>
            send({ type: 'playback', payload: { action: 'pause' } })
          }
        >
          暂停
        </button>
        <button
          className='h-11 rounded-lg bg-primary-500 text-white font-medium'
          onClick={() =>
            send({ type: 'playback', payload: { action: 'seek', value: -10 } })
          }
        >
          -10s
        </button>
        <button
          className='h-11 rounded-lg bg-primary-500 text-white font-medium'
          onClick={() =>
            send({ type: 'playback', payload: { action: 'seek', value: +10 } })
          }
        >
          +10s
        </button>
      </div>
    </div>
  );
}
