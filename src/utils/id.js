// This just makes a kind of unique id by mixing time and random.
// Not perfect like UUID, but good enough for file names in this project.
export function newId() {
  const ts = Date.now().toString(36); // timestamp part so it sorts kinda by time
  const rnd = Math.random().toString(36).slice(2, 10); // some randomness
  return `${ts}${rnd}`; // final id looks like abcd123efg
}
