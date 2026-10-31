import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { DemoStateDto } from '@bookverse/shared';

/** Живое состояние показа. После обрыва связи клиент подключается заново и получает снимок. */
export function useDemoState(code: string | null, initial: DemoStateDto | null) {
  const [state, setState] = useState<DemoStateDto | null>(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setState(initial);
  }, [initial]);

  useEffect(() => {
    if (!code || import.meta.env.VITE_REALTIME_URL === 'off') return;
    // Состояние показа публично, поэтому на хостинге сокет идёт сразу к серверу, минуя прокси сайта.
    const socket = io(import.meta.env.VITE_REALTIME_URL, { path: '/socket.io', withCredentials: true });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('demo:watch', code);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('demo:state', (next: DemoStateDto) => setState(next));
    return () => {
      socket.disconnect();
    };
  }, [code]);

  return { state, connected };
}
