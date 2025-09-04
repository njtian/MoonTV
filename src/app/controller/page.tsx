'use client';
/* eslint-disable no-console */

import Image from 'next/image';
import React from 'react';

import { SearchResult } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import EpisodeSelector from '@/components/EpisodeSelector';

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
  const [status, setStatus] = React.useState<
    'idle' | 'checking' | 'waiting' | 'connected' | 'error'
  >('idle');
  const [pageStatus, setPageStatus] = React.useState<{
    page?: 'home' | 'play' | 'search' | 'detail' | 'other';
    pageTitle?: string;
  }>({});
  const [meta, setMeta] = React.useState<{
    title?: string;
    episodeIndex?: number;
    totalEpisodes?: number;
    cover?: string;
    currentSource?: string;
    currentId?: string;
  }>({});

  // Episode selector state
  const [showEpisodeSelector, setShowEpisodeSelector] = React.useState(false);

  // Source switching state for EpisodeSelector
  const [availableSources, setAvailableSources] = React.useState<
    SearchResult[]
  >([]);
  const [sourceSearchLoading, setSourceSearchLoading] = React.useState(false);
  const [sourceSearchError, setSourceSearchError] = React.useState<
    string | null
  >(null);

  const [localSession, setLocalSession] = React.useState<{
    sid: string;
    token: string;
    lastActive: number;
  } | null>(null);

  // 使用ref存储checkSubscribers函数以避免循环依赖
  const checkSubscribersRef = React.useRef<typeof checkSubscribers>();
  const tryGetLatestSessionRef = React.useRef<() => Promise<void>>();

  // 保存会话到本地存储
  const saveSessionToLocal = React.useCallback(
    (sessionData: { sid: string; token: string }) => {
      const session = {
        ...sessionData,
        lastActive: Date.now(),
      };
      setLocalSession(session);
      localStorage.setItem('rc_controller_session', JSON.stringify(session));
    },
    []
  );

  // 检查订阅者状态
  const checkSubscribers = React.useCallback(
    async (sessionSid: string, sessionToken: string, shouldFallback = true) => {
      console.log('检查订阅者状态:', sessionSid);
      setStatus('checking');

      try {
        const res = await fetch(
          `/api/remote/subscribers?sid=${encodeURIComponent(
            sessionSid
          )}&token=${encodeURIComponent(sessionToken)}&checkType=player`
        );
        const data = await res.json();

        if (res.ok && data.code === 0) {
          if (data.data.hasSubscribers) {
            setStatus('connected');
            console.log('检测到订阅者，已连接');
          } else {
            setStatus('waiting');
            console.log('未检测到订阅者，等待连接');
          }

          saveSessionToLocal({
            sid: sessionSid,
            token: sessionToken,
          });
        } else {
          throw new Error(data.message || '检查订阅者状态失败');
        }
      } catch (error) {
        console.error('检查订阅者状态失败:', error);
        setStatus('error');
        // 清除本地会话
        localStorage.removeItem('rc_controller_session');

        // 如果需要回退且没有URL参数，尝试获取最新会话
        if (shouldFallback && !sid && !token) {
          if (tryGetLatestSessionRef.current) {
            await tryGetLatestSessionRef.current();
          }
        }
      }
    },
    [saveSessionToLocal, sid, token]
  );

  // 将checkSubscribers存储到ref中
  React.useEffect(() => {
    checkSubscribersRef.current = checkSubscribers;
  }, [checkSubscribers]);

  // 获取最新会话
  const tryGetLatestSession = React.useCallback(async () => {
    console.log('尝试获取最新会话...');
    try {
      const res = await fetch('/api/remote/my-sessions');
      const data = await res.json();

      if (res.ok && data.code === 0 && data.data.sessions.length > 0) {
        const latestSession = data.data.sessions[0]; // 已经按创建时间排序，第一个是最新的
        console.log('获取到最新会话:', latestSession.sid);

        // 为最新会话生成新的token
        const tokenRes = await fetch('/api/remote/session/regenerate-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sid: latestSession.sid }),
        });

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          if (tokenData.code === 0) {
            saveSessionToLocal({
              sid: latestSession.sid,
              token: tokenData.data.token,
            });
            // 使用新会话检查订阅者状态，不进行回退
            if (checkSubscribersRef.current) {
              await checkSubscribersRef.current(
                latestSession.sid,
                tokenData.data.token,
                false
              );
            }
            return;
          }
        }
      }

      console.log('没有找到可用会话');
      setStatus('error');
    } catch (error) {
      console.error('获取最新会话失败:', error);
      setStatus('error');
    }
  }, [saveSessionToLocal]);

  // 将tryGetLatestSession存储到ref中
  React.useEffect(() => {
    tryGetLatestSessionRef.current = tryGetLatestSession;
  }, [tryGetLatestSession]);

  // 初始化时尝试恢复本地会话
  React.useEffect(() => {
    const savedSession = localStorage.getItem('rc_controller_session');
    if (savedSession) {
      try {
        const session = JSON.parse(savedSession);
        const now = Date.now();
        // 检查会话是否在24小时内有效
        if (
          session.lastActive &&
          now - session.lastActive < 24 * 60 * 60 * 1000
        ) {
          setLocalSession(session);
          // 如果没有URL参数，使用本地会话进行检查
          if (!sid && !token) {
            // 直接使用本地会话，不进行重定向
            console.log('使用本地会话恢复连接:', session.sid);
            // 延迟一下再尝试检查，确保组件完全挂载
            setTimeout(() => {
              checkSubscribers(session.sid, session.token);
            }, 100);
          } else {
            // 有URL参数时，使用URL参数进行检查
            setTimeout(() => {
              checkSubscribers(sid, token);
            }, 100);
          }
        } else {
          // 会话过期，清除本地存储
          localStorage.removeItem('rc_controller_session');
          // 如果没有URL参数，尝试获取最新会话
          if (!sid && !token) {
            setTimeout(() => {
              tryGetLatestSession();
            }, 100);
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('解析本地会话失败:', error);
        localStorage.removeItem('rc_controller_session');
        // 如果没有URL参数，尝试获取最新会话
        if (!sid && !token) {
          setTimeout(() => {
            tryGetLatestSession();
          }, 100);
        }
      }
    } else if (sid && token) {
      // 没有本地会话但有URL参数，直接检查
      setTimeout(() => {
        checkSubscribers(sid, token);
      }, 100);
    } else {
      // 没有本地会话也没有URL参数，尝试获取最新会话
      setTimeout(() => {
        tryGetLatestSession();
      }, 100);
    }
  }, [sid, token, checkSubscribers, tryGetLatestSession]);

  // 定期检查订阅者状态
  React.useEffect(() => {
    if (!localSession?.sid || !localSession?.token) return;

    const timer = setInterval(async () => {
      try {
        // 只检查订阅者状态，不需要更新控制器心跳状态
        const res = await fetch(
          `/api/remote/subscribers?sid=${encodeURIComponent(
            localSession.sid
          )}&token=${encodeURIComponent(localSession.token)}&checkType=player`
        );
        const data = await res.json();

        if (res.ok && data.code === 0) {
          if (data.data.hasSubscribers) {
            if (status !== 'connected') {
              setStatus('connected');
              console.log('检测到订阅者，状态更新为已连接');
            }
          } else {
            if (status !== 'waiting') {
              setStatus('waiting');
              console.log('未检测到订阅者，状态更新为等待连接');
            }
          }
        }
      } catch (error) {
        console.warn('检查订阅者状态失败:', error);
      }
    }, 5000); // 每5秒检查一次

    return () => clearInterval(timer);
  }, [localSession?.sid, localSession?.token, status]);

  const send = async (message: unknown) => {
    const currentSid = localSession?.sid || sid;
    const currentToken = localSession?.token || token;

    if (!currentSid || !currentToken) {
      // eslint-disable-next-line no-console
      console.warn('send 函数缺少必要参数:', {
        sid: !!currentSid,
        token: !!currentToken,
      });
      return;
    }
    try {
      await jsonFetch('/api/remote/publish', {
        sid: currentSid,
        token: currentToken,
        message,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('发送远程控制消息失败:', error);
    }
  };

  // Slider for seeking to percentage
  const [percent, setPercent] = React.useState(0);
  const [duration, setDuration] = React.useState<number | null>(null);
  const [currentTime, setCurrentTime] = React.useState<number | null>(null);
  const [isSeeking, setIsSeeking] = React.useState(false);
  const [seekSeconds, setSeekSeconds] = React.useState<number>(0);
  const _onSeekTo = async (p: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(p)));
    setPercent(clamped);
    if (duration && duration > 0) {
      const seconds = Math.round((clamped / 100) * duration);
      await send({
        type: 'playback',
        payload: { action: 'seekTo', value: seconds },
      });
    }
  };

  // Subscribe SSE directly to receive status and other messages
  React.useEffect(() => {
    const currentSid = localSession?.sid || sid;
    if (!currentSid) return;

    let es: EventSource | null = null;

    try {
      es = new EventSource(
        `/api/remote/stream?sid=${encodeURIComponent(currentSid)}`
      );

      const onMsg = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          const msg = data?.message || data;
          if (!msg) return;
          if (msg.type === 'status') {
            // Handle page status
            if (msg.payload?.page) {
              setPageStatus({
                page: msg.payload.page,
                pageTitle: msg.payload.pageTitle,
              });
            }

            // Handle play page status
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
            const currentSource = msg.payload?.currentSource;
            const currentId = msg.payload?.currentId;
            if (
              title ||
              episodeIndex ||
              totalEpisodes ||
              cover ||
              currentSource ||
              currentId
            ) {
              setMeta({
                title,
                episodeIndex,
                totalEpisodes,
                cover,
                currentSource,
                currentId,
              });
            }
          }
        } catch (parseError) {
          // eslint-disable-next-line no-console
          console.warn('解析SSE消息失败:', parseError);
        }
      };

      const onError = (error: Event) => {
        // eslint-disable-next-line no-console
        console.warn('SSE连接错误:', error);
      };

      es.onmessage = onMsg;
      es.onerror = onError;
    } catch (sseError) {
      // eslint-disable-next-line no-console
      console.warn('创建SSE连接失败:', sseError);
    }

    return () => {
      if (es) {
        try {
          es.close();
        } catch (closeError) {
          // eslint-disable-next-line no-console
          console.warn('关闭SSE连接失败:', closeError);
        }
      }
    };
  }, [localSession?.sid, sid, isSeeking]);

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

  // Get display status text
  const getStatusText = () => {
    if (status === 'error') return '连接错误';
    if (status === 'checking') return '检查中...';
    if (status === 'waiting') return '等待连接';
    if (status === 'connected') {
      if (pageStatus.page === 'play') return '播放页面';
      if (pageStatus.page === 'home') return '首页';
      if (pageStatus.page === 'search') return '搜索页面';
      if (pageStatus.page === 'detail') return '详情页面';
      if (pageStatus.page === 'other') return '其他页面';
      return '已连接';
    }
    if (status === 'idle') return '未连接';
    return status;
  };

  // 获取播放源列表的函数
  const fetchAvailableSources = async (title: string, year?: string) => {
    if (!title) return;

    setSourceSearchLoading(true);
    setSourceSearchError(null);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(title.trim())}`
      );
      if (!response.ok) {
        throw new Error('搜索失败');
      }

      const data = await response.json();

      // 应用与播放器相同的过滤逻辑
      const results = data.results.filter((result: SearchResult) => {
        // 标题匹配（忽略空格，不区分大小写）
        const titleMatch =
          result.title.replaceAll(' ', '').toLowerCase() ===
          title.replaceAll(' ', '').toLowerCase();

        // 年份匹配（如果指定了年份）
        const yearMatch = year
          ? result.year.toLowerCase() === year.toLowerCase()
          : true;

        // 类型匹配（根据集数判断：多集为电视剧，单集为电影）
        const typeMatch = result.episodes && result.episodes.length > 0;

        return titleMatch && yearMatch && typeMatch;
      });

      setAvailableSources(results);
    } catch (err) {
      setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
      setAvailableSources([]);
    } finally {
      setSourceSearchLoading(false);
    }
  };

  // 处理换源
  const handleSourceChange = (source: string, id: string, _title: string) => {
    try {
      // 从availableSources中获取完整的源信息
      const sourceInfo = availableSources.find(
        (s) => s.source === source && s.id === id
      );

      if (sourceInfo) {
        // 发送换源命令，只包含必要的字段
        send({
          type: 'source',
          payload: {
            action: 'change',
            source,
            id,
            title: sourceInfo.title,
            year: sourceInfo.year,
            stype: sourceInfo.episodes.length > 1 ? 'tv' : 'movie',
          },
        });
      } else {
        // 如果找不到源信息，使用原有逻辑
        send({
          type: 'source',
          payload: {
            action: 'change',
            source,
            id,
          },
        });
      }
      setShowEpisodeSelector(false);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('发送换源命令失败:', error);
    }
  };

  // 处理继续观看视频点击
  const handleVideoClick = (
    source: string,
    id: string,
    title: string,
    year: string,
    type: 'tv' | 'movie'
  ) => {
    try {
      send({
        type: 'continueWatching',
        payload: {
          source,
          id,
          title,
          year,
          stype: type,
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('发送继续观看命令失败:', error);
    }
  };

  return (
    <div className='mx-auto max-w-md p-4 relative'>
      <div className='flex items-center justify-between mb-4'>
        <div>
          <h1 className='text-xl font-semibold'>MoonTV 遥控器</h1>
          <p className='text-sm opacity-70'>状态：{getStatusText()}</p>
        </div>
        {status === 'error' && (
          <button
            onClick={() => {
              setStatus('idle');
              // 延迟重连，避免立即冲突
              setTimeout(() => {
                if (localSession?.sid && localSession?.token) {
                  checkSubscribers(localSession.sid, localSession.token);
                } else if (sid && token) {
                  checkSubscribers(sid, token);
                }
              }, 1000);
            }}
            className='px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors'
          >
            重连
          </button>
        )}
        {status === 'connected' && localSession && (
          <div className='text-xs opacity-60'>
            会话: {localSession.sid.slice(0, 8)}...
          </div>
        )}
      </div>

      {/* Show poster and meta only on play page */}
      {pageStatus.page === 'play' && (
        <div className='mb-4'>
          <div className='flex gap-3 items-center mb-4'>
            <div className='w-20 h-28 rounded overflow-hidden bg-gray-200 dark:bg-zinc-800 flex items-center justify-center'>
              {meta.cover ? (
                <Image
                  src={meta.cover}
                  alt='poster'
                  width={80}
                  height={112}
                  className='w-full h-full object-cover'
                  referrerPolicy='no-referrer'
                />
              ) : (
                <span className='text-xs opacity-60'>无封面</span>
              )}
            </div>
            <div className='flex-1 min-w-0'>
              <div className='text-sm font-medium truncate'>
                {meta.title || '—'}
              </div>
              <div className='text-xs opacity-70 mt-1'>
                {meta.episodeIndex ? `第 ${meta.episodeIndex} 集` : ''}
                {meta.totalEpisodes ? ` / 共 ${meta.totalEpisodes} 集` : ''}
              </div>
            </div>
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
                await send({
                  type: 'playback',
                  payload: { action: 'seekTo', value: latestSecs || 0 },
                });
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
              await send({
                type: 'playback',
                payload: { action: 'seekTo', value: seekSeconds || 0 },
              });
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
              ? `${formatTime(
                  isSeeking ? seekSeconds : currentTime
                )} / ${formatTime(duration)}`
              : '—'}
          </div>
        </div>
      )}

      {/* Show non-play page info */}
      {pageStatus.page && pageStatus.page !== 'play' && (
        <div className='mb-4 p-4 rounded-lg bg-gray-100 dark:bg-zinc-900'>
          <p className='text-sm'>
            当前页面：{pageStatus.pageTitle || pageStatus.page}
          </p>
          <p className='text-xs opacity-70 mt-1'>导航控制可用</p>
        </div>
      )}

      {/* Show Continue Watching section when not on play page */}
      {pageStatus.page && pageStatus.page !== 'play' && (
        <div className='mb-4'>
          <ContinueWatching onVideoClick={handleVideoClick} />
        </div>
      )}

      {/* Refresh button - only show on play page */}
      {pageStatus.page === 'play' && (
        <div className='absolute top-4 right-4'>
          <button
            className='w-10 h-10 rounded-full bg-white/90 dark:bg-zinc-800/90 backdrop-blur-sm shadow-lg hover:bg-white dark:hover:bg-zinc-700 transition-all duration-200 hover:scale-110 active:scale-95 border border-gray-200 dark:border-zinc-700'
            onClick={() => {
              if (
                confirm(
                  '确定要刷新播放器页面吗？\n\n这将重新加载整个播放器页面，可以解决播放卡顿、加载异常等问题。'
                )
              ) {
                send({ type: 'system', payload: { action: 'reload' } });
              }
            }}
            title='刷新播放器页面'
          >
            <svg
              className='w-5 h-5 mx-auto text-gray-700 dark:text-gray-300'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
              />
            </svg>
          </button>
        </div>
      )}

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

      {/* Show playback controls only on play page */}
      {pageStatus.page === 'play' && (
        <div className='mt-4 space-y-3'>
          {/* Episode navigation controls - show only if multiple episodes */}
          {meta.totalEpisodes && meta.totalEpisodes > 1 && (
            <>
              <div className='grid grid-cols-3 gap-3'>
                <button
                  className='h-11 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors'
                  onClick={() => {
                    try {
                      send({
                        type: 'episode',
                        payload: { action: 'previous' },
                      });
                    } catch (error) {
                      // eslint-disable-next-line no-console
                      console.warn('发送上一集命令失败:', error);
                    }
                  }}
                >
                  上一集
                </button>
                <button
                  className='h-11 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors'
                  onClick={() => {
                    if (meta.title) {
                      fetchAvailableSources(meta.title);
                      setShowEpisodeSelector(true);
                    }
                  }}
                >
                  选集/换源
                </button>
                <button
                  className='h-11 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors'
                  onClick={() => {
                    try {
                      send({ type: 'episode', payload: { action: 'next' } });
                    } catch (error) {
                      // eslint-disable-next-line no-console
                      console.warn('发送下一集命令失败:', error);
                    }
                  }}
                >
                  下一集
                </button>
              </div>

              {/* Episode current info */}
              {meta.episodeIndex && (
                <div className='text-center text-sm text-gray-600 dark:text-gray-400'>
                  当前：第 {meta.episodeIndex} 集 / 共 {meta.totalEpisodes} 集
                </div>
              )}
            </>
          )}

          {/* Main playback controls */}
          <div className='grid grid-cols-2 gap-3'>
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
                send({
                  type: 'playback',
                  payload: { action: 'seek', value: -10 },
                })
              }
            >
              -10s
            </button>
            <button
              className='h-11 rounded-lg bg-primary-500 text-white font-medium'
              onClick={() =>
                send({
                  type: 'playback',
                  payload: { action: 'seek', value: +10 },
                })
              }
            >
              +10s
            </button>
          </div>

          {/* Fullscreen controls */}
          <div className='grid grid-cols-2 gap-3'>
            <button
              className='h-11 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors'
              onClick={() => {
                try {
                  send({
                    type: 'playback',
                    payload: { action: 'toggleFullscreen' },
                  });
                } catch (error) {
                  // eslint-disable-next-line no-console
                  console.warn('发送全屏命令失败:', error);
                }
              }}
            >
              全屏
            </button>
            <button
              className='h-11 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors'
              onClick={() => {
                try {
                  send({
                    type: 'playback',
                    payload: { action: 'exitFullscreen' },
                  });
                } catch (error) {
                  // eslint-disable-next-line no-console
                  console.warn('发送退出全屏命令失败:', error);
                }
              }}
            >
              退出全屏
            </button>
          </div>
        </div>
      )}

      {/* Episode Selector Modal */}
      {showEpisodeSelector && (
        <div
          className='fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'
          onClick={() => setShowEpisodeSelector(false)}
        >
          <div
            className='bg-white dark:bg-gray-800 rounded-lg p-6 w-[90vw] max-w-4xl h-[90vh] flex flex-col'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='flex justify-between items-center mb-4'>
              <h3 className='text-lg font-semibold'>
                {availableSources.length > 0 ? '选择播放源' : '选择集数'}
              </h3>
              <button
                onClick={() => setShowEpisodeSelector(false)}
                className='text-gray-500 hover:text-gray-700 text-2xl'
              >
                ×
              </button>
            </div>

            {/* Use EpisodeSelector component for both episode selection and source switching */}
            <div className='flex-1 min-h-0 -mx-6 h-full'>
              <EpisodeSelector
                totalEpisodes={meta.totalEpisodes || 1}
                value={meta.episodeIndex || 1}
                onChange={(episodeNumber) => {
                  try {
                    // eslint-disable-next-line no-console
                    console.log('遥控器选集:', { episodeNumber, meta: meta });
                    // EpisodeSelector 已经传递了 0-based index，不需要再减1
                    const episode = episodeNumber;
                    // eslint-disable-next-line no-console
                    console.log('发送选集命令:', { episode, episodeNumber });
                    send({
                      type: 'episode',
                      payload: { action: 'select', episode },
                    });
                    setShowEpisodeSelector(false);
                  } catch (error) {
                    // eslint-disable-next-line no-console
                    console.warn('发送选集命令失败:', error);
                  }
                }}
                onSourceChange={handleSourceChange}
                currentSource={meta.currentSource}
                currentId={meta.currentId}
                videoTitle={meta.title}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
