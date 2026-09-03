# Widget cache: design

A small on-disk cache for widget lookups, so a repeated lookup in one run
does not go to the network twice.

## Requirements

- The cache lives under src/widget and nowhere else.
- A cache entry expires after one hour.
- A cache miss falls through to the existing lookup path unchanged.
- No new runtime dependency: the cache is a JSON file and built-in fs.

## Out of scope

- No cross-process locking. One process at a time is the assumption.
- No cache for the write path.
- No network behaviour changes of any kind.

## Acceptance criteria

- A second lookup of the same widget in one run reads the cache.
- An entry older than one hour is treated as a miss.
- The cache file is created lazily, so a read-only checkout still runs.

## Budget

```yaml
budget:
  allowed_paths: ["src/widget/**"]
  max_files: 2
```
