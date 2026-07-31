// Buckets an already-sorted (newest-first) list of files into date-range
// "moment" groups, the way Photos.app's library view does - no location
// data exists in this project, so grouping is purely time-based.

const DAY_MS = 24 * 60 * 60 * 1000;
const GAP_THRESHOLD_MS = 2 * DAY_MS;

function toMs(value) {
  return typeof value === "number" ? value * 1000 : new Date(value).getTime();
}

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function isSameDay(aMs, bMs) {
  return startOfDay(aMs) === startOfDay(bMs);
}

function isSameMonth(aMs, bMs) {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function formatDay(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatRange(oldestMs, newestMs) {
  const oldest = new Date(oldestMs);
  const newest = new Date(newestMs);
  if (isSameMonth(oldestMs, newestMs)) {
    const month = newest.toLocaleDateString(undefined, { month: "short" });
    return `${month} ${oldest.getDate()}-${newest.getDate()}, ${newest.getFullYear()}`;
  }
  const oldestLabel = oldest.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const newestLabel = newest.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${oldestLabel} - ${newestLabel}`;
}

function labelFor(oldestMs, newestMs) {
  const today = startOfDay(Date.now());
  const yesterday = today - DAY_MS;

  if (isSameDay(oldestMs, newestMs)) {
    if (startOfDay(newestMs) === today) return "Today";
    if (startOfDay(newestMs) === yesterday) return "Yesterday";
    return formatDay(newestMs);
  }
  return formatRange(oldestMs, newestMs);
}

/**
 * @param {Array} files - already sorted newest-first by whatever
 *   `getTimestamp` extracts.
 * @param {(file: object) => number|string} getTimestamp - epoch-seconds
 *   number or a Date-parseable value; defaults to `file.uploadedAt`.
 * @returns {{ label: string, files: Array }[]}
 */
export function groupFilesByDate(files, getTimestamp = (file) => file.uploadedAt) {
  const groups = [];
  let current = null;
  let currentMonthKey = null;

  for (const file of files) {
    const ms = toMs(getTimestamp(file));
    const key = monthKey(ms);

    const gapTooLarge = current !== null && current.oldestMs - ms > GAP_THRESHOLD_MS;
    const monthChanged = current !== null && key !== currentMonthKey;

    if (current === null || gapTooLarge || monthChanged) {
      current = { newestMs: ms, oldestMs: ms, files: [] };
      currentMonthKey = key;
      groups.push(current);
    } else {
      current.oldestMs = ms;
    }
    current.files.push(file);
  }

  return groups.map((group) => ({
    label: labelFor(group.oldestMs, group.newestMs),
    files: group.files,
  }));
}
