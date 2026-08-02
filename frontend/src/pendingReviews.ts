/**
 * Simple in-memory queue for batch OCR review flow.
 * When user picks N receipts from gallery, we OCR them all up front,
 * push N-1 payloads here, and navigate to review for the first.
 * On save/skip in review, we pop the next payload and re-navigate.
 */
let queue: string[] = []; // JSON-stringified OCR payloads
let total = 0;

export function setQueue(payloads: string[]) {
  queue = payloads.slice();
  total = payloads.length;
}
export function popNext(): string | null {
  return queue.shift() ?? null;
}
export function remaining(): number {
  return queue.length;
}
export function totalCount(): number {
  return total;
}
export function currentIndex(): number {
  // How many have been consumed so far (i.e., current one = total - remaining)
  return total - queue.length;
}
export function clearQueue() {
  queue = [];
  total = 0;
}
