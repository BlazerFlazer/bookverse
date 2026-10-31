import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookDetailDto, BookSummaryDto, GameEventDto, ProfileDto, UserDto, VocabularyItemDto, VocabularySummaryDto } from '@bookverse/shared';
import { api } from './api.ts';
import { showGameEvent } from '../stores/toasts.ts';

export interface MeResponse {
  user: UserDto | null;
  mailConfigured: boolean;
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/auth/me'), staleTime: 60_000 });
}

export interface CatalogFilters {
  q?: string;
  genre?: string;
  language?: string;
  shelf?: string;
}

export function useCatalog(filters: CatalogFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const search = params.toString();
  return useQuery({
    queryKey: ['books', search],
    queryFn: () => api<{ books: BookSummaryDto[]; genres: string[] }>(`/books${search ? `?${search}` : ''}`),
    placeholderData: (previous) => previous,
  });
}

export function useBook(publicId: string | undefined) {
  return useQuery({
    queryKey: ['book', publicId],
    queryFn: () => api<BookDetailDto>(`/books/${publicId}`),
    enabled: Boolean(publicId),
  });
}

export function useProfile(enabled: boolean) {
  return useQuery({ queryKey: ['profile'], queryFn: () => api<ProfileDto>('/profile'), enabled, retry: false });
}

export function useVocabulary() {
  return useQuery({
    queryKey: ['vocabulary'],
    queryFn: () => api<{ items: VocabularyItemDto[]; summary: VocabularySummaryDto }>('/vocabulary'),
  });
}

export function useSaveWord() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: object) => api<{ item: VocabularyItemDto; game: GameEventDto; created: boolean }>('/vocabulary', { method: 'POST', body: input }),
    onSuccess: ({ game }) => {
      showGameEvent(game);
      void client.invalidateQueries({ queryKey: ['vocabulary'] });
      void client.invalidateQueries({ queryKey: ['profile'] });
      void client.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
