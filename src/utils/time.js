// Simple time helpers so I don't repeat code everywhere
export const now = () => new Date().toISOString(); // current time as ISO string
export const sec = (n) => n * 1000; // convert seconds to milliseconds
export const fromNowIso = (ms) => new Date(Date.now() + ms).toISOString(); // future time as ISO
