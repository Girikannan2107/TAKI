/** Browser client for notifications, reviews and the public contact form (P2 §8.8). */
import { http } from "../http";
import type { ContactInput, ContactResultDTO, HealthDTO, NotificationDTO, Page, ReviewDTO } from "../contracts/common";
import type { UnreadCountResponse } from "../contracts/notifications";

export const notificationsApi = {
  list: (q: { cursor?: string | null; limit?: number; unreadOnly?: boolean } = {}, signal?: AbortSignal) =>
    http.get<Page<NotificationDTO>>("/api/notifications", { query: { cursor: q.cursor ?? undefined, limit: q.limit, unreadOnly: q.unreadOnly || undefined }, signal }),
  /** Poll every ~30 s while the page is visible. */
  unreadCount: (signal?: AbortSignal) => http.get<UnreadCountResponse>("/api/notifications/unread-count", { signal }),
  markRead: (ids: string[]) => http.post<void>("/api/notifications/read", { ids }),
  markAllRead: () => http.post<void>("/api/notifications/read", { all: true }),
};

export const reviewsApi = {
  forDriver: (driverId: string, cursor?: string | null, limit?: number) => http.get<Page<ReviewDTO>>("/api/reviews", { query: { driverId, cursor: cursor ?? undefined, limit } }),
  forAgency: (agencyId: string, cursor?: string | null, limit?: number) => http.get<Page<ReviewDTO>>("/api/reviews", { query: { agencyId, cursor: cursor ?? undefined, limit } }),
};

export const publicApi = {
  /** POST /api/public/contact — 201 `{ id, receivedAt }`; 429 rate_limited after 5/hour. */
  contact: (body: ContactInput) => http.post<ContactResultDTO>("/api/public/contact", body),
  health: () => http.get<HealthDTO>("/api/health"),
};
