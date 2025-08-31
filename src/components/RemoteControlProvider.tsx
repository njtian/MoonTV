'use client';

import React from 'react';

type SessionInfo = {
  sid: string;
  token: string;
  controllerUrl: string;
};

export default function RemoteControlProvider() {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<SessionInfo | null>(null);

  React.useEffect(() => {
    // try resume from sessionStorage
    const raw =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('rc_session')
        : null;
    if (raw) {
      try {
        const s = JSON.parse(raw) as SessionInfo;
        if (s && s.sid && s.token) setSession(s);
      } catch {
        // ignore parse error
      }
    }
  }, []);

  const createSession = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/remote/session', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const s: SessionInfo = data.data;
      setSession(s);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('rc_session', JSON.stringify(s));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const copyUrl = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.controllerUrl);
    } catch {
      // ignore copy error
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='fixed bottom-5 right-5 z-40 rounded-full bg-primary-500 px-4 py-3 text-white shadow-lg hover:bg-primary-600 active:scale-95'
        aria-label='Remote Control'
      >
        遥控
      </button>

      {/* Modal */}
      {open && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'>
          <div className='w-full max-w-md rounded-lg bg-white p-4 text-gray-900 shadow-xl dark:bg-zinc-900 dark:text-gray-100'>
            <div className='mb-3 flex items-center justify-between'>
              <h3 className='text-lg font-semibold'>遥控器配对</h3>
              <button
                onClick={() => setOpen(false)}
                className='rounded px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10'
              >
                关闭
              </button>
            </div>

            {!session && (
              <div className='space-y-3'>
                <p className='text-sm opacity-80'>
                  创建一个会话，在手机上打开控制器页面进行配对。
                </p>
                <button
                  disabled={loading}
                  onClick={createSession}
                  className='w-full rounded bg-primary-500 px-4 py-2 text-white hover:bg-primary-600 disabled:opacity-60'
                >
                  {loading ? '创建中…' : '创建会话'}
                </button>
                {error && <p className='text-sm text-red-500'>{error}</p>}
              </div>
            )}

            {session && (
              <div className='space-y-3'>
                <div>
                  <p className='mb-1 text-sm opacity-80'>
                    在手机浏览器中打开以下链接：
                  </p>
                  <div className='break-all rounded border border-gray-300 p-2 text-xs dark:border-gray-700'>
                    {session.controllerUrl}
                  </div>
                </div>
                <div className='flex gap-2'>
                  <a
                    href={session.controllerUrl}
                    target='_blank'
                    rel='noreferrer'
                    className='flex-1 rounded bg-primary-500 px-4 py-2 text-center text-white hover:bg-primary-600'
                  >
                    本机打开
                  </a>
                  <button
                    onClick={copyUrl}
                    className='rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/10'
                  >
                    复制链接
                  </button>
                </div>
                <p className='text-xs opacity-70'>
                  注意：后续将补充二维码与会话状态显示。
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
