/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';
import { useControllerStatus } from '@/hooks/useControllerStatus';

function jsonFetch(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { announcement } = useSite();
  const { status: controllerStatus, isController } = useControllerStatus();

  // 播放状态监听相关状态
  const [isListeningForPlayback, setIsListeningForPlayback] = useState(false);
  const [playbackTimeout, setPlaybackTimeout] = useState<NodeJS.Timeout | null>(
    null
  );
  // 收藏数据需要在 useMemo 之前声明
  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };
  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // 发送遥控指令的函数
  const send = async (message: unknown) => {
    if (!isController) {
      return;
    }

    try {
      // 获取遥控器会话信息
      const sessionRaw = window.localStorage.getItem('rc_controller_session');
      if (!sessionRaw) {
        return;
      }

      let sid = '';
      let token = '';
      try {
        const s = JSON.parse(sessionRaw);
        sid = s.sid || '';
        token = s.token || '';
      } catch {
        return;
      }

      if (!sid || !token) {
        return;
      }

      await jsonFetch('/api/remote/publish', {
        sid,
        token,
        message,
      });
    } catch (error) {
      // 静默处理错误，避免console输出
    }
  };

  // 开始监听播放状态
  const startListeningForPlayback = useCallback(() => {
    if (!isController || isListeningForPlayback) {
      return;
    }

    setIsListeningForPlayback(true);

    // 获取会话信息
    const sessionRaw = window.localStorage.getItem('rc_controller_session');
    if (!sessionRaw) {
      setIsListeningForPlayback(false);
      return;
    }

    let sid = '';
    let token = '';
    try {
      const s = JSON.parse(sessionRaw);
      sid = s.sid || '';
      token = s.token || '';
    } catch {
      setIsListeningForPlayback(false);
      return;
    }

    if (!sid || !token) {
      setIsListeningForPlayback(false);
      return;
    }

    // 创建SSE连接监听播放状态
    const es = new EventSource(
      `/api/remote/stream?sid=${encodeURIComponent(sid)}`
    );

    const onMessage = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        const msg = data?.message || data;
        if (!msg || msg.type !== 'status') return;

        const payload = msg.payload || {};
        const duration = payload.duration;
        const currentTime = payload.currentTime;
        const title = payload.title;

        // 检测到播放器开始播放（有duration和currentTime，且title不为空）
        if (
          typeof duration === 'number' &&
          duration > 0 &&
          typeof currentTime === 'number' &&
          currentTime > 0 &&
          title
        ) {
          // 停止监听
          es.close();
          setIsListeningForPlayback(false);

          // 清除超时定时器
          if (playbackTimeout) {
            clearTimeout(playbackTimeout);
            setPlaybackTimeout(null);
          }

          // 跳转到controller页面
          router.push('/controller');
        }
      } catch (error) {
        // 静默处理错误
      }
    };

    const onError = () => {
      es.close();
      setIsListeningForPlayback(false);
    };

    es.onmessage = onMessage;
    es.onerror = onError;

    // 设置超时，如果10秒内没有检测到播放，停止监听
    const timeout = setTimeout(() => {
      es.close();
      setIsListeningForPlayback(false);
    }, 10000);

    setPlaybackTimeout(timeout);
  }, [isController, isListeningForPlayback, playbackTimeout, router]);

  // 处理继续观看视频点击
  const handleVideoClick = (
    source: string,
    id: string,
    title: string,
    year: string,
    type: 'tv' | 'movie'
  ) => {
    // 只有在遥控器角色且已连接时才发送遥控指令
    if (isController && controllerStatus === 'connected') {
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

        // 发送指令后开始监听播放状态
        setTimeout(() => {
          startListeningForPlayback();
        }, 500); // 延迟500ms开始监听，给播放器一些时间响应
      } catch (error) {
        // 静默处理错误
      }
    }
    // 如果不是遥控器角色或未连接，则执行本地逻辑（ContinueWatching组件会处理）
  };

  // 处理通用视频点击（用于热门电影、热门剧集等）
  const handleGenericVideoClick = useCallback(
    (videoData: {
      source?: string;
      id?: string;
      title: string;
      year: string;
      type: 'tv' | 'movie';
      from: 'playrecord' | 'favorite' | 'search' | 'douban';
      douban_id?: string;
    }) => {
      // 只有在遥控器角色且已连接时才发送遥控指令
      if (isController && controllerStatus === 'connected') {
        try {
          if (videoData.from === 'douban') {
            // 豆瓣视频：发送搜索播放指令
            send({
              type: 'searchAndPlay',
              payload: {
                title: videoData.title,
                year: videoData.year,
                stype: videoData.type,
              },
            });

            // 搜索需要更长时间，延迟2秒开始监听
            setTimeout(() => {
              startListeningForPlayback();
            }, 2000);
          } else if (videoData.source && videoData.id) {
            // 有具体源和ID的视频：发送换源指令
            send({
              type: 'source',
              payload: {
                action: 'change',
                source: videoData.source,
                id: videoData.id,
                title: videoData.title,
                year: videoData.year,
                stype: videoData.type,
              },
            });

            // 换源相对较快，延迟500ms开始监听
            setTimeout(() => {
              startListeningForPlayback();
            }, 500);
          }
        } catch (error) {
          // 静默处理错误
        }
      }
      // 如果不是遥控器角色或未连接，则执行本地逻辑（VideoCard会处理）
    },
    [isController, controllerStatus, send, startListeningForPlayback]
  );

  // 清理函数
  useEffect(() => {
    return () => {
      // 组件卸载时清理定时器
      if (playbackTimeout) {
        clearTimeout(playbackTimeout);
      }
    };
  }, [playbackTimeout]);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夹数据（其余逻辑保持不变）

  useEffect(() => {
    const fetchDoubanData = async () => {
      try {
        setLoading(true);

        // 并行获取热门电影、热门剧集和热门综艺
        const [moviesData, tvShowsData, varietyShowsData] = await Promise.all([
          getDoubanCategories({
            kind: 'movie',
            category: '热门',
            type: '全部',
          }),
          getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
          getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
        ]);

        if (moviesData.code === 200) {
          setHotMovies(moviesData.list);
        }

        if (tvShowsData.code === 200) {
          setHotTvShows(tvShowsData.list);
        }

        if (varietyShowsData.code === 200) {
          setHotVarietyShows(varietyShowsData.list);
        }
      } catch (error) {
        console.error('获取豆瓣数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDoubanData();
  }, []);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  // 当切换到收藏夹时加载收藏数据
  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  // 获取遥控器入口的样式和状态信息
  const getControllerButtonInfo = () => {
    if (!isController) {
      return null; // 不是遥控器角色，不显示
    }

    switch (controllerStatus) {
      case 'connected':
        return {
          className:
            'inline-flex items-center gap-2 rounded-lg bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 px-3 py-2 text-sm text-green-700 dark:text-green-300 transition-colors duration-200',
          title: '遥控器已连接',
          icon: '📱',
          text: '已连接',
        };
      case 'checking':
        return {
          className:
            'inline-flex items-center gap-2 rounded-lg bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-300 transition-colors duration-200',
          title: '遥控器连接中...',
          icon: '⏳',
          text: '连接中',
        };
      case 'error':
        return {
          className:
            'inline-flex items-center gap-2 rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 px-3 py-2 text-sm text-red-700 dark:text-red-300 transition-colors duration-200',
          title: '遥控器连接错误',
          icon: '❌',
          text: '连接错误',
        };
      case 'disconnected':
      default:
        return {
          className:
            'inline-flex items-center gap-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 transition-colors duration-200',
          title: '遥控器未连接',
          icon: '📱',
          text: '未连接',
        };
    }
  };

  return (
    <PageLayout>
      <div className='px-2 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 顶部 Tab 切换 */}
        <div className='mb-8 flex justify-center items-center gap-4'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home' },
              { label: '收藏夹', value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) => setActiveTab(value as 'home' | 'favorites')}
          />

          {/* 遥控器快速入口 - 仅在遥控器角色时显示 */}
          {(() => {
            const buttonInfo = getControllerButtonInfo();
            if (!buttonInfo) return null;

            return (
              <Link
                href='/controller'
                className={buttonInfo.className}
                title={buttonInfo.title}
              >
                <span className='text-lg'>{buttonInfo.icon}</span>
                <span className='hidden sm:inline'>{buttonInfo.text}</span>
              </Link>
            );
          })()}
        </div>

        <div className='max-w-[95%] mx-auto'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  我的收藏
                </h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={async () => {
                      await clearAllFavorites();
                      setFavoriteItems([]);
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
                {favoriteItems.length === 0 && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                    暂无收藏内容
                  </div>
                )}
              </div>
            </section>
          ) : (
            // 首页视图
            <>
              {/* 继续观看 */}
              <ContinueWatching
                onVideoClick={
                  isController && controllerStatus === 'connected'
                    ? handleVideoClick
                    : undefined
                }
              />

              {/* 热门电影 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门电影
                  </h2>
                  <Link
                    href='/douban?type=movie'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 显示真实数据
                      hotMovies.map((movie, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <VideoCard
                            from='douban'
                            title={movie.title}
                            poster={movie.poster}
                            douban_id={movie.id}
                            rate={movie.rate}
                            year={movie.year}
                            type='movie'
                            onClick={
                              isController && controllerStatus === 'connected'
                                ? () =>
                                    handleGenericVideoClick({
                                      from: 'douban',
                                      title: movie.title,
                                      year: movie.year,
                                      type: 'movie',
                                    })
                                : undefined
                            }
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>

              {/* 热门剧集 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门剧集
                  </h2>
                  <Link
                    href='/douban?type=tv'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 显示真实数据
                      hotTvShows.map((show, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <VideoCard
                            from='douban'
                            title={show.title}
                            poster={show.poster}
                            douban_id={show.id}
                            rate={show.rate}
                            year={show.year}
                            type='tv'
                            onClick={
                              isController && controllerStatus === 'connected'
                                ? () =>
                                    handleGenericVideoClick({
                                      from: 'douban',
                                      title: show.title,
                                      year: show.year,
                                      type: 'tv',
                                    })
                                : undefined
                            }
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>

              {/* 热门综艺 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门综艺
                  </h2>
                  <Link
                    href='/douban?type=show'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <div className='relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 显示真实数据
                      hotVarietyShows.map((show, index) => (
                        <div
                          key={index}
                          className='min-w-[96px] w-24 sm:min-w-[180px] sm:w-44'
                        >
                          <VideoCard
                            from='douban'
                            title={show.title}
                            poster={show.poster}
                            douban_id={show.id}
                            rate={show.rate}
                            year={show.year}
                            type='show'
                            onClick={
                              isController && controllerStatus === 'connected'
                                ? () =>
                                    handleGenericVideoClick({
                                      from: 'douban',
                                      title: show.title,
                                      year: show.year,
                                      type: 'tv',
                                    })
                                : undefined
                            }
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>
            </>
          )}
        </div>
      </div>
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70 p-4 transition-opacity duration-300 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'>
            <div className='flex justify-between items-start mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-gray-800 dark:text-white border-b border-green-500 pb-1'>
                提示
              </h3>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-white transition-colors'
                aria-label='关闭'
              ></button>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-green-50 dark:bg-green-900/20'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-green-500 dark:bg-green-400'></div>
                <p className='ml-4 text-gray-600 dark:text-gray-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-gradient-to-r from-green-600 to-green-700 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg hover:from-green-700 hover:to-green-800 dark:from-green-600 dark:to-green-700 dark:hover:from-green-700 dark:hover:to-green-800 transition-all duration-300 transform hover:-translate-y-0.5'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
