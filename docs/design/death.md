# Death and respawn

The owner's decision: **death is safe.** You lose no items, XP or levels.

- When your HP reaches 0, a death animation plays and creatures lose interest in you.
- After 3 s you reappear at the **nearest respawn point in the same region** (a camp fire), with full HP. Respawn points are placed in Godot as `RespawnPoint` markers.
- Everything you were carrying and wearing stays with you. Active potion boosts end.
- Boss lairs (later) may send you to the entrance instead.

Death is still meant to sting a little, through lost time, travel back, and food spent. That's why safe death works: it costs time, not items.
