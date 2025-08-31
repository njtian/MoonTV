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

  return (
    <div className='mx-auto max-w-sm p-4'>
      <h1 className='mb-2 text-xl font-semibold'>MoonTV 遥控器</h1>
      <p className='mb-4 text-sm opacity-70'>状态：{status}</p>

      <div className='grid grid-cols-3 gap-2'>
        <button
          className='rounded bg-gray-200 py-3 dark:bg-zinc-800'
          onClick={() => send({ type: 'focus', payload: { key: 'up' } })}
        >
          ▲
        </button>
        <button
          className='rounded bg-gray-200 py-3 dark:bg-zinc-800'
          onClick={() => send({ type: 'focus', payload: { key: 'enter' } })}
        >
          OK
        </button>
        <button
          className='rounded bg-gray-200 py-3 dark:bg-zinc-800'
          onClick={() => send({ type: 'focus', payload: { key: 'back' } })}
        >
          返回
        </button>
        <button
          className='rounded bg-gray-200 py-3 dark:bg-zinc-800'
          onClick={() => send({ type: 'focus', payload: { key: 'left' } })}
        >
          ◀
        </button>
        <button
          className='rounded bg-gray-200 py-3 dark:bg-zinc-800'
          onClick={() => send({ type: 'focus', payload: { key: 'down' } })}
        >
          ▼
        </button>
        <button
          className='rounded bg-gray-200 py-3 dark:bg-zinc-800'
          onClick={() => send({ type: 'focus', payload: { key: 'right' } })}
        >
          ▶
        </button>
      </div>

      <div className='mt-4 grid grid-cols-3 gap-2'>
        <button
          className='rounded bg-primary-500 py-2 text-white'
          onClick={() =>
            send({ type: 'playback', payload: { action: 'play' } })
          }
        >
          播放
        </button>
        <button
          className='rounded bg-primary-500 py-2 text-white'
          onClick={() =>
            send({ type: 'playback', payload: { action: 'pause' } })
          }
        >
          暂停
        </button>
        <button
          className='rounded bg-primary-500 py-2 text-white'
          onClick={() =>
            send({ type: 'playback', payload: { action: 'seek', value: -10 } })
          }
        >
          -10s
        </button>
        <button
          className='rounded bg-primary-500 py-2 text-white'
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
