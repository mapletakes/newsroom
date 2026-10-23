-- Instagram links used to be classified 'article' and run through the
-- generic article extractor, which Instagram answers with a login-wall shell
-- (<title>Instagram</title>, no OG tags) — so every Instagram post landed on
-- the deck titled just "Instagram". They now get their own kind and extractor
-- (lib/extract-instagram.ts). Must be applied BEFORE the code that detects
-- the kind is deployed, or inserting an Instagram submission fails on the
-- enum.
alter type media_kind add value if not exists 'instagram';
