/**
 * Which messages of a chat are on the page.
 *
 * A long chat renders only its latest messages; older ones are added a batch at a time as
 * the reader scrolls up (the view stays put while they arrive), or at once when a search
 * result or a bookmark points into them. New messages always join at the bottom, so the
 * window only ever grows while a chat is open — nothing the reader is looking at is taken
 * away from under them.
 */

/** Messages shown when a chat opens. */
export const WINDOW = 40;
/** Messages added each time the reader nears the top. */
export const PAGE = 40;
/** How close to the top (px) scrolling has to come before the next batch is added. */
export const NEAR_TOP = 600;
/** Messages kept above one that is jumped to, so it doesn't land at the very edge. */
const JUMP_MARGIN = 10;

/** The first message rendered when a chat of `count` messages opens. */
export function firstStart(count: number): number {
  return Math.max(0, count - WINDOW);
}

/** The window after one more batch of older messages. */
export function earlierStart(start: number): number {
  return Math.max(0, start - PAGE);
}

/** The window that includes message `index` (a jump from search or a bookmark). */
export function startIncluding(index: number, start: number): number {
  return index < start ? Math.max(0, index - JUMP_MARGIN) : start;
}
