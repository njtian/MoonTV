'use client';

/* eslint-disable no-console */
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
  const sseRef = React.useRef<EventSource | null>(null);

  React.useEffect(() => {
    console.log('RemoteControlProvider: 开始初始化，检查会话恢复');

    // try resume from sessionStorage first
    const raw =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('rc_session')
        : null;
    if (raw) {
      try {
        const s = JSON.parse(raw) as SessionInfo;
        if (s && s.sid && s.token) {
          console.log(
            'RemoteControlProvider: 从sessionStorage恢复会话:',
            s.sid
          );
          setSession(s);
          return; // 如果本地有会话，直接使用，不进行服务器检查
        }
      } catch {
        // ignore parse error
      }
    }

    // 如果没有本地会话，尝试从服务器获取用户的最新会话
    console.log(
      'RemoteControlProvider: 没有本地会话，尝试从服务器获取用户会话'
    );
    loadUserSessions();
  }, []);

  const loadUserSessions = async () => {
    try {
      console.log('RemoteControlProvider: 开始获取用户会话列表');
      const res = await fetch('/api/remote/my-sessions');
      if (!res.ok) {
        console.log(
          'RemoteControlProvider: 获取用户会话失败，状态码:',
          res.status
        );
        return;
      }

      const data = await res.json();
      console.log('RemoteControlProvider: 获取到用户会话数据:', data);

      if (data.code === 0 && data.data.sessions.length > 0) {
        // 选择最新的活跃会话
        const latestSession = data.data.sessions[0];
        console.log('RemoteControlProvider: 最新会话:', latestSession);

        // 检查会话是否仍然有效（有lastActive且最近活跃）
        const now = Date.now();
        const isRecent =
          latestSession.lastActive &&
          now - latestSession.lastActive < 24 * 60 * 60 * 1000; // 24小时内活跃

        console.log(
          'RemoteControlProvider: 会话是否最近活跃:',
          isRecent,
          'lastActive:',
          latestSession.lastActive
        );

        if (isRecent) {
          // 为现有会话重新生成token
          try {
            console.log(
              'RemoteControlProvider: 开始重新生成token for session:',
              latestSession.sid
            );
            const tokenRes = await fetch(
              '/api/remote/session/regenerate-token',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sid: latestSession.sid }),
              }
            );

            if (tokenRes.ok) {
              const tokenData = await tokenRes.json();
              console.log(
                'RemoteControlProvider: token重新生成结果:',
                tokenData
              );

              if (tokenData.code === 0) {
                const sessionInfo: SessionInfo = {
                  sid: tokenData.data.sid,
                  token: tokenData.data.token,
                  controllerUrl: tokenData.data.controllerUrl,
                };
                setSession(sessionInfo);

                // 保存到sessionStorage
                if (typeof window !== 'undefined') {
                  window.sessionStorage.setItem(
                    'rc_session',
                    JSON.stringify(sessionInfo)
                  );
                }

                console.log(
                  'RemoteControlProvider: 自动恢复远程会话成功:',
                  latestSession.sid
                );
                return;
              }
            } else {
              console.log(
                'RemoteControlProvider: token重新生成失败，状态码:',
                tokenRes.status
              );
            }
          } catch (tokenError) {
            console.warn(
              'RemoteControlProvider: 重新生成token时出错:',
              tokenError
            );
          }
        } else {
          console.log(
            'RemoteControlProvider: 会话不是最近活跃的，跳过自动恢复'
          );
        }
      } else {
        console.log('RemoteControlProvider: 没有找到用户会话');
      }
    } catch (error) {
      console.warn('RemoteControlProvider: 获取用户会话时出错:', error);
    }
  };

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
      // Check if clipboard API is available and secure context
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(session.controllerUrl);
      } else {
        // Fallback for non-secure contexts
        const textArea = document.createElement('textarea');
        textArea.value = session.controllerUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(textArea);
        }
      }
    } catch (error) {
      console.warn('复制到剪贴板失败:', error);
      // ignore copy error - just fail silently
    }
  };

  // Subscribe SSE on session ready and dispatch to window (kept for screen-side consumers)
  React.useEffect(() => {
    if (!session?.sid) return;

    try {
      // Close existing connection
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }

      const es = new EventSource(
        `/api/remote/stream?sid=${encodeURIComponent(session.sid)}`
      );
      sseRef.current = es;

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          // Relay event to app for handlers (e.g., player page)
          window.dispatchEvent(
            new CustomEvent('remote:message', { detail: data })
          );
        } catch (parseError) {
          console.warn('解析SSE消息失败:', parseError);
        }
      };

      es.onerror = (error) => {
        console.warn('SSE连接错误:', error);
      };
    } catch (sseError) {
      console.warn('创建SSE连接失败:', sseError);
    }

    return () => {
      if (sseRef.current) {
        try {
          sseRef.current.close();
        } catch (closeError) {
          console.warn('关闭SSE连接失败:', closeError);
        }
        sseRef.current = null;
      }
    };
  }, [session?.sid]);

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
