# Widget cache: plan

## Task 1: the cache module

Write src/widget/cache.ts with read and write helpers over one JSON file.

- Test: a written entry reads back.
- Test: an entry older than one hour reads as a miss.

## Task 2: wire it into the lookup

Call the cache from src/widget/lookup.ts before the network path.

- Test: a repeated lookup in one run hits the cache once.
