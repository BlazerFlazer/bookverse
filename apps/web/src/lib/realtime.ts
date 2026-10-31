import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import type { GameEventDto } from '@bookverse/shared';
import { showGameEvent, toast } from '../stores/toasts.ts';

/** Сокет живёт, пока есть пользователь: сайт сразу узнаёт о действиях, сделанных в Telegram. */
export function useRealtime(userId: string | null | undefined): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('game:event', (event: GameEventDto) => {
      showGameEvent(event);
      void client.invalidateQueries({ queryKey: ['profile'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    });
    socket.on('vocabulary:changed', () => {
      void client.invalidateQueries({ queryKey: ['vocabulary'] });
    });
    socket.on('telegram:linked', ({ username }: { username: string | null }) => {
      toast('Telegram подключён', username ? `Аккаунт @${username}` : undefined);
      void client.invalidateQueries({ queryKey: ['profile'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [userId, client]);
}
